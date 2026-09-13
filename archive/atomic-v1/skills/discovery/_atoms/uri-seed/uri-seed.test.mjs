import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  DECISIONS,
  DISPOSITIONS,
  DEFAULT_MAX_BYTES,
  LOCAL_SCHEMES,
  REMOTE_SCHEMES,
  classifyContentType,
  classifyRedirect,
  classifyRetrievalFailure,
  classifyUriSeed,
  isBlockedHost,
  validateLocalBody,
  validateRemoteResult,
  withinSizeBound,
} from './uri-seed.mjs';

// --- Pre-retrieval routing decisions (reachability of both routes) ----------

test('an http(s) URI is reachable as a remote research retrieval decision', () => {
  for (const url of [
    'https://example.com/design.md',
    'http://tracker.example.com/issue/84',
    'https://dev.azure.com/org/proj/_git/repo?path=/README.md',
    'https://wiki.example.com/pages/Fresno',
    'HTTPS://EXAMPLE.COM/Case',
  ]) {
    const result = classifyUriSeed(url);
    assert.equal(result.decision, DECISIONS.retrieveRemote, url);
    assert.equal(result.route, 'research', url);
    assert.equal(result.origin, 'seed', url);
    assert.equal(result.disposition, undefined, `${url} must not carry a success disposition pre-retrieval`);
  }
});

test('a file URI and a filesystem path are reachable as local read decisions', () => {
  for (const seed of [
    'file:///Users/dylan/notes.md',
    '/abs/path/design.md',
    './relative/notes.txt',
    '../up/one.md',
    'docs/CHANGELOG.md',
    'README.md',
    'C:\\Users\\dylan\\notes.md',
  ]) {
    const result = classifyUriSeed(seed);
    assert.equal(result.decision, DECISIONS.retrieveLocal, seed);
    assert.equal(result.route, 'read', seed);
    assert.equal(result.origin, 'seed', seed);
  }
});

test('a schemeless bare host or domain is not classified as a local file read', () => {
  // F3: web sources are pasted without https://; they must not become read grants.
  for (const seed of [
    'www.example.com',
    'dev.azure.com/org/proj/_git/repo?path=/README.md',
    'github.com/jdylanmc/agent-skills/pull/84',
    'example.co.uk/page',
  ]) {
    const result = classifyUriSeed(seed);
    assert.notEqual(result.decision, DECISIONS.retrieveLocal, seed);
    assert.equal(result.disposition, DISPOSITIONS.invalid, seed);
  }
});

test('unambiguous local paths and filenames stay local reads', () => {
  // F3: the bare-authority guard must not swallow real filesystem seeds.
  for (const seed of [
    './notes.md',
    '../up/one.md',
    'notes.md',
    'docs/CHANGELOG.md',
    'my.config.json',
    '/abs/x',
    'C:\\Users\\dylan\\notes.md',
    'C:/Users/dylan/notes.md',
    'README.md',
  ]) {
    assert.equal(classifyUriSeed(seed).decision, DECISIONS.retrieveLocal, seed);
  }
});

test('a file URI target is a filesystem path, not the URL string', () => {
  const result = classifyUriSeed('file:///Users/dylan/notes.md');
  assert.equal(result.decision, DECISIONS.retrieveLocal);
  assert.equal(result.target, path.normalize('/Users/dylan/notes.md'));
  assert.ok(!result.target.startsWith('file:'));
});

test('the allow-list is exactly file/http/https', () => {
  assert.deepEqual(LOCAL_SCHEMES, ['file']);
  assert.deepEqual(REMOTE_SCHEMES, ['http', 'https']);
});

test('unsupported schemes are refused, never fetched', () => {
  for (const url of [
    'ftp://host/file',
    'data:text/html,<script>alert(1)</script>',
    'javascript:alert(1)',
    'mailto:someone@host',
    'ssh://git@host/repo.git',
    'about:blank',
    'vbscript:msgbox',
    'blob:https://example.com/uuid',
  ]) {
    const result = classifyUriSeed(url);
    assert.notEqual(result.decision, DECISIONS.retrieveRemote, url);
    assert.notEqual(result.decision, DECISIONS.retrieveLocal, url);
    assert.ok(
      [DISPOSITIONS.unsupportedScheme, DISPOSITIONS.credentialed].includes(result.disposition),
      `${url} -> ${result.disposition}`,
    );
  }
});

