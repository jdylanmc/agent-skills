/**
 * Deterministic classification for URI-seeded discovery.
 *
 * A human may hand discovery a URI or path to enrich the frontier. That input
 * is attacker-controllable: the URI itself, the redirects it triggers, its
 * declared content type, and its body are all untrusted. Nothing here fetches
 * anything. This module decides, mechanically and testably, what a seed is
 * allowed to become before and after retrieval, so the scheme allow-list, the
 * credential rejection, the private-address deny-list, the traversal guard, the
 * redirect-origin rule, the size bound, and the content-type classification are
 * proven by adversarial tests rather than asserted in prose.
 *
 * Two distinct stages, deliberately kept apart:
 *   - `classifyUriSeed` runs BEFORE retrieval. It returns either a retrieval
 *     DECISION (which held grant may carry the seed, and the exact target) or a
 *     terminal REFUSAL disposition. It never returns a success disposition,
 *     because nothing has been retrieved yet.
 *   - `validateRemoteResult` / `validateLocalBody` run AFTER retrieval and turn
 *     a returned body into a terminal disposition, failing closed when the
 *     transport metadata needed to enforce a guard is missing.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Terminal dispositions. Every seed ends at exactly one of these — either a
 * retrieved-and-folded success or a named refusal. There is no silent skip.
 */
export const DISPOSITIONS = {
  seededLocal: 'uri-seeded-local', // retrieved with the held `read` grant
  seededRemote: 'uri-seeded-remote', // retrieved via the held `task` research route
  invalid: 'uri-invalid',
  unsupportedScheme: 'uri-unsupported-scheme',
  credentialed: 'uri-credentialed',
  blockedAddress: 'uri-blocked-address',
  outOfScope: 'uri-out-of-scope',
  redirectUntrusted: 'uri-redirect-untrusted',
  tooLarge: 'uri-too-large',
  nonText: 'uri-non-text',
  unreachable: 'uri-unreachable',
  accessDenied: 'uri-access-denied',
  empty: 'uri-empty',
};

/**
 * Pre-retrieval decisions. A seed the classifier accepts carries one of these,
 * naming the held grant that may retrieve it — never a success disposition.
 */
export const DECISIONS = {
  retrieveLocal: 'retrieve-local', // via the held `read` grant
  retrieveRemote: 'retrieve-remote', // via the held `task` research route
};

/** Schemes we retrieve, split by the grant that carries each. */
export const LOCAL_SCHEMES = Object.freeze(['file']);
export const REMOTE_SCHEMES = Object.freeze(['http', 'https']);

/** Default ceiling for a fetched seed body, in bytes (2 MiB). */
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/** Hostnames that resolve locally and are always treated as localhost. */
const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Content types accepted as text evidence. A seed whose declared type is not
 * textual is refused as `uri-non-text` rather than parsed as if it were prose.
 */
const TEXTUAL_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/html',
  'text/csv',
  'text/xml',
  'application/json',
  'application/xml',
  'application/xhtml+xml',
]);

/**
 * File extensions whose final label would otherwise be mistaken for a TLD. A
 * schemeless token whose last label is one of these is a filename, not a host,
 * so `notes.md` and `my.config.json` stay local reads.
 */
const FILE_EXTENSIONS = new Set([
  'md', 'markdown', 'mdx', 'txt', 'text', 'rst', 'log',
  'json', 'jsonc', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'csv', 'tsv',
  'html', 'htm', 'css', 'scss', 'less',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'py', 'rb', 'php', 'sh', 'ps1', 'psm1', 'bat', 'cmd',
  'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'swift',
  'sql', 'lock', 'diff', 'patch', 'env', 'gitignore',
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'zip', 'gz', 'tar',
]);

function looksLikeUncPath(input) {
  // `\\server\share` or `//server/share` — a remote host wearing a path.
  return /^\\\\/.test(input) || /^\/\//.test(input);
}

/**
 * Detect a schemeless bare authority — a dotted, TLD-shaped host token with no
 * scheme and no leading path separator, e.g. `www.example.com` or
 * `dev.azure.com/org/repo`. Web sources are routinely pasted without
 * `https://`, and without this guard `looksLikePath` would treat them as local
 * file reads and hand a domain to the `read` grant. Filesystem forms — `./x`,
 * `../x`, `/abs/x`, `C:\x`, and filenames like `notes.md` — are preserved.
 */
