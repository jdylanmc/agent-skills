#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORKFLOW_EXTENSIONS = new Set(['.yml', '.yaml']);
const TAP_SUMMARY = /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) (.+)$/gm;

function indentOf(line) {
  const match = /^ */.exec(line);
  return match[0].length;
}

function stripComment(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('#') ? '' : line;
}

function unquoteScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseBlockScalar(lines, startIndex, runIndent, style) {
  const collected = [];
  let index = startIndex + 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      collected.push('');
      continue;
    }
    const indent = indentOf(line);
    if (indent <= runIndent) {
      break;
    }
    collected.push(line.slice(Math.min(indent, runIndent + 2)));
  }

  const chomp = style.endsWith('-') ? 'strip' : 'clip';
  const kind = style[0];
  let command;
  if (kind === '>') {
    command = collected
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join(' ');
  } else {
    command = collected.join('\n');
  }
  if (chomp !== 'strip' && command.length > 0) {
    command += '\n';
  }
  return { command, nextIndex: index - 1 };
}

function parseRunValue(lines, index, rawValue, runIndent) {
  const value = rawValue.trim();
  if (/^[>|][+-]?$/.test(value)) {
    return parseBlockScalar(lines, index, runIndent, value);
  }
  return { command: unquoteScalar(value), nextIndex: index };
}

function parseInlineStepFields(text) {
  const fields = {};
  const name = /\bname:\s*([^,]+?)(?=\s+\w+:|$)/.exec(text);
  const uses = /\buses:\s*(\S+)/.exec(text);
  const run = /\brun:\s*(.+)$/.exec(text);
  if (name) {
    fields.name = unquoteScalar(name[1]);
  }
  if (uses) {
    fields.uses = uses[1];
  }
  if (run) {
    fields.run = run[1];
  }
  return fields;
}

