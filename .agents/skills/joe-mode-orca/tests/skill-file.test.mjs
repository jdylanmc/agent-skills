import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const directory = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(directory, name), "utf8");
const skill = read("SKILL.md");
const intent = read("intent.md");
const runtime = read("RUNTIME.md");
const run = read("RUN.md");
const automations = read("AUTOMATIONS.md");
const policy = `${runtime}\n${run}`;

test("entrypoint is human-only and does not activate on install", () => {
  assert.match(skill, /^name: joe-mode-orca$/m);
  assert.match(skill, /^disable-model-invocation: true$/m);
  assert.match(skill, /^user-invocable: true$/m);
  assert.match(skill, /Installing this skill never activates/i);
  assert.match(intent, /Joe-mode-Orca is my opt-in, repository-bound engineering team coordinator running on Orca\./);
});

test("adapter links existing Joe policy instead of cloning it", () => {
  for (const link of [
    "../joe-mode/SKILL.md",
    "../squadron/LIFECYCLE.md",
    "../ship/DELIVERY.md",
    "../shepherd/RECOVERY.md",
    "../shepherd/OBSERVATION.md",
    "../setup/INVOCATION.md",
  ]) {
    assert.ok(existsSync(join(directory, link)), `${link} must resolve`);
    assert.match(skill, new RegExp(link.replaceAll(".", "\\.")));
  }
  assert.match(skill, /not another project\s+management policy or controller/i);
});

test("native lifecycle and capacity rules are explicit", () => {
  for (const text of [
    "run-create",
    "worker-start",
    "worker-release",
    "request-show",
    "task ID and dispatch ID",
    /send\s+receipt proves enqueue/i,
    "six-slot capacity",
    "features reserve two",
    "fixes, hardening, and refactors reserve one",
    "one logical repository controller",
  ]) assert.match(policy, text instanceof RegExp ? text : new RegExp(text, "i"));
});

test("recurrence fails closed across setup, reuse, pause, and stop", () => {
  for (const text of [
    "--disabled",
    "--workspace-mode existing",
    "--reuse-session",
    "unexpected identity fails closed",
    "configured state, initial observation, and verified recurrence",
    /disable only exact\s+owned automation IDs/i,
    "No auto-resume",
  ]) {
    assert.match(
      automations,
      text instanceof RegExp
        ? text
        : new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    );
  }
});

test("each PM pass observes before routing and preserves human gates", () => {
  assert.match(run, /Observe and reconcile/);
  assert.match(run, /Read the oldest FIFO Delivery batch/);
  assert.match(run, /Route one useful next step/);
  assert.match(run, /Changed requirements, architecture, or\s+irreducible semantics return to Discovery and the human/);
  assert.match(run, /Human merging remains the\s+default/);
});