test('credential-embedding URIs are refused before any routing, for any scheme', () => {
  for (const url of [
    'https://user:pass@host/secret',
    'http://admin:hunter2@8.8.8.8/',
    'https://token@host/x',
    'ftp://user:pass@host/x',
  ]) {
    assert.equal(classifyUriSeed(url).disposition, DISPOSITIONS.credentialed, url);
  }
});

test('empty, non-string, and control-character seeds are invalid', () => {
  assert.equal(classifyUriSeed('').disposition, DISPOSITIONS.invalid);
  assert.equal(classifyUriSeed('   ').disposition, DISPOSITIONS.invalid);
  assert.equal(classifyUriSeed(null).disposition, DISPOSITIONS.invalid);
  assert.equal(classifyUriSeed(undefined).disposition, DISPOSITIONS.invalid);
  assert.equal(classifyUriSeed(42).disposition, DISPOSITIONS.invalid);
  assert.equal(classifyUriSeed('https://example.com/a\nHost: evil').disposition, DISPOSITIONS.invalid);
  assert.equal(classifyUriSeed('https://example.com/\r\nx').disposition, DISPOSITIONS.invalid);
  assert.equal(classifyUriSeed('https://example.com/\u0000').disposition, DISPOSITIONS.invalid);
});

// --- SSRF: local/remote confusion and address deny-list ---------------------

test('a file URI with a non-local host is a blocked SMB target, not a local read', () => {
  for (const url of [
    'file://attacker.example.com/etc/passwd',
    'file://10.0.0.5/share/x',
    'file://fileserver/share/secret.txt',
  ]) {
    const result = classifyUriSeed(url);
    assert.equal(result.disposition, DISPOSITIONS.blockedAddress, url);
    assert.notEqual(result.decision, DECISIONS.retrieveLocal, url);
  }
});

test('a file URI with an empty or localhost authority is still a local read', () => {
  for (const url of ['file:///etc/hosts', 'file://localhost/etc/hosts']) {
    assert.equal(classifyUriSeed(url).decision, DECISIONS.retrieveLocal, url);
  }
});

test('UNC and double-slash paths are blocked remote hosts, never local reads', () => {
  for (const seed of ['\\\\server\\share\\file', '//server/share/file']) {
    const result = classifyUriSeed(seed);
    assert.equal(result.disposition, DISPOSITIONS.blockedAddress, seed);
    assert.notEqual(result.decision, DECISIONS.retrieveLocal, seed);
  }
});

test('remote seeds pointed at loopback, private, link-local, or metadata hosts are blocked', () => {
  for (const url of [
    'http://127.0.0.1/admin',
    'http://localhost:8080/x',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.1.2.3/internal',
    'http://172.16.5.5/x',
    'http://192.168.1.1/router',
    'http://[::1]/x',
    'https://service.internal/x',
    'http://0.0.0.0/x',
    'http://foo.localhost/x',
  ]) {
    assert.equal(classifyUriSeed(url).disposition, DISPOSITIONS.blockedAddress, url);
  }
});

test('isBlockedHost is precise about public vs blocked hosts', () => {
  for (const host of ['example.com', '8.8.8.8', '1.1.1.1', 'dev.azure.com', '172.32.0.1', '11.0.0.1']) {
    assert.equal(isBlockedHost(host), false, host);
  }
  for (const host of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.0.1', '172.16.0.1', '::1', 'localhost', '', '999.1.1.1']) {
    assert.equal(isBlockedHost(host), true, host);
  }
});

// --- F1: IPv4 embedded in IPv6 must not bypass the deny-list -----------------

test('IPv4-mapped and NAT64 IPv6 hosts are blocked, not treated as remote', () => {
  for (const url of [
    'http://[::ffff:127.0.0.1]/', // IPv4-mapped loopback (Node normalizes to ::ffff:7f00:1)
    'http://[::ffff:169.254.169.254]/', // IPv4-mapped cloud metadata
    'http://[64:ff9b::7f00:1]/', // NAT64 mapping of loopback
    'http://[::127.0.0.1]/', // IPv4-compatible loopback
  ]) {
    const result = classifyUriSeed(url);
    assert.equal(result.disposition, DISPOSITIONS.blockedAddress, url);
    assert.notEqual(result.decision, DECISIONS.retrieveRemote, url);
  }
});

