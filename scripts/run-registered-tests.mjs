#!/usr/bin/env node

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CANCELLED_SUMMARY = /^# cancelled (\d+)$/gm;

export function readCancelledCount(tapOutput) {
  const matches = [...tapOutput.matchAll(CANCELLED_SUMMARY)];
  if (matches.length !== 1) {
    throw new Error(
      `expected one TAP cancelled summary, found ${matches.length}`,
    );
  }
  return Number.parseInt(matches[0][1], 10);
}

export function runRegisteredTests(testFiles) {
  if (!testFiles.length) {
    throw new Error('at least one registered test file is required');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--test', '--test-reporter=tap', ...testFiles],
      { stdio: ['inherit', 'pipe', 'pipe'] },
    );
    let stdout = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal) {
        reject(new Error(`test runner terminated by signal ${signal}`));
        return;
      }

      let cancelled;
      try {
        cancelled = readCancelledCount(stdout);
      } catch (error) {
        reject(error);
        return;
      }

      if (cancelled > 0) {
        reject(new Error(`${cancelled} test(s) were cancelled`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`test runner exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

function isDirectInvocation() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  runRegisteredTests(process.argv.slice(2)).catch((error) => {
    console.error(`registered test run failed: ${error.message}`);
    process.exitCode = 1;
  });
}