function looksLikeBareAuthority(input) {
  if (/^[./\\~]/.test(input)) {
    return false; // ./  ../  /abs  \unc  ~home  .hidden — unambiguously a path
  }
  if (/^[a-zA-Z]:[\\/]/.test(input)) {
    return false; // Windows drive path
  }
  const authority = input.split(/[/?#\\]/, 1)[0];
  // A dotted hostname: one or more labels then an alphabetic TLD of length >= 2.
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(authority)) {
    return false;
  }
  const lastLabel = authority.split('.').pop().toLowerCase();
  if (FILE_EXTENSIONS.has(lastLabel)) {
    return false; // notes.md, my.config.json — a filename, not a host
  }
  return true;
}

function looksLikePath(input) {
  // A Windows drive path (`C:\...` or `C:/...`) is a filesystem path, not a URI
  // scheme, even though `C:` matches the scheme grammar.
  if (/^[a-zA-Z]:[\\/]/.test(input)) {
    return true;
  }
  // A URI scheme is `scheme:` where scheme starts with a letter. Anything
  // without that shape is a filesystem or repo-relative path.
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input);
}

function stripBrackets(hostname) {
  return hostname.replace(/^\[/, '').replace(/\]$/, '');
}

/**
 * Decide whether a set of IPv4 octets names a loopback, private, link-local,
 * or otherwise non-public host. Shared by the dotted-quad path and by the IPv6
 * decoder, so an IPv4 address embedded in an IPv6 form is judged by the exact
 * same rules as a bare IPv4 address.
 */
function isBlockedIpv4(a, b, c, d) {
  if ([a, b, c, d].some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true; // malformed address — refuse rather than dispatch
  }
  if (a === 0 || a === 127) return true; // this-host / loopback
  if (a === 10) return true; // private
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a >= 224) return true; // multicast / reserved
  return false;
}

/**
 * Parse an IPv6 literal (without brackets) into eight 16-bit groups, honoring
 * `::` compression and an embedded dotted-IPv4 tail (`::ffff:1.2.3.4`). Returns
 * `null` for anything it cannot parse — the caller treats that as "not provably
 * public" and refuses it. This is a decoder, not a validator of allocation
 * policy; the range checks live in `isBlockedIpv6`.
 */
