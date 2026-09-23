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
const joe = readFileSync(join(directory, "../joe-mode/SKILL.md"), "utf8");
const joeRuntime = readFileSync(join(directory, "../joe-mode/RUNTIME.md"), "utf8");
const worktrees = readFileSync(join(directory, "../joe-mode/WORKTREES.md"), "utf8");
const invocation = readFileSync(join(directory, "../setup/INVOCATION.md"), "utf8");

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
  assert.match(runtime, /messagingInstalled/);
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
  assert.match(runtime, /controller's `follow-up` subcommand is\s+unsupported for interactive workers/);
  assert.match(runtime, /native `\/maestro` peer messages are the\s+supported separate follow-up channel/);
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

test("Joe delegates CMUX role launch and messaging to the established framework", () => {
  assert.match(runtime, /\/cmux-maestro-native:cmux-maestro-orchestrate/);
  assert.match(runtime, /global `\/maestro` guide/);
  assert.match(runtime, /maestro_peers/);
  assert.match(runtime, /maestro_send/);
  assert.match(joeRuntime, /managed role workers launch through Maestro/);
  assert.match(runtime, /Generic harness task IDs are not Maestro worker or peer addresses/);
  assert.match(runtime, /do not prepare disposable proof fixtures/);
  assert.doesNotMatch(runtime, /does not supply[\s\S]{0,80}machine-readable worker/);
});

test("native registration is not messaging adoption or automatic repair", () => {
  assert.match(runtime, /Registration[\s\S]*does \*\*not\*\* give it a native\s+messaging address/);
  assert.match(runtime, /If tools are absent, retain this human conversation as PM/);
  assert.match(runtime, /Do not restart, adopt, replace, or spawn\s+a new coordinator merely to obtain an address/);
  assert.match(runtime, /Existing\/unmanaged sessions and legacy bounded workers are not\s+automatically adopted/);
  assert.match(runtime, /Do not\s+install or refresh global skills automatically/);
  assert.match(invocation, /Registration alone does\s+not make a coordinator a messaging recipient/);
});

test("peer routing and delivery limits remain distinct from Joe acceptance", () => {
  for (const field of ["workspaceId", "sessionId", "generation"]) {
    assert.ok(runtime.includes(`\`${field}\``), field);
  }
  assert.match(runtime, /4096 UTF-8 bytes/);
  assert.match(runtime, /received envelope's exact `sender`/);
  assert.match(runtime, /local\s+write attempt; delivery and completion are unconfirmed/);
  assert.match(runtime, /No automatic retries/);
  assert.match(runtime, /no[\s\S]*custom busy scheduler/);
  assert.match(runtime, /not accepted work,\s+human approval, or custody transfer/);
  assert.match(runtime, /Never inspect\s+private bindings/);
  assert.match(runtime, /independent of visual focus, app activation, and sidebar\s+visibility/);
});

test("YOLO is explicit coordinator-only and does not invent inherited grants", () => {
  assert.match(runtime, /explicitly human-approved coordinator `spawn --yolo`/);
  assert.match(runtime, /preserving denies/);
  assert.match(runtime, /never a default, inferred permission inheritance/);
  assert.match(runtime, /Worker actors cannot request YOLO for descendants/);
});

test("unsupported layout and proposed lifecycle do not widen capabilities", () => {
  assert.match(runtime, /main lifecycle guide currently has no such placement clause/);
  assert.match(runtime, /matching sentence alone is not\s+runtime proof/);
  assert.match(layout, /do not patch\s+the installed guide or bypass its rule/);
  assert.match(runtime, /proposed Roster\/Stage exit-and-close UX is not an installed lifecycle/);
});

test("both entrypoints bind PM, Discovery and merger to distinct role worktrees", () => {
  assert.match(joe, /\[role worktree placement\]\(WORKTREES.md\)/);
  assert.match(skill, /\[Joe role worktrees\]\(\.\.\/joe-mode\/WORKTREES.md\)/);
  for (const text of [joe, skill, runtime, layout, invocation, worktrees]) {
    for (const roleBranch of ["main", "discovery/<feat>", "pr-sniper"]) {
      assert.ok(text.includes(`\`${roleBranch}\``), `missing ${roleBranch}`);
    }
  }
  assert.match(worktrees, /Every repository-backed Discovery agent/);
  assert.match(worktrees, /even\s+when its current pass is read-only/);
  assert.match(worktrees, /All cockpit roles remain in the existing CMUX workspace/);
  assert.match(worktrees, /spawn --cwd/);
  assert.match(worktrees, /Placement grants no merge permission/);
});

test("main advancement is guarded and never mutates another active writer", () => {
  assert.match(worktrees, /At activation, before a new dispatch pass, and after each confirmed merge/);
  assert.match(worktrees, /fetch origin main/);
  assert.match(worktrees, /merge --ff-only refs\/remotes\/origin\/main/);
  assert.match(worktrees, /clean\s+\(including untracked work\)/);
  assert.match(worktrees, /local `main` is an ancestor/);
  assert.match(worktrees, /local main is ahead or diverged, dirty/);
  assert.match(worktrees, /Never reset, stash, rebase, force-checkout/);
  assert.match(worktrees, /must not rebase another active writer's worktree/);
  assert.match(worktrees, /Verify branch and resulting tip/);
  assert.match(worktrees, /reconcile that checkout rather than forcing a second checkout/);
});