test('isBlockedHost decodes IPv4 embedded in IPv6, in dotted and hex forms', () => {
  for (const host of [
    '::ffff:169.254.169.254', // dotted IPv4-mapped metadata
    '::ffff:a9fe:a9fe', // hex form of the same
    '::ffff:7f00:1', // hex IPv4-mapped loopback
    '[::ffff:127.0.0.1]', // bracketed dotted IPv4-mapped loopback
    '64:ff9b::7f00:1', // NAT64 loopback
    '::127.0.0.1', // IPv4-compatible loopback
  ]) {
    assert.equal(isBlockedHost(host), true, host);
  }
});

test('an unclassifiable or reserved IPv6 form is refused conservatively', () => {
  for (const host of ['fec0::1', '4000::1', '100::1', 'nonsense::gg', '::ffff:999.1.1.1']) {
    assert.equal(isBlockedHost(host), true, host);
  }
});

test('a genuinely public IPv6 host is still allowed so the guard is not vacuous', () => {
  for (const host of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
    assert.equal(isBlockedHost(host), false, host);
  }
  assert.equal(classifyUriSeed('http://[2606:4700:4700::1111]/x').decision, DECISIONS.retrieveRemote);
});

// --- R1: 6to4 / Teredo / documentation IPv6 must not smuggle embedded IPv4 ---

test('6to4 and Teredo IPv6 wrapping private/metadata IPv4 are blocked, not public', () => {
  for (const host of [
    '2002:7f00:1::', // 6to4 wrapping 127.0.0.1 loopback
    '2002:a9fe:a9fe::', // 6to4 wrapping 169.254.169.254 cloud metadata
    '2001:0:53aa:64c:7f00:1::', // Teredo wrapping a loopback client address
    '2001:db8::1', // documentation 2001:db8::/32 — non-routable
  ]) {
    assert.equal(isBlockedHost(host), true, host);
  }
});

test('a 6to4 metadata host is refused as a blocked address end-to-end', () => {
  const result = classifyUriSeed('http://[2002:a9fe:a9fe::]/');
  assert.equal(result.disposition, DISPOSITIONS.blockedAddress);
  assert.notEqual(result.decision, DECISIONS.retrieveRemote);
});

test('public IPv6 near the Teredo/documentation ranges stays allowed (guard is not vacuous)', () => {
  // 2001:4860:4860::8888 is inside 2001::/16 but outside Teredo's 2001:0000::/32.
  assert.equal(isBlockedHost('2606:4700:4700::1111'), false);
  assert.equal(isBlockedHost('2001:4860:4860::8888'), false);
  assert.equal(classifyUriSeed('http://[2606:4700:4700::1111]/').decision, DECISIONS.retrieveRemote);
});

test('a redirect to an IPv4-mapped IPv6 metadata host is refused as a blocked address', () => {
  const result = classifyRedirect('https://example.com/a', 'http://[::ffff:169.254.169.254]/latest/meta-data/');
  assert.equal(result.disposition, DISPOSITIONS.blockedAddress);
});

// --- Scope enforcement ------------------------------------------------------

test('a local seed escaping declared roots is out of scope', () => {
  const scope = { roots: ['/repo'] };
  assert.equal(classifyUriSeed('/repo/docs/a.md', { scope }).decision, DECISIONS.retrieveLocal);
  assert.equal(classifyUriSeed('/repo/../etc/passwd', { scope }).disposition, DISPOSITIONS.outOfScope);
  assert.equal(classifyUriSeed('/etc/passwd', { scope }).disposition, DISPOSITIONS.outOfScope);
  // No declared scope leaves the dimension unconstrained here.
  assert.equal(classifyUriSeed('/etc/passwd').decision, DECISIONS.retrieveLocal);
});

