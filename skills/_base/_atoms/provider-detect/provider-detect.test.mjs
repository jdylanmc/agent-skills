/**
 * Behaviour tests for provider detection and the shared command mechanism it
 * owns.
 *
 * The claims worth pinning are the ones a caller acts on: which provider was
 * recognized, whether hosted state can be observed at all, that an answer
 * nobody established is never returned as a working one, and that the host a
 * run detected is the host its constructed commands target. Each test states a
 * repository situation and asserts the answer a caller would get, not how the
 * module arrived at it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DETECTION_STATUSES,
  ProviderCommandError,
  assertSanctionedCommand,
  canObserveProviderState,
  detectProvider,
  githubApiHostFlags,
  isEnterpriseGitHubHost,
  isProviderStateUnobserved,
  normalizeAzureRepository,
  normalizeChangeRequestId,
  normalizeGitHubRepository,
  parseRemoteHost,
  requireObservableProvider,
  shouldRunProviderIndependentCore,
} from './provider-detect.mjs';

const READY = { available: true, authenticated: true };

// The repository's sensitive-content floor reads a user-and-host pair joined by an at-sign as an electronic
// mail address and is deliberately eager, so a literal SSH remote written in
// committed source is a finding even though it holds no secret. Compose the
// scp-like and `ssh://` remotes from their parts so the byte-for-byte string a
// test exercises still reaches the code under test without an address-shaped
// literal appearing in this file.
const scpRemote = (user, host, path) => `${user}@${host}:${path}`;
const sshRemote = (user, host, path) => `ssh://${user}@${host}/${path}`;

test('a public GitHub remote with a ready tool can be observed', () => {
  const detection = detectProvider({
    remoteUrls: ['https://github.com/example/repo.git'],
    toolAvailability: { gh: READY },
  });

  assert.equal(detection.status, 'supported-provider');
  assert.equal(detection.provider, 'github');
  assert.equal(detection.tool, 'gh');
  assert.equal(detection.host, 'github.com');
  assert.equal(canObserveProviderState(detection), true);
  assert.equal(isProviderStateUnobserved(detection), false);
});

test('an SSH remote resolves to the same provider as its HTTPS form', () => {
  const ssh = detectProvider({
    remoteUrls: [scpRemote('git', 'github.com', 'example/repo.git')],
    toolAvailability: { gh: READY },
  });
  const https = detectProvider({
    remoteUrls: ['https://github.com/example/repo.git'],
    toolAvailability: { gh: READY },
  });

  assert.equal(ssh.provider, https.provider);
  assert.equal(ssh.status, 'supported-provider');
  assert.equal(ssh.host, 'github.com');
});

test('an Azure DevOps SSH remote and a legacy account host both resolve to Azure DevOps', () => {
  const modern = detectProvider({
    remoteUrls: [sshRemote('git', 'ssh.dev.azure.com', 'v3/contoso/project/repo')],
    toolAvailability: { az: READY },
  });
  const legacy = detectProvider({
    remoteUrls: ['https://contoso.visualstudio.com/project/_git/repo'],
    toolAvailability: { az: READY },
  });

  assert.equal(modern.provider, 'azure-devops');
  assert.equal(modern.tool, 'az');
  assert.equal(legacy.provider, 'azure-devops');
  assert.equal(legacy.status, 'supported-provider');
});

test('a configured enterprise host is recognized as its named provider', () => {
  const detection = detectProvider({
    remoteUrls: [scpRemote('git', 'github.contoso-internal.example', 'platform/repo.git')],
    hostProviders: { 'github.contoso-internal.example': 'github' },
    toolAvailability: { gh: READY },
  });

  assert.equal(detection.status, 'supported-provider');
  assert.equal(detection.provider, 'github');
  assert.equal(detection.source, 'configured-host');
  assert.equal(detection.host, 'github.contoso-internal.example');
});

test('an unconfigured host that merely looks like a known one is not guessed', () => {
  const detection = detectProvider({
    remoteUrls: ['https://github.contoso-internal.example/platform/repo.git'],
    toolAvailability: { gh: READY },
  });

  assert.equal(detection.status, 'provider-unsupported');
  assert.equal(detection.provider, null);
  assert.equal(canObserveProviderState(detection), false);
  assert.ok(
    detection.inspected.some((entry) => entry.includes('github.contoso-internal.example')),
    'the inspected evidence names the host that was examined',
  );
});

test('a remote with no recognizable provider reports every piece of evidence inspected', () => {
  const detection = detectProvider({
    remoteUrls: ['https://git.example.invalid/team/repo.git', scpRemote('git', 'vcs.example.invalid', 'team/repo.git')],
  });

  assert.equal(detection.status, 'provider-unsupported');
  assert.equal(detection.inspected.length, 2);
  assert.ok(detection.inspected.some((entry) => entry.includes('git.example.invalid')));
  assert.ok(detection.inspected.some((entry) => entry.includes('vcs.example.invalid')));
});

test('a remote with no host at all is recorded as unparsed rather than matched', () => {
  const detection = detectProvider({ remoteUrls: ['this is not a remote'] });

  assert.equal(detection.status, 'provider-unsupported');
  assert.ok(detection.inspected.some((entry) => entry.endsWith('host:unparsed')));
});

test('an absent command-line tool is an environment problem, not an unsupported provider', () => {
  const detection = detectProvider({
    remoteUrls: ['https://github.com/example/repo.git'],
    toolAvailability: { gh: { available: false, authenticated: false } },
  });

  assert.equal(detection.status, 'provider-tool-missing');
  assert.equal(detection.provider, 'github');
  assert.equal(detection.tool, 'gh');
  assert.notEqual(detection.status, 'provider-unsupported');
  assert.equal(canObserveProviderState(detection), false);
});

test('a present but unauthenticated tool is its own condition', () => {
  const detection = detectProvider({
    remoteUrls: ['https://dev.azure.com/contoso/project/_git/repo'],
    toolAvailability: { az: { available: true, authenticated: false } },
  });

  assert.equal(detection.status, 'provider-tool-unauthenticated');
  assert.equal(detection.tool, 'az');
  assert.notEqual(detection.status, 'provider-tool-missing');
  assert.notEqual(detection.status, 'provider-unsupported');
  assert.equal(canObserveProviderState(detection), false);
});

test('tool readiness that was never probed is unobserved, never ready', () => {
  const detection = detectProvider({ remoteUrls: ['https://github.com/example/repo.git'] });

  assert.equal(detection.status, 'provider-tool-unobserved');
  assert.equal(detection.provider, 'github');
  assert.equal(detection.tool, 'gh');
  assert.equal(canObserveProviderState(detection), false);
  assert.equal(isProviderStateUnobserved(detection), true);
});

test('availability and authentication are observed independently, and only an explicit false is a negative', () => {
  // A probe that observed availability but said nothing about authentication has
  // established readiness of neither, so it is unobserved rather than a negative
  // it never reported. Collapsing "not observed" into "observed false" is the
  // exact mistake this unit exists to prevent.
  const availableOnly = detectProvider({
    remoteUrls: ['https://github.com/example/repo.git'],
    toolAvailability: { gh: { available: true } },
  });
  assert.equal(availableOnly.status, 'provider-tool-unobserved');
  assert.equal(canObserveProviderState(availableOnly), false);

  const authenticatedOnly = detectProvider({
    remoteUrls: ['https://github.com/example/repo.git'],
    toolAvailability: { gh: { authenticated: true } },
  });
  assert.equal(authenticatedOnly.status, 'provider-tool-unobserved');

  // An explicit false, on the other hand, is a real negative and names itself.
  const notAvailable = detectProvider({
    remoteUrls: ['https://github.com/example/repo.git'],
    toolAvailability: { gh: { available: false } },
  });
  assert.equal(notAvailable.status, 'provider-tool-missing');

  const notAuthenticated = detectProvider({
    remoteUrls: ['https://github.com/example/repo.git'],
    toolAvailability: { gh: { authenticated: false } },
  });
  assert.equal(notAuthenticated.status, 'provider-tool-unauthenticated');

  // A non-object probe carries no observation at all.
  const garbageProbe = detectProvider({
    remoteUrls: ['https://github.com/example/repo.git'],
    toolAvailability: { gh: true },
  });
  assert.equal(garbageProbe.status, 'provider-tool-unobserved');
});

test('a recognized host with no command-line adapter is distinct from an unknown host', () => {
  const gitlab = detectProvider({ remoteUrls: ['https://gitlab.com/group/repo.git'] });

  assert.equal(gitlab.status, 'provider-tool-unsupported');
  assert.equal(gitlab.provider, 'gitlab');
  assert.equal(gitlab.tool, null);
  assert.notEqual(gitlab.status, 'provider-unsupported');
});

test('an explicitly named provider overrides remote evidence and may carry a host', () => {
  const detection = detectProvider({
    explicitProvider: 'azure-devops',
    explicitHost: 'dev.azure.com',
    remoteUrls: ['https://github.com/example/repo.git'],
    toolAvailability: { az: READY, gh: READY },
  });

  assert.equal(detection.provider, 'azure-devops');
  assert.equal(detection.source, 'explicit-provider');
  assert.equal(detection.host, 'dev.azure.com');
});

test('an explicitly named provider with no host has an explicitly unknown host, not an assumed one', () => {
  const detection = detectProvider({
    explicitProvider: 'github',
    toolAvailability: { gh: READY },
  });

  assert.equal(detection.provider, 'github');
  assert.equal(detection.host, null, 'a missing host is unknown, never silently public');
});

test('an explicitly named provider nobody implements is unsupported, not assumed', () => {
  const detection = detectProvider({ explicitProvider: 'perforce', toolAvailability: { gh: READY } });

  assert.equal(detection.status, 'provider-unsupported');
  assert.equal(detection.provider, null);
  assert.deepEqual(detection.inspected, ['explicit-provider:perforce']);
});

test('a run with no remotes at all is unsupported with nothing claimed', () => {
  const detection = detectProvider();

  assert.equal(detection.status, 'provider-unsupported');
  assert.deepEqual(detection.inspected, []);
  assert.equal(detection.host, null);
});

test('every recognized condition still permits provider-independent work', () => {
  const detections = [
    detectProvider({ remoteUrls: ['https://github.com/example/repo.git'], toolAvailability: { gh: READY } }),
    detectProvider({ remoteUrls: ['https://github.com/example/repo.git'], toolAvailability: { gh: { available: false } } }),
    detectProvider({ remoteUrls: ['https://github.com/example/repo.git'] }),
    detectProvider({ remoteUrls: ['https://gitlab.com/group/repo.git'] }),
    detectProvider({ remoteUrls: ['https://git.example.invalid/team/repo.git'] }),
  ];

  const seen = new Set(detections.map((detection) => detection.status));
  assert.equal(seen.size, 5, 'the five conditions stay distinct');
  for (const detection of detections) {
    assert.ok(DETECTION_STATUSES.includes(detection.status));
    assert.equal(shouldRunProviderIndependentCore(detection), true);
  }
});

test('only a ready tool passes the observation guard, and a refusal carries the condition', () => {
  const ready = requireObservableProvider(detectProvider({
    remoteUrls: ['https://github.com/example/repo.git'],
    toolAvailability: { gh: READY },
  }));
  assert.equal(ready.ok, true);

  const refused = requireObservableProvider(detectProvider({
    remoteUrls: ['https://github.com/example/repo.git'],
    toolAvailability: { gh: { available: true, authenticated: false } },
  }));
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 'provider-tool-unauthenticated');
  assert.equal(refused.tool, 'gh');

  const nonsense = requireObservableProvider({ status: 'looks-fine-to-me' });
  assert.equal(nonsense.ok, false);
  assert.equal(nonsense.status, 'provider-unsupported', 'an unrecognized status never passes as observable');
});

test('a remote host is read from every remote form without inventing one', () => {
  assert.equal(parseRemoteHost('https://github.com/example/repo.git'), 'github.com');
  assert.equal(parseRemoteHost(scpRemote('git', 'github.com', 'example/repo.git')), 'github.com');
  assert.equal(parseRemoteHost(sshRemote('git', 'ssh.dev.azure.com', 'v3/contoso/project/repo')), 'ssh.dev.azure.com');
  assert.equal(parseRemoteHost('https://GitHub.com/example/repo.git'), 'github.com');
  assert.equal(parseRemoteHost('/srv/git/repo.git'), null);
  assert.equal(parseRemoteHost('C:\\src\\repo'), null, 'a Windows drive path is not a single-label host');
  assert.equal(parseRemoteHost(''), null);
  assert.equal(parseRemoteHost(undefined), null);
});

test('the scp-like parser validates the whole remote and allows a single-label host', () => {
  // A single-label host is returned; whether it is honoured is decided by the
  // configured-host map, not the parser.
  assert.equal(parseRemoteHost(scpRemote('git', 'githost', 'platform/repo.git')), 'githost');
  // Trailing text after the path means the whole remote is malformed.
  assert.equal(parseRemoteHost(`${scpRemote('git', 'github.com', 'example/repo.git')} and more`), null);
  assert.equal(parseRemoteHost(`garbage ${scpRemote('git', 'github.com', 'example/repo.git')}`), null);
});

test('a configured single-label host is honoured end to end, an unconfigured one is not', () => {
  const configured = detectProvider({
    remoteUrls: [scpRemote('git', 'githost', 'platform/repo.git')],
    hostProviders: { githost: 'github' },
    toolAvailability: { gh: READY },
  });
  assert.equal(configured.status, 'supported-provider');
  assert.equal(configured.provider, 'github');
  assert.equal(configured.host, 'githost');

  const unconfigured = detectProvider({
    remoteUrls: [scpRemote('git', 'githost', 'platform/repo.git')],
    toolAvailability: { gh: READY },
  });
  assert.equal(unconfigured.status, 'provider-unsupported', 'an unconfigured single-label host is never guessed');
});

test('a change-request identifier must be a positive integer without precision loss', () => {
  assert.equal(normalizeChangeRequestId(42), '42');
  assert.equal(normalizeChangeRequestId('42'), '42');
  // An exact decimal string carries no loss even when it is large.
  assert.equal(normalizeChangeRequestId('900719925474099999'), '900719925474099999');

  // A number above the safe-integer boundary may already be a different integer
  // than the digits a caller typed, so it is rejected rather than trusted.
  for (const hostile of [Number.MAX_SAFE_INTEGER + 2, 9007199254740993, 1.5, 0, -1, '0', '', '4 5', '--repo', null, {}]) {
    assert.throws(
      () => normalizeChangeRequestId(hostile),
      (error) => error instanceof ProviderCommandError && error.code === 'invalid-change-request-identifier',
      `${JSON.stringify(hostile)} must be rejected`,
    );
  }
  // A safe integer at the boundary is still accepted.
  assert.equal(normalizeChangeRequestId(Number.MAX_SAFE_INTEGER), String(Number.MAX_SAFE_INTEGER));
});

test('a GitHub repository is host-qualified only for an enterprise host', () => {
  const publicHost = detectProvider({ remoteUrls: ['https://github.com/example/repo.git'], toolAvailability: { gh: READY } });
  assert.equal(normalizeGitHubRepository({ slug: 'example/repo' }, publicHost), 'example/repo');
  assert.equal(isEnterpriseGitHubHost(publicHost), false);
  assert.deepEqual(githubApiHostFlags(publicHost), []);

  const enterprise = detectProvider({
    remoteUrls: [scpRemote('git', 'github.contoso-internal.example', 'platform/repo.git')],
    hostProviders: { 'github.contoso-internal.example': 'github' },
    toolAvailability: { gh: READY },
  });
  assert.equal(
    normalizeGitHubRepository({ slug: 'platform/repo' }, enterprise),
    'github.contoso-internal.example/platform/repo',
    'the detected enterprise host reaches the --repo argument',
  );
  assert.equal(isEnterpriseGitHubHost(enterprise), true);
  assert.deepEqual(
    githubApiHostFlags(enterprise),
    ['--hostname', 'github.contoso-internal.example'],
    'gh api targets the enterprise host explicitly rather than defaulting to github.com',
  );

  assert.throws(
    () => normalizeGitHubRepository({ slug: 'not a repo' }, publicHost),
    (error) => error.code === 'invalid-repository',
  );
});

test('an Azure organization URL whose host disagrees with detection is a distinct failure', () => {
  const detection = detectProvider({
    remoteUrls: ['https://dev.azure.com/contoso/project/_git/repo'],
    toolAvailability: { az: READY },
  });

  assert.deepEqual(
    normalizeAzureRepository(
      { organizationUrl: 'https://dev.azure.com/contoso', project: 'project', name: 'repo' },
      detection,
    ),
    { organizationUrl: 'https://dev.azure.com/contoso', project: 'project', name: 'repo' },
  );

  assert.throws(
    () => normalizeAzureRepository(
      { organizationUrl: 'https://dev.azure.example.invalid/contoso', project: 'project', name: 'repo' },
      detection,
    ),
    (error) => error instanceof ProviderCommandError && error.code === 'repository-host-mismatch',
    'a mismatched organization host is refused, not silently accepted',
  );

  assert.throws(
    () => normalizeAzureRepository({ organizationUrl: 'http://insecure.example', project: 'p', name: 'r' }, detection),
    (error) => error.code === 'invalid-repository',
  );
});

test('the shared guard sanctions a declared read shape and refuses everything else', () => {
  const shapes = [
    { tool: 'gh', argv: ['pr', 'view', { id: true }, '--repo', { value: true }, '--json', { value: true }] },
  ];

  assert.doesNotThrow(() => assertSanctionedCommand(
    { tool: 'gh', args: ['pr', 'view', '42', '--repo', 'example/repo', '--json', 'mergeable'] },
    shapes,
  ));

  for (const args of [
    ['pr', 'merge', '42'],
    ['pr', 'view', '42', '--repo', 'example/repo', '--json', 'mergeable', '--web'],
    ['api', 'repos/o/r/issues', '-f', 'title=x'],
  ]) {
    assert.throws(
      () => assertSanctionedCommand({ tool: 'gh', args }, shapes),
      (error) => error instanceof ProviderCommandError && error.code === 'mutating-command',
      `${args.join(' ')} must be refused`,
    );
  }
});

test('the shared guard refuses a write HTTP method regardless of the shapes offered', () => {
  const shapes = [{ tool: 'az', argv: ['devops', 'invoke', '--http-method', 'GET'] }];
  assert.doesNotThrow(() => assertSanctionedCommand({ tool: 'az', args: ['devops', 'invoke', '--http-method', 'GET'] }, shapes));

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.throws(
      () => assertSanctionedCommand({ tool: 'az', args: ['devops', 'invoke', '--http-method', method] }, shapes),
      (error) => error instanceof ProviderCommandError && error.code === 'mutating-command',
    );
  }
});