function parseIpv6(input) {
  let s = input.trim().toLowerCase();
  if (s.includes('%')) {
    return null; // zone identifiers are never a fetchable public host
  }
  // Fold a trailing dotted-IPv4 tail into two hex groups so `::ffff:127.0.0.1`
  // and `64:ff9b::1.2.3.4` decode through the same pure-hex path below.
  const v4match = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4match) {
    const octets = v4match[1].split('.').map(Number);
    if (octets.some((octet) => octet > 255)) {
      return null;
    }
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    s = s.slice(0, s.length - v4match[1].length) + `${hi}:${lo}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) {
    return null; // more than one `::` is not a valid address
  }
  const toGroups = (part) => {
    if (part === '') return [];
    return part.split(':').map((group) => {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return NaN;
      return parseInt(group, 16);
    });
  };
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : null;
  if (head.some(Number.isNaN) || (tail && tail.some(Number.isNaN))) {
    return null;
  }
  let groups;
  if (tail === null) {
    if (head.length !== 8) return null; // no `::`, so all eight groups required
    groups = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null; // `::` must stand for at least one zero group
    groups = [...head, ...Array(missing).fill(0), ...tail];
  }
  return groups;
}

/**
 * Decide whether an IPv6 host is non-public. Fails closed: only an address
 * positively classified as global unicast (`2000::/3`) AND not one of the
 * embedded-IPv4 transition mechanisms is treated as public. IPv4 embedded in
 * IPv6 — IPv4-mapped (`::ffff:a.b.c.d`, incl. its hex form), IPv4-compatible
 * (`::a.b.c.d`), and NAT64 (`64:ff9b::/96`) — is decoded and judged by the IPv4
 * rules, closing the loophole where `[::ffff:169.254.169.254]` bypassed the v4
 * deny-list. The two remaining embedded-IPv4 tunnels that live inside `2000::/3`
 * — 6to4 (`2002::/16`) and Teredo (`2001:0000::/32`) — can each wrap an arbitrary
 * private or metadata IPv4 (e.g. `2002:a9fe:a9fe::` carries `169.254.169.254`),
 * so both deprecated transition ranges are refused outright rather than admitted
 * as public; the documentation range (`2001:db8::/32`) is refused too as
 * non-routable. Google DNS `2001:4860:4860::8888` sits in `2001::/16` but outside
 * Teredo's narrower `2001:0000::/32`, so it stays allowed.
 */
function isBlockedIpv6(host) {
  const g = parseIpv6(host);
  if (!g) {
    return true; // unparseable IPv6 — cannot prove it is public, so refuse
  }
  const hi6Zero = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
  const embeddedV4 = () => isBlockedIpv4(g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff);
  if (g.every((group) => group === 0)) return true; // :: unspecified
  if (hi6Zero && g[5] === 0 && g[6] === 0 && g[7] === 1) return true; // ::1 loopback
  if (hi6Zero && g[5] === 0xffff) return embeddedV4(); // IPv4-mapped ::ffff:0:0/96
  if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return embeddedV4(); // NAT64 64:ff9b::/96
  }
  if (hi6Zero && g[5] === 0) return embeddedV4(); // IPv4-compatible ::a.b.c.d
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
  if (g[0] === 0x2002) return true; // 6to4 2002::/16 — deprecated tunnel wrapping arbitrary v4
  if (g[0] === 0x2001 && g[1] === 0x0000) return true; // Teredo 2001:0000::/32 — deprecated tunnel wrapping arbitrary v4
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation 2001:db8::/32 — non-routable
  if ((g[0] & 0xe000) === 0x2000) return false; // global unicast 2000::/3 — public
  return true; // anything else is not provably public — refuse conservatively
}

/**
 * Decide whether a hostname points at the local machine or a private network.
 * A remote seed pointed at one of these is an SSRF target — cloud metadata,
 * loopback admin panels, or internal services — and is refused before dispatch.
 */
export function isBlockedHost(hostname) {
  if (typeof hostname !== 'string' || hostname === '') {
    return true;
  }
  const lowered = hostname.trim().toLowerCase();
  const host = stripBrackets(lowered);
  if (LOCALHOST_NAMES.has(lowered) || host === 'localhost') {
    return true;
  }
  // Any colon-bearing host is IPv6 (bracketed or bare); decode it, including any
  // embedded IPv4, and fail closed on forms we cannot prove public.
  if (host.includes(':')) {
    return isBlockedIpv6(host);
  }
  // IPv4 dotted quads.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    return isBlockedIpv4(a, b, c, d);
  }
  // Non-address hostnames that name the host itself or internal-only zones.
  if (host === '0.0.0.0' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  return false;
}

function parsedCredentials(url) {
  return url.username !== '' || url.password !== '';
}

/**
 * Enforce an optional operator-declared scope. `scope.roots` is a list of
 * directory paths a local seed must resolve inside; `scope.origins` is a list
 * of allowed remote origins (`https://host:port`). When a dimension is not
 * supplied, that dimension is not constrained here — the operator declared no
 * boundary for it.
 */
function localWithinScope(resolvedPath, scope) {
  if (!scope || !Array.isArray(scope.roots) || scope.roots.length === 0) {
    return true;
  }
  return scope.roots.some((root) => {
    const realRoot = path.resolve(root);
    const rel = path.relative(realRoot, resolvedPath);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

function remoteWithinScope(origin, scope) {
  if (!scope || !Array.isArray(scope.origins) || scope.origins.length === 0) {
    return true;
  }
  return scope.origins.some((allowed) => allowed.toLowerCase() === origin.toLowerCase());
}

/**
 * Classify one seed into a retrieval decision or a named refusal. Deterministic
 * and side-effect free. `input` is the raw string a human supplied; `scope` is
 * an optional operator-declared boundary.
 */
export function classifyUriSeed(input, { scope } = {}) {
  if (typeof input !== 'string' || input.trim() === '') {
    return { disposition: DISPOSITIONS.invalid, reason: 'empty or non-string seed' };
  }
  const seed = input.trim();

  // A newline or control character in a seed is never a legitimate URI or path
  // and is a common injection/splitting vector. Refuse it before parsing.
  if (/[\u0000-\u001f\u007f]/.test(seed)) {
    return { disposition: DISPOSITIONS.invalid, reason: 'control characters in seed' };
  }

  // A UNC path names a remote host over SMB and must never take the read grant.
  if (looksLikeUncPath(seed)) {
    return { disposition: DISPOSITIONS.blockedAddress, reason: 'UNC path names a remote host' };
  }

  if (looksLikePath(seed)) {
    // A schemeless dotted host (`www.example.com`, `dev.azure.com/x`) is a web
    // source pasted without its scheme, not a local file. Refuse it so a domain
    // is never handed to the read grant; the human re-supplies it with a scheme.
    if (looksLikeBareAuthority(seed)) {
      return {
        disposition: DISPOSITIONS.invalid,
        reason: 'bare host or domain without a scheme; prefix http(s):// to fetch it or ./ to read a local file',
      };
    }
    const resolved = path.resolve(seed);
    if (!localWithinScope(resolved, scope)) {
      return { disposition: DISPOSITIONS.outOfScope, reason: 'path escapes declared scope', target: resolved };
    }
    return {
      decision: DECISIONS.retrieveLocal,
      kind: 'local-path',
      route: 'read',
      target: seed,
      origin: 'seed',
    };
  }

  let url;
  try {
    url = new URL(seed);
  } catch {
    return { disposition: DISPOSITIONS.invalid, reason: 'unparseable URI' };
  }

  // Credentials are refused for any scheme, before routing, so the deterministic
  // disposition never depends on check order and no credential is ever
  // forwarded to a spawned route.
  if (parsedCredentials(url)) {
    return { disposition: DISPOSITIONS.credentialed, reason: 'URI embeds credentials' };
  }

  const scheme = url.protocol.replace(/:$/, '').toLowerCase();

  if (LOCAL_SCHEMES.includes(scheme)) {
    // A `file:` URI with a non-local authority is a remote host over SMB/UNC.
    const fileHost = url.hostname.toLowerCase();
    if (fileHost !== '' && fileHost !== 'localhost' && !LOCALHOST_NAMES.has(fileHost)) {
      return { disposition: DISPOSITIONS.blockedAddress, reason: 'file: URI names a non-local host' };
    }
    let fsPath;
    try {
      fsPath = fileURLToPath(url);
    } catch {
      return { disposition: DISPOSITIONS.invalid, reason: 'file: URI is not a local path' };
    }
    const resolved = path.resolve(fsPath);
    if (!localWithinScope(resolved, scope)) {
      return { disposition: DISPOSITIONS.outOfScope, reason: 'file: path escapes declared scope', target: resolved };
    }
    return {
      decision: DECISIONS.retrieveLocal,
      kind: 'file-uri',
      route: 'read',
      target: fsPath,
      origin: 'seed',
    };
  }

  if (!REMOTE_SCHEMES.includes(scheme)) {
    return {
      disposition: DISPOSITIONS.unsupportedScheme,
      scheme,
      reason: `scheme "${scheme}" is not in the allow-list`,
    };
  }

  if (isBlockedHost(url.hostname)) {
    return { disposition: DISPOSITIONS.blockedAddress, reason: `host "${url.hostname}" is loopback, private, or link-local` };
  }

  if (!remoteWithinScope(url.origin, scope)) {
    return { disposition: DISPOSITIONS.outOfScope, reason: 'origin is outside declared scope', target: url.origin };
  }

  return {
    decision: DECISIONS.retrieveRemote,
    kind: 'remote-uri',
    route: 'research',
    target: url.href,
    origin: 'seed',
  };
}

/** Same-origin comparison for redirect handling. */
function sameOrigin(a, b) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return (
      x.protocol === y.protocol &&
      x.hostname.toLowerCase() === y.hostname.toLowerCase() &&
      x.port === y.port
    );
  } catch {
    return false;
  }
}

/**
 * Decide whether one redirect hop may be followed. A redirect that leaves the
 * seed's origin, targets a non-remote scheme, or points at a blocked address is
 * not followed; it is surfaced as a candidate the human can approve, never
 * silently chased. This is the "no expanding to unrelated links" guard.
 */
export function classifyRedirect(fromUrl, toUrl) {
  if (typeof toUrl !== 'string' || toUrl.trim() === '') {
    return { disposition: DISPOSITIONS.unreachable, reason: 'redirect without a target' };
  }
  let target;
  try {
    target = new URL(toUrl, fromUrl);
  } catch {
    return { disposition: DISPOSITIONS.invalid, reason: 'unparseable redirect target' };
  }
  const scheme = target.protocol.replace(/:$/, '').toLowerCase();
  if (!REMOTE_SCHEMES.includes(scheme)) {
    return {
      disposition: DISPOSITIONS.redirectUntrusted,
      reason: `redirect to non-remote scheme "${scheme}"`,
      candidate: target.href,
    };
  }
  if (isBlockedHost(target.hostname)) {
    return {
      disposition: DISPOSITIONS.blockedAddress,
      reason: 'redirect targets a loopback, private, or link-local host',
      candidate: target.href,
    };
  }
  if (!sameOrigin(fromUrl, target.href)) {
    return {
      disposition: DISPOSITIONS.redirectUntrusted,
      reason: 'redirect crosses origin',
      candidate: target.href,
    };
  }
  return { disposition: 'follow', target: target.href };
}

function normalizeContentType(contentType) {
  if (typeof contentType !== 'string') {
    return null;
  }
  const [type] = contentType.split(';');
  return type.trim().toLowerCase();
}

/**
 * Classify a declared content type as text evidence or a `uri-non-text`
 * refusal. Unknown or missing types are refused rather than assumed textual.
 */
export function classifyContentType(contentType) {
  const type = normalizeContentType(contentType);
  if (type === null || type === '') {
    return { disposition: DISPOSITIONS.nonText, reason: 'missing content type' };
  }
  if (TEXTUAL_TYPES.has(type) || type.startsWith('text/') || /\+(json|xml)$/.test(type)) {
    return { disposition: 'text', type };
  }
  return { disposition: DISPOSITIONS.nonText, type };
}

/**
 * Enforce the size bound. `bytes` is the measured or declared body size.
 */
export function withinSizeBound(bytes, maxBytes = DEFAULT_MAX_BYTES) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes < 0) {
    return { disposition: DISPOSITIONS.invalid, reason: 'unknown size' };
  }
  if (bytes === 0) {
    return { disposition: DISPOSITIONS.empty };
  }
  if (bytes > maxBytes) {
    return { disposition: DISPOSITIONS.tooLarge, bytes, maxBytes };
  }
  return { disposition: 'within-bound', bytes };
}

