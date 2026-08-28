/**
 * Behaviour tests for provider detection.
 *
 * The claims worth pinning are the ones a caller acts on: which provider was
 * recognized, whether hosted state can be observed at all, and — most
 * importantly — that an answer nobody established is never returned as a
 * working one. Each test states a repository situation and asserts the answer a
 * caller would get, not how the module arrived at it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DETECTION_STATUSES,
  canObserveProviderState,
  detectProvider,
  isProviderStateUnobserved,
  parseRemoteHost,
  requireObservableProvider,
  shouldRunProviderIndependentCore,
} from './provider-detect.mjs';

const READY = { available: true, authenticated: true };

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
    remoteUrls: ['git@github.com:example/repo.git'],
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
    remoteUrls: ['ssh://git@ssh.dev.azure.com/v3/contoso/project/repo'],
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
    remoteUrls: ['git@github.contoso-internal.example:platform/repo.git'],
    hostProviders: { 'github.contoso-internal.example': 'github' },
    toolAvailability: { gh: READY },
  });

  assert.equal(detection.status, 'supported-provider');
  assert.equal(detection.provider, 'github');
  assert.equal(detection.source, 'configured-host');
  assert.equal(detection.host, 'github.contoso-internal.example');
});

test('an unconfigured host that merely looks like a known one is not guessed', () => {
  // A self-hosted deployment lives on an arbitrary hostname. Matching one that
  // resembles a public host would produce a confident command against the
  // wrong provider, which is the failure that reads as success.
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
    remoteUrls: ['https://git.example.invalid/team/repo.git', 'git@vcs.example.invalid:team/repo.git'],
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
  // The regression this pins: an unprobed tool must not default to working.
  // Assuming readiness turns "we never looked" into "everything is fine".
  const detection = detectProvider({ remoteUrls: ['https://github.com/example/repo.git'] });

  assert.equal(detection.status, 'provider-tool-unobserved');
  assert.equal(detection.provider, 'github');
  assert.equal(detection.tool, 'gh');
  assert.equal(canObserveProviderState(detection), false);
  assert.equal(isProviderStateUnobserved(detection), true);
});

test('a partially reported probe is treated as not ready', () => {
  const detection = detectProvider({
    remoteUrls: ['https://github.com/example/repo.git'],
    toolAvailability: { gh: { available: true } },
  });

  assert.equal(detection.status, 'provider-tool-unauthenticated');
  assert.equal(canObserveProviderState(detection), false);
});

test('a recognized host with no command-line adapter is distinct from an unknown host', () => {
  const gitlab = detectProvider({ remoteUrls: ['https://gitlab.com/group/repo.git'] });

  assert.equal(gitlab.status, 'provider-tool-unsupported');
  assert.equal(gitlab.provider, 'gitlab');
  assert.equal(gitlab.tool, null);
  assert.notEqual(gitlab.status, 'provider-unsupported');
});

test('an explicitly named provider overrides remote evidence', () => {
  const detection = detectProvider({
    explicitProvider: 'azure-devops',
    remoteUrls: ['https://github.com/example/repo.git'],
    toolAvailability: { az: READY, gh: READY },
  });

  assert.equal(detection.provider, 'azure-devops');
  assert.equal(detection.source, 'explicit-provider');
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
  assert.equal(parseRemoteHost('git@github.com:example/repo.git'), 'github.com');
  assert.equal(parseRemoteHost('ssh://git@ssh.dev.azure.com/v3/contoso/project/repo'), 'ssh.dev.azure.com');
  assert.equal(parseRemoteHost('https://GitHub.com/example/repo.git'), 'github.com');
  assert.equal(parseRemoteHost('/srv/git/repo.git'), null);
  assert.equal(parseRemoteHost('C:\\src\\repo'), null);
  assert.equal(parseRemoteHost(''), null);
  assert.equal(parseRemoteHost(undefined), null);
});
