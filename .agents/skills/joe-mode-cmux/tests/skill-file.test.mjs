import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = readFileSync(join(directory, "SKILL.md"), "utf8");
const layout = readFileSync(join(directory, "LAYOUT.md"), "utf8");
const runtime = readFileSync(join(directory, "RUNTIME.md"), "utf8");
const intent = readFileSync(join(directory, "intent.md"), "utf8");

test("entrypoint is explicitly human-only and session-bound", () => {
  assert.match(skill, /^name: joe-mode-cmux$/m);
  assert.match(skill, /^disable-model-invocation: true$/m);
  assert.match(skill, /^user-invocable: true$/m);
  assert.match(skill, /Human activation only/i);
  assert.match(skill, /Do not promise work between turns or after the session ends/i);
});

test("adapter preserves one Joe controller and existing delivery policy", () => {
  assert.match(skill, /one logical controller per repository/i);
  assert.match(skill, /not another project-management policy/i);
  assert.match(skill, /Ship, Patch, Refactor, Roast/i);
  assert.match(skill, /merge boundaries/i);
});

test("Maestro launches fail closed on dedicated settings", () => {
  assert.match(runtime, /launch-settings/);
  assert.match(runtime, /accountPinned/);
  assert.match(runtime, /modelPinned/);
  assert.match(runtime, /accountAvailable/);
  assert.match(runtime, /--require-pinned-launch-settings/);
  assert.match(runtime, /Never substitute/i);
  assert.match(runtime, /If that clause is absent[\s\S]*do not move their surfaces/i);
  assert.match(runtime, /CMUXMaestroPreview\/Copilot\/plugin\/skills\/cmux-maestro-orchestrate\/SKILL\.md/);
  for (const flag of ["--name", "--icon", "--color"]) assert.match(runtime, new RegExp(flag));
});

test("layout keeps role areas, developer tabs, worktrees, and chosen icons", () => {
  const diagram = layout.match(/```text\n([\s\S]*?)\n```/)?.[1] ?? "";
  for (const role of ["Project Manager", "Discovery", "Developers", "Support"]) {
    assert.match(diagram, new RegExp(role), `${role} must have a prescribed area`);
  }
  assert.match(layout, /developer surface in one developer pane as a tab/i);
  assert.match(layout, /separate Git worktrees/i);
  assert.match(layout, /md-meditation/);
  assert.match(layout, /seti-bicep/);
  assert.match(layout, /md-shield_check_outline/);
});

test("runtime is honest about interaction and continuity", () => {
  assert.match(runtime, /must not use[\s\S]*send-key/i);
  assert.match(runtime, /Programmatic follow-up[\s\S]*unsupported/i);
  assert.match(runtime, /no cron, heartbeat, recurring wake, or unattended pass/i);
  assert.match(runtime, /Restored CMUX panes are visual continuity only/i);
  assert.match(intent, /Restored panes do not prove supervision/i);
});

test("layout scopes Maestro spawn placement and preserves human focus", () => {
  assert.match(layout, /spawn/);
  assert.match(layout, /split-off/);
  assert.match(layout, /move-surface/);
  assert.match(layout, /--focus false/);
  assert.match(layout, /another workspace\/window/i);
  assert.match(layout, /placement capability passes/i);
  assert.match(layout, /Preserve any existing human-set custom title and color/i);
  assert.match(layout, /cmux rename-tab --surface <returned-surface> "Ready"/);
});

test("workspace presentation uses the correct CMUX command family", () => {
  assert.match(layout, /cmux workspace-action[\s\S]*--action rename/);
  assert.match(layout, /cmux workspace-action[\s\S]*--action set-color --color Teal/);
});