test('a remote seed outside declared origins is out of scope', () => {
  const scope = { origins: ['https://dev.azure.com'] };
  assert.equal(classifyUriSeed('https://dev.azure.com/x', { scope }).decision, DECISIONS.retrieveRemote);
  assert.equal(classifyUriSeed('https://evil.example.com/x', { scope }).disposition, DISPOSITIONS.outOfScope);
});

// --- Redirect handling ------------------------------------------------------

test('a same-origin redirect may be followed', () => {
  const result = classifyRedirect('https://example.com/a', 'https://example.com/b');
  assert.equal(result.disposition, 'follow');
  assert.equal(result.target, 'https://example.com/b');
});

test('a same-origin relative redirect resolves and may be followed', () => {
  const result = classifyRedirect('https://example.com/a/b', '/c/d');
  assert.equal(result.disposition, 'follow');
  assert.equal(result.target, 'https://example.com/c/d');
});

test('a cross-origin redirect is untrusted and only surfaced as a candidate', () => {
  const cases = [
    ['https://example.com/a', 'https://evil.example.org/a'],
    ['https://example.com/a', 'https://example.com:8443/a'],
    ['https://example.com/a', 'http://example.com/a'],
    ['https://example.com/a', 'https://sub.example.com/a'],
  ];
  for (const [from, to] of cases) {
    const result = classifyRedirect(from, to);
    assert.equal(result.disposition, DISPOSITIONS.redirectUntrusted, `${from} -> ${to}`);
    assert.equal(result.candidate, new URL(to, from).href);
  }
});

test('a redirect to a blocked address is refused as a blocked address', () => {
  const result = classifyRedirect('https://example.com/a', 'http://169.254.169.254/latest/meta-data/');
  assert.equal(result.disposition, DISPOSITIONS.blockedAddress);
});

test('a redirect to a non-remote scheme is untrusted', () => {
  const result = classifyRedirect('https://example.com/a', 'file:///etc/passwd');
  assert.equal(result.disposition, DISPOSITIONS.redirectUntrusted);
});

test('a redirect with no target is unreachable', () => {
  assert.equal(classifyRedirect('https://example.com/a', '').disposition, DISPOSITIONS.unreachable);
  assert.equal(classifyRedirect('https://example.com/a', null).disposition, DISPOSITIONS.unreachable);
});

// --- Content-type handling --------------------------------------------------

test('textual content types are accepted', () => {
  for (const ct of [
    'text/plain',
    'text/markdown; charset=utf-8',
    'text/html',
    'application/json',
    'application/xml',
    'application/xhtml+xml',
    'application/vnd.custom+json',
    'text/x-anything',
  ]) {
    assert.equal(classifyContentType(ct).disposition, 'text', ct);
  }
});

test('non-text content types are refused', () => {
  for (const ct of [
    'application/octet-stream',
    'application/pdf',
    'image/png',
    'audio/mpeg',
    'video/mp4',
    'application/zip',
    'font/woff2',
  ]) {
    assert.equal(classifyContentType(ct).disposition, DISPOSITIONS.nonText, ct);
  }
});

test('a missing or non-string content type is refused, never assumed textual', () => {
  assert.equal(classifyContentType(undefined).disposition, DISPOSITIONS.nonText);
  assert.equal(classifyContentType(null).disposition, DISPOSITIONS.nonText);
  assert.equal(classifyContentType('').disposition, DISPOSITIONS.nonText);
  assert.equal(classifyContentType(123).disposition, DISPOSITIONS.nonText);
});

// --- Size bounds ------------------------------------------------------------

test('the size bound separates within-bound, empty, oversize, and unknown', () => {
  assert.equal(withinSizeBound(1024).disposition, 'within-bound');
  assert.equal(withinSizeBound(DEFAULT_MAX_BYTES).disposition, 'within-bound');
  assert.equal(withinSizeBound(0).disposition, DISPOSITIONS.empty);
  assert.equal(withinSizeBound(DEFAULT_MAX_BYTES + 1).disposition, DISPOSITIONS.tooLarge);
  assert.equal(withinSizeBound(-1).disposition, DISPOSITIONS.invalid);
  assert.equal(withinSizeBound(NaN).disposition, DISPOSITIONS.invalid);
  assert.equal(withinSizeBound('big').disposition, DISPOSITIONS.invalid);
  assert.equal(withinSizeBound(2048, 1024).disposition, DISPOSITIONS.tooLarge);
});