export function discoverGitHubActionsCommands(workflowContent, workflowPath) {
  const lines = workflowContent.replace(/\r\n/g, '\n').split('\n');
  const commands = [];
  const providerActions = [];
  let inJobs = false;
  let currentJob = null;
  let inSteps = false;
  let currentStep = null;

  const flushStep = () => {
    currentStep = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = stripComment(lines[index]);
    if (!line.trim()) {
      continue;
    }
    const indent = indentOf(line);
    const trimmed = line.trim();

    if (indent === 0 && trimmed === 'jobs:') {
      inJobs = true;
      currentJob = null;
      inSteps = false;
      flushStep();
      continue;
    }
    if (indent === 0 && trimmed.endsWith(':') && trimmed !== 'jobs:') {
      inJobs = false;
      currentJob = null;
      inSteps = false;
      flushStep();
      continue;
    }
    if (!inJobs) {
      continue;
    }

    const jobMatch = /^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(line);
    if (jobMatch) {
      currentJob = jobMatch[1];
      inSteps = false;
      flushStep();
      continue;
    }
    if (!currentJob) {
      continue;
    }

    if (indent === 4 && trimmed === 'steps:') {
      inSteps = true;
      flushStep();
      continue;
    }
    if (indent <= 4 && !trimmed.startsWith('-') && !trimmed.startsWith('steps:')) {
      inSteps = false;
      flushStep();
    }
    if (!inSteps) {
      continue;
    }

    const stepMatch = /^ {6}-\s*(.*)$/.exec(line);
    if (stepMatch) {
      flushStep();
      currentStep = {
        workflow: workflowPath,
        job: currentJob,
        stepIndex: commands.length + providerActions.length + 1,
        name: null,
        shell: null,
      };
      const inline = parseInlineStepFields(stepMatch[1]);
      if (inline.name) {
        currentStep.name = inline.name;
      }
      if (inline.uses) {
        providerActions.push({ ...currentStep, uses: inline.uses });
        flushStep();
      } else if (inline.run) {
        const parsed = parseRunValue(lines, index, inline.run, indent + 2);
        commands.push({ ...currentStep, command: parsed.command });
        index = parsed.nextIndex;
        flushStep();
      }
      continue;
    }
    if (!currentStep || indent < 8) {
      continue;
    }

    const field = /^ {8}([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (!field) {
      continue;
    }
    const [, key, rawValue] = field;
    if (key === 'name') {
      currentStep.name = unquoteScalar(rawValue);
    } else if (key === 'shell') {
      currentStep.shell = unquoteScalar(rawValue);
    } else if (key === 'uses') {
      providerActions.push({ ...currentStep, uses: rawValue.trim() });
      flushStep();
    } else if (key === 'run') {
      const parsed = parseRunValue(lines, index, rawValue, indent);
      commands.push({
        ...currentStep,
        name: currentStep.name ?? `run step ${commands.length + 1}`,
        command: parsed.command,
      });
      index = parsed.nextIndex;
      flushStep();
    }
  }

  return { provider: 'github-actions', workflow: workflowPath, commands, providerActions };
}

export function discoverRepositoryCi(repositoryRoot, options = {}) {
  const workflowRoot = path.join(repositoryRoot, '.github', 'workflows');
  const workflowPaths = [];
  if (options.workflowPath) {
    workflowPaths.push(path.resolve(repositoryRoot, options.workflowPath));
  } else if (fs.existsSync(workflowRoot)) {
    for (const entry of fs.readdirSync(workflowRoot, { withFileTypes: true })) {
      if (entry.isFile() && WORKFLOW_EXTENSIONS.has(path.extname(entry.name))) {
        workflowPaths.push(path.join(workflowRoot, entry.name));
      }
    }
  }

  if (workflowPaths.length === 0) {
    return {
      provider: 'unsupported-provider',
      inspected: [path.relative(repositoryRoot, workflowRoot).split(path.sep).join('/')],
      commands: [],
      providerActions: [],
      repository: repositoryState(repositoryRoot),
    };
  }

  const commands = [];
  const providerActions = [];
  const inspected = [];
  for (const workflowPath of workflowPaths.sort()) {
    const relative = path.relative(repositoryRoot, workflowPath).split(path.sep).join('/');
    inspected.push(relative);
    const discovered = discoverGitHubActionsCommands(
      fs.readFileSync(workflowPath, 'utf8'),
      relative,
    );
    commands.push(...discovered.commands);
    providerActions.push(...discovered.providerActions);
  }

  return {
    provider: commands.length > 0 ? 'github-actions' : 'unsupported-provider',
    inspected,
    commands,
    providerActions,
    repository: repositoryState(repositoryRoot),
  };
}

function repositoryState(repositoryRoot) {
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  const status = spawnSync('git', ['status', '--short'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  return {
    root: repositoryRoot,
    revision: revision.status === 0 ? revision.stdout.trim() : null,
    dirtyState: status.status === 0 && status.stdout.trim()
      ? status.stdout.trim().split('\n')
      : [],
  };
}

function sameRepositoryState(left, right) {
  return left?.root === right?.root
    && left?.revision === right?.revision
    && JSON.stringify(left?.dirtyState) === JSON.stringify(right?.dirtyState);
}

export function parseNodeTapSummary(output) {
  const summary = {};
  for (const match of output.matchAll(TAP_SUMMARY)) {
    const key = match[1] === 'duration_ms' ? 'duration_ms' : match[1];
    const numeric = Number(match[2]);
    summary[key] = Number.isFinite(numeric) ? numeric : match[2];
  }
  return summary;
}

function missingTool(stderr, code) {
  if (code === 127 || code === 9009) {
    return true;
  }
  return /command not found|not recognized as|No such file or directory/i.test(stderr);
}

export function classifyAttempt(receipt) {
  const tap = parseNodeTapSummary(`${receipt.stdout}\n${receipt.stderr}`);
  if (receipt.signal) {
    return { classification: 'cancelled', tap };
  }
  if (Number(tap.cancelled ?? 0) > 0) {
    return { classification: 'cancelled', tap };
  }
  if (receipt.startError || missingTool(receipt.stderr, receipt.exitCode)) {
    return { classification: 'environment-failed', tap };
  }
  if (receipt.exitCode === 0) {
    return { classification: 'passed', tap };
  }
  return { classification: 'failed', tap };
}

function runCommand(command, cwd, declaredShell) {
  return new Promise((resolve) => {
    const startedAt = new Date();
    const child = spawn(command, {
      cwd,
      shell: declaredShell || true,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      const completedAt = new Date();
      resolve({
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        elapsedMs: completedAt.getTime() - startedAt.getTime(),
        exitCode: null,
        signal: null,
        startError: error.message,
        stdout,
        stderr,
      });
    });
    child.on('close', (exitCode, signal) => {
      const completedAt = new Date();
      resolve({
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        elapsedMs: completedAt.getTime() - startedAt.getTime(),
        exitCode,
        signal,
        startError: null,
        stdout,
        stderr,
      });
    });
  });
}

export async function runDiscoveredCi(repositoryRoot, discovery) {
  const executionRoot = fs.realpathSync(repositoryRoot);
  const discoveredRoot = discovery?.repository?.root
    ? fs.realpathSync(discovery.repository.root)
    : null;
  if (discoveredRoot !== executionRoot) {
    throw new Error('execution root does not match the discovered repository snapshot');
  }
  const beforeExecution = repositoryState(repositoryRoot);
  if (!sameRepositoryState(beforeExecution, discovery.repository)) {
    throw new Error('repository state changed after CI discovery');
  }
  if (discovery.provider === 'unsupported-provider') {
    return {
      ...discovery,
      status: 'unsupported-provider',
      evidenceComplete: false,
      steps: [],
    };
  }

  const steps = [];
  let incomplete = false;

  for (const command of discovery.commands) {
    if (incomplete) {
      steps.push({ ...command, status: 'skipped', reason: 'prior step did not complete successfully' });
      continue;
    }

    const attempts = [];
    const first = await runCommand(command.command, repositoryRoot, command.shell);
    const firstClassified = { ...first, ...classifyAttempt(first), retry: false };
    attempts.push(firstClassified);

    let finalClassification = firstClassified.classification;
    if (firstClassified.classification === 'failed') {
      const retry = await runCommand(command.command, repositoryRoot, command.shell);
      const retryClassified = { ...retry, ...classifyAttempt(retry), retry: true };
      attempts.push(retryClassified);
      finalClassification = retryClassified.classification === 'passed'
        ? 'intermittent'
        : retryClassified.classification;
    }

    steps.push({ ...command, status: finalClassification, attempts });
    if (!['passed', 'intermittent'].includes(finalClassification)) {
      incomplete = true;
    }
  }

  const statuses = new Set(steps.map((step) => step.status));
  let status = 'passed';
  if (statuses.has('environment-failed')) {
    status = 'environment-failed';
  } else if (statuses.has('cancelled')) {
    status = 'cancelled';
  } else if (statuses.has('failed')) {
    status = 'failed';
  } else if (statuses.has('intermittent')) {
    status = 'intermittent';
  }
  if (steps.some((step) => step.status === 'skipped')) {
    status = status === 'passed' ? 'incomplete' : status;
  }
  const afterExecution = repositoryState(repositoryRoot);
  if (!sameRepositoryState(afterExecution, discovery.repository)) {
    throw new Error('repository state changed during CI execution');
  }

  return {
    provider: discovery.provider,
    inspected: discovery.inspected,
    providerActions: discovery.providerActions,
    repository: structuredClone(discovery.repository),
    status,
    evidenceComplete: !steps.some((step) => step.status === 'skipped'),
    steps,
  };
}

function usage() {
  return [
    'Usage: node skills/run-ci/_atoms/ci-runner/ci-runner.mjs [--discover|--run] [--json] [--workflow <path>]',
    '',
    'Discovers GitHub Actions run steps from the repository root. --run executes them locally.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { mode: 'discover', json: false, workflowPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--discover') {
      options.mode = 'discover';
    } else if (arg === '--run') {
      options.mode = 'run';
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--workflow') {
      options.workflowPath = argv[index + 1];
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function isDirectInvocation() {
  if (!process.argv[1]) {
    return false;
  }
  return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const repositoryRoot = process.cwd();
  const discovery = discoverRepositoryCi(repositoryRoot, options);
  const result = options.mode === 'run'
    ? await runDiscoveredCi(repositoryRoot, discovery)
    : discovery;

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.provider === 'unsupported-provider') {
    console.log(`unsupported-provider: inspected ${result.inspected.join(', ')}`);
  } else {
    for (const command of result.commands ?? []) {
      console.log(`${command.workflow} :: ${command.job} :: ${command.name ?? 'unnamed'}\n${command.command}\n`);
    }
  }

  if (result.provider === 'unsupported-provider') {
    process.exitCode = 2;
  } else if (result.status && !['passed', 'intermittent'].includes(result.status)) {
    process.exitCode = 1;
  }
}

if (isDirectInvocation()) {
  main().catch((error) => {
    console.error(`run-ci helper failed: ${error.message}`);
    process.exitCode = 1;
  });
}