/**
 * Decide whether a locally read body is acceptable text evidence. A local read
 * carries no HTTP content type, so text is judged from the bytes: a NUL byte
 * marks binary. Returns a terminal disposition.
 */
export function validateLocalBody(body, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (typeof body !== 'string' && !Buffer.isBuffer(body)) {
    return { disposition: DISPOSITIONS.empty, reason: 'no body' };
  }
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const size = withinSizeBound(buffer.length, maxBytes);
  if (size.disposition !== 'within-bound') {
    return size;
  }
  if (buffer.includes(0)) {
    return { disposition: DISPOSITIONS.nonText, reason: 'body contains a NUL byte' };
  }
  return { disposition: DISPOSITIONS.seededLocal, bytes: buffer.length, origin: 'seed' };
}

/**
 * Turn a remote retrieval result into a terminal disposition. The research
 * route MUST return the transport metadata a guard needs; when any required
 * field is absent the seed fails closed rather than being accepted unchecked.
 *
 * Required shape: `{ requestedUri, finalUri, redirectChain, contentType,
 * byteLength, body }`. `redirectChain` is the ordered list of hops the route
 * observed, each `{ from, to }`.
 */
export function validateRemoteResult(result, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (result === null || typeof result !== 'object') {
    return { disposition: DISPOSITIONS.unreachable, reason: 'no retrieval result' };
  }
  const { requestedUri, finalUri, redirectChain, contentType, byteLength, body } = result;

  // Missing transport metadata means a guard cannot run — fail closed.
  if (typeof finalUri !== 'string' || !Array.isArray(redirectChain)) {
    return { disposition: DISPOSITIONS.redirectUntrusted, reason: 'route did not report the redirect chain' };
  }

  // The post-retrieval address guard must judge where the request actually
  // LANDED, not only the hops. A blocked final host is refused even when the
  // chain is empty — this closes the fail-open where `redirectChain: []` with a
  // metadata `finalUri` was accepted unchecked.
  let finalNormalized;
  try {
    const finalUrl = new URL(finalUri);
    finalNormalized = finalUrl.href;
    if (isBlockedHost(finalUrl.hostname)) {
      return { disposition: DISPOSITIONS.blockedAddress, reason: `final host "${finalUrl.hostname}" is loopback, private, or link-local` };
    }
  } catch {
    return { disposition: DISPOSITIONS.redirectUntrusted, reason: 'route reported an unparseable finalUri' };
  }

  for (const hop of redirectChain) {
    const verdict = classifyRedirect(hop?.from, hop?.to);
    if (verdict.disposition !== 'follow') {
      return { disposition: verdict.disposition, reason: verdict.reason, candidate: verdict.candidate };
    }
  }

  // Chain continuity: the route cannot claim a benign final destination while
  // hiding the hops that reached it. Comparing normalized URLs, the chain must
  // begin at the requested URI, be link-to-link continuous, and end at the
  // final URI; an empty chain is only trustworthy when nothing was redirected.
  const normalize = (uri) => {
    if (typeof uri !== 'string') return null;
    try {
      return new URL(uri).href;
    } catch {
      return null;
    }
  };
  const requestedNormalized = normalize(requestedUri);
  if (requestedNormalized === null) {
    return { disposition: DISPOSITIONS.redirectUntrusted, reason: 'route did not report a valid requested URI' };
  }
  if (redirectChain.length === 0) {
    if (requestedNormalized !== finalNormalized) {
      return { disposition: DISPOSITIONS.redirectUntrusted, reason: 'empty redirect chain but finalUri differs from requestedUri' };
    }
  } else {
    if (normalize(redirectChain[0]?.from) !== requestedNormalized) {
      return { disposition: DISPOSITIONS.redirectUntrusted, reason: 'redirect chain does not begin at the requested URI' };
    }
    for (let i = 1; i < redirectChain.length; i += 1) {
      if (normalize(redirectChain[i]?.from) !== normalize(redirectChain[i - 1]?.to)) {
        return { disposition: DISPOSITIONS.redirectUntrusted, reason: 'redirect chain is discontinuous' };
      }
    }
    if (normalize(redirectChain[redirectChain.length - 1]?.to) !== finalNormalized) {
      return { disposition: DISPOSITIONS.redirectUntrusted, reason: 'redirect chain does not end at finalUri' };
    }
  }

  const type = classifyContentType(contentType);
  if (type.disposition !== 'text') {
    return type;
  }

  const size = withinSizeBound(typeof byteLength === 'number' ? byteLength : NaN, maxBytes);
  if (size.disposition !== 'within-bound') {
    return size;
  }
  if (typeof body !== 'string' || body === '') {
    return { disposition: DISPOSITIONS.empty, reason: 'route returned no body' };
  }
  return { disposition: DISPOSITIONS.seededRemote, bytes: size.bytes, finalUri, origin: 'seed' };
}

/**
 * Map a transport/access failure observed during retrieval to a named
 * disposition, so the same event does not become a different status elsewhere.
 */
export function classifyRetrievalFailure(kind) {
  switch (kind) {
    case 'network':
    case 'dns':
    case 'timeout':
    case 'http-5xx':
    case 'http-404':
      return { disposition: DISPOSITIONS.unreachable, kind };
    case 'http-401':
    case 'http-403':
    case 'content-exclusion':
    case 'auth-required':
      return { disposition: DISPOSITIONS.accessDenied, kind };
    default:
      return { disposition: DISPOSITIONS.unreachable, kind: kind ?? 'unknown' };
  }
}