// --- Local body acceptance (a text file has no HTTP content type) -----------

test('a local text body is accepted as seeded-local without any content type', () => {
  const result = validateLocalBody('# a markdown design doc\n\ncontent');
  assert.equal(result.disposition, DISPOSITIONS.seededLocal);
  assert.equal(result.origin, 'seed');
});

test('a local body with a NUL byte is non-text, an empty one is empty, an oversize one is too large', () => {
  assert.equal(validateLocalBody(Buffer.from([0x41, 0x00, 0x42])).disposition, DISPOSITIONS.nonText);
  assert.equal(validateLocalBody('').disposition, DISPOSITIONS.empty);
  assert.equal(validateLocalBody(undefined).disposition, DISPOSITIONS.empty);
  assert.equal(validateLocalBody('xx', { maxBytes: 1 }).disposition, DISPOSITIONS.tooLarge);
});

// --- Remote result acceptance fails closed on missing metadata --------------

test('a well-formed remote result with no off-origin hops is seeded-remote', () => {
  const result = validateRemoteResult({
    requestedUri: 'https://example.com/doc',
    finalUri: 'https://example.com/doc',
    redirectChain: [],
    contentType: 'text/markdown',
    byteLength: 1200,
    body: '# doc',
  });
  assert.equal(result.disposition, DISPOSITIONS.seededRemote);
  assert.equal(result.origin, 'seed');
});

test('a remote result missing its redirect chain fails closed as redirect-untrusted', () => {
  assert.equal(validateRemoteResult({ finalUri: 'https://example.com/x', contentType: 'text/html', byteLength: 10, body: 'x' }).disposition, DISPOSITIONS.redirectUntrusted);
  assert.equal(validateRemoteResult({ redirectChain: [], contentType: 'text/html', byteLength: 10, body: 'x' }).disposition, DISPOSITIONS.redirectUntrusted);
  assert.equal(validateRemoteResult(null).disposition, DISPOSITIONS.unreachable);
});

test('a remote result whose chain hops off-origin is refused', () => {
  const result = validateRemoteResult({
    requestedUri: 'https://example.com/doc',
    finalUri: 'http://169.254.169.254/latest/meta-data/',
    redirectChain: [{ from: 'https://example.com/doc', to: 'http://169.254.169.254/latest/meta-data/' }],
    contentType: 'text/plain',
    byteLength: 10,
    body: 'secret',
  });
  assert.equal(result.disposition, DISPOSITIONS.blockedAddress);
});

// --- F2: post-retrieval must not fail open on the final address or the chain -

test('an empty chain with a blocked finalUri is refused, not accepted', () => {
  // F2: address safety cannot rely solely on iterating redirectChain.
  const result = validateRemoteResult({
    requestedUri: 'http://169.254.169.254/latest/meta-data/',
    finalUri: 'http://169.254.169.254/latest/meta-data/',
    redirectChain: [],
    contentType: 'text/plain',
    byteLength: 20,
    body: 'imds-token',
  });
  assert.equal(result.disposition, DISPOSITIONS.blockedAddress);
});

test('an empty chain whose finalUri differs from requestedUri is redirect-untrusted', () => {
  // F2: an empty chain must imply finalUri === requestedUri.
  const result = validateRemoteResult({
    requestedUri: 'https://example.com/a',
    finalUri: 'https://elsewhere.example.net/b',
    redirectChain: [],
    contentType: 'text/plain',
    byteLength: 10,
    body: 'ok',
  });
  assert.equal(result.disposition, DISPOSITIONS.redirectUntrusted);
});

test('a discontinuous redirect chain is refused even when every hop is same-origin', () => {
  // F2: chain continuity must be asserted, not just per-hop origin.
  const result = validateRemoteResult({
    requestedUri: 'https://example.com/a',
    finalUri: 'https://example.com/c',
    redirectChain: [
      { from: 'https://example.com/a', to: 'https://example.com/b' },
      { from: 'https://example.com/x', to: 'https://example.com/c' }, // from !== prior to
    ],
    contentType: 'text/plain',
    byteLength: 10,
    body: 'ok',
  });
  assert.equal(result.disposition, DISPOSITIONS.redirectUntrusted);
});

test('a chain not beginning at the requested URI or not ending at finalUri is refused', () => {
  // F2: the chain must span requestedUri -> ... -> finalUri.
  assert.equal(
    validateRemoteResult({
      requestedUri: 'https://example.com/a',
      finalUri: 'https://example.com/c',
      redirectChain: [{ from: 'https://example.com/b', to: 'https://example.com/c' }],
      contentType: 'text/plain',
      byteLength: 10,
      body: 'ok',
    }).disposition,
    DISPOSITIONS.redirectUntrusted,
  );
  assert.equal(
    validateRemoteResult({
      requestedUri: 'https://example.com/a',
      finalUri: 'https://example.com/c',
      redirectChain: [{ from: 'https://example.com/a', to: 'https://example.com/b' }],
      contentType: 'text/plain',
      byteLength: 10,
      body: 'ok',
    }).disposition,
    DISPOSITIONS.redirectUntrusted,
  );
});

test('a result missing requestedUri fails closed rather than accepting the body', () => {
  // F2: requestedUri is required metadata; without it continuity cannot run.
  const result = validateRemoteResult({
    finalUri: 'https://example.com/a',
    redirectChain: [],
    contentType: 'text/plain',
    byteLength: 10,
    body: 'ok',
  });
  assert.equal(result.disposition, DISPOSITIONS.redirectUntrusted);
});

test('a continuous same-origin chain landing on a public host is seeded-remote', () => {
  // F2: the legitimate multi-hop happy path still succeeds.
  const result = validateRemoteResult({
    requestedUri: 'https://example.com/a',
    finalUri: 'https://example.com/c',
    redirectChain: [
      { from: 'https://example.com/a', to: 'https://example.com/b' },
      { from: 'https://example.com/b', to: 'https://example.com/c' },
    ],
    contentType: 'text/markdown',
    byteLength: 1200,
    body: '# doc',
  });
  assert.equal(result.disposition, DISPOSITIONS.seededRemote);
});

test('a remote result that is non-text, oversize, or empty maps to the matching disposition', () => {
  const base = { requestedUri: 'https://example.com/x', finalUri: 'https://example.com/x', redirectChain: [] };
  assert.equal(validateRemoteResult({ ...base, contentType: 'image/png', byteLength: 10, body: 'x' }).disposition, DISPOSITIONS.nonText);
  assert.equal(validateRemoteResult({ ...base, contentType: 'text/plain', byteLength: DEFAULT_MAX_BYTES + 1, body: 'x' }).disposition, DISPOSITIONS.tooLarge);
  assert.equal(validateRemoteResult({ ...base, contentType: 'text/plain', byteLength: 0, body: '' }).disposition, DISPOSITIONS.empty);
  assert.equal(validateRemoteResult({ ...base, contentType: 'text/plain', byteLength: 10, body: '' }).disposition, DISPOSITIONS.empty);
});

// --- Retrieval failure mapping ----------------------------------------------

test('transport failures map to unreachable, access failures to access-denied', () => {
  for (const kind of ['network', 'dns', 'timeout', 'http-5xx', 'http-404']) {
    assert.equal(classifyRetrievalFailure(kind).disposition, DISPOSITIONS.unreachable, kind);
  }
  for (const kind of ['http-401', 'http-403', 'content-exclusion', 'auth-required']) {
    assert.equal(classifyRetrievalFailure(kind).disposition, DISPOSITIONS.accessDenied, kind);
  }
  assert.equal(classifyRetrievalFailure('something-new').disposition, DISPOSITIONS.unreachable);
  assert.equal(classifyRetrievalFailure(undefined).disposition, DISPOSITIONS.unreachable);
});

// --- Disposition completeness ----------------------------------------------

test('every disposition is a distinct, namespaced string', () => {
  const values = Object.values(DISPOSITIONS);
  assert.equal(new Set(values).size, values.length, 'dispositions must be distinct');
  for (const value of values) {
    assert.match(value, /^uri-/, `every disposition is namespaced: ${value}`);
  }
});
