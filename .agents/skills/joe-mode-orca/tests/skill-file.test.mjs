import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const directory = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(directory, name), "utf8");
const skill = read("SKILL.md");
const runtime = read("RUNTIME.md");
const run = read("RUN.md");
const automations = read("AUTOMATIONS.md");
const state = read("STATE.md");
const joe = read("../joe-mode/SKILL.md");
const normalized = (text) => text.replace(/\s+/g, " ");

const links = {
  "SKILL.md": [
    "RUNTIME.md",
    "RUN.md",
    "STATE.md",
    "../joe-mode/SKILL.md",
    "../joe-mode-paseo/TEAM.md",
    "../ship/WORKSPACE.md",
    "../squadron/LIFECYCLE.md",
    "../ship/DELIVERY.md",
    "../shepherd/OBSERVATION.md",
    "../shepherd/RECOVERY.md",
    "../joe-mode-paseo/MERGE.md",
    "../doctrine/APPLY.md",
  ],
  "RUN.md": [
    "SKILL.md",
    "RUNTIME.md",
    "STATE.md",
    "../joe-mode-paseo/TEAM.md",
    "../ship/WORKSPACE.md",
    "../squadron/LIFECYCLE.md",
    "../ship/DELIVERY.md",
    "../shepherd/OBSERVATION.md",
    "../shepherd/RECOVERY.md",
    "../joe-mode-paseo/MERGE.md",
    "../doctrine/APPLY.md",
    "../joe-mode/SKILL.md",
  ],
};

test("entrypoint permits matching machine continuation but guards activation", () => {
  assert.match(skill, /^name: joe-mode-orca$/m);
  assert.match(skill, /^disable-model-invocation: false$/m);
  assert.match(skill, /^user-invocable: true$/m);
  assert.match(skill, /HUMAN-ONLY ACTIVATION|Human-only activation guard/i);
  assert.match(skill, /matching preauthorized wake loads.*RUN\.md.*never intake/i);
  assert.match(normalized(skill), /Installation.*never activates/i);
});

test("standalone entry and pass reach all authority contracts", () => {
  for (const [file, required] of Object.entries(links)) {
    const text = read(file);
    const targets = [...text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].map(match => match[1]);
    for (const link of required) {
      assert.ok(existsSync(join(directory, link)), `${link} must resolve`);
      assert.ok(targets.includes(link), `${file} must link ${link}`);
    }
  }
});

test("runtime loads native guides and resolves one executable safely", () => {
  for (const phrase of [
    "orca skills get orchestration --full",
    "orca skills get orca-cli --full",
    "references/automations.md",
    "ORCA_CLI_COMMAND",
    "ORCA_DEV_REPO_ROOT",
    "orca-dev",
    "orca-ide",
    "bare `orca`",
    "never a shell variable",
    "Missing guides",
    "do not install, start, or silently substitute",
  ]) assert.match(normalized(runtime), new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("activation and serialization fail closed without native ownership proof", () => {
  for (const phrase of [
    "actual exclusion",
    "initialize paused",
    "complete the first pass immediately",
    "run-use.*not exclusive ownership",
    "owner JSON file alone is not a lock",
    "age-based lease stealing",
    "recurring mutations remain disabled",
    "release it on every normal exit",
  ]) assert.match(normalized(runtime), new RegExp(phrase, "i"));
});

test("scheduled passes inspect and reuse custody without initializing or resuming", () => {
  const pass = normalized(run);
  assert.match(pass, /scheduled pass never calls `init`, `resume`, `recover` or `bind`/);
  assert.match(pass, /inspect` with canonical `commonDir` and that recorded `boardPath` before any claim/);
  assert.match(pass, /Carry the returned canonical absolute `boardPath` into \*\*every\*\* subsequent helper call/);
  assert.match(pass, /absent default board does not prove there is no alternate/);
  assert.ok(pass.indexOf("owner.mjs inspect") < pass.indexOf("owner.mjs claim"));
});

test("bounded pass covers parallel budget, waits, source gates, and worker outcomes", () => {
  for (const phrase of [
    "all FIFO Delivery messages",
    "every human wait",
    "six-slot budget",
    "independent work",
    "publication is unresolved",
    "missing Discovery role does not block",
    "worker_done",
    "request-show",
    "retry-request",
    "permission denial",
    "Human merge remains default",
  ]) assert.match(normalized(`${runtime}\n${run}`), new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("pause preserves workers/history and resume is human-only", () => {
  for (const phrase of [
    "new-dispatch gate",
    "does not blanket-stop",
    "Human-only resume",
    "Stop disables and preserves history",
    "removal is separate explicit cleanup authorization",
  ]) {
    assert.match(normalized(`${run}\n${automations}`), new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.ok(run.indexOf("new-dispatch gate") < run.indexOf("disables exact owned automations"));
});

test("recurrence handshake rejects unexpected sessions and distinguishes states", () => {
  for (const phrase of [
    "disabled/manual first-run probe",
    "must not dispatch",
    "fresh unexpected identity fails closed",
    "no new Run",
    "configured, initially observed, and recurring-verified",
    "wake provenance",
    "return channel",
    "no per-developer/reviewer/coordinator timers",
  ]) assert.match(normalized(automations), new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("permissions and merge coordinator remain explicit gates", () => {
  assert.match(normalized(runtime), /human-selected modes\/features.*read back/i);
  assert.match(normalized(runtime), /Unknown cross-provider equivalence blocks launch/i);
  assert.match(skill, /MERGE/);
  assert.match(normalized(run), /Roast, CI, lint, rubber-duck, expected-head\/base/);
  assert.match(normalized(run), /Unknown gates require human clarification/);
});

test("workflow names the concrete local owner helper and its boundary", () => {
  assert.ok(existsSync(join(directory, "scripts/owner.mjs")));
  for (const text of [skill, runtime, run, automations]) {
    assert.match(text, /STATE\.md/);
  }
  assert.match(state, /scripts\/owner\.mjs/);
  assert.match(normalized(state), /one control host/);
  assert.match(normalized(state), /A local token never cancels an external process/);
});

test("small fixes use core swarm policy without a mandatory roster", () => {
  const policy = normalized(joe);
  assert.match(policy, /one visible home, one accountable owner/);
  assert.match(policy, /Small fix: implementer plus independent review, not a full roster/);
  assert.match(policy, /Add bounded specialists only when useful/);
  for (const text of [skill, run, runtime]) {
    assert.match(text, /\.\.\/joe-mode\/SKILL\.md#issue-centered-swarms/);
  }
  assert.match(joe, /^### Issue-centered swarms$/m);
});

test("complex delivery binds useful specialists and direct peers to native identities", () => {
  const contract = normalized(runtime);
  assert.match(contract, /roles actually needed/);
  for (const role of ["Design", "RED", "GREEN/Patch", "Roast", "Final verification"]) {
    assert.ok(runtime.includes(`<issue> ${role}`), `recognizable ${role} role`);
  }
  assert.match(contract, /read back the actual execution host.*Task and Dispatch IDs/);
  assert.match(contract, /exact Task\/Dispatch IDs, immutable candidate commit/);
  assert.match(contract, /send receipt is not acceptance or Task settlement/);
  assert.match(contract, /Unsupported peer messaging is an explicit capability gap/);
  assert.match(normalized(run), /PM does not relay every test\/commit exchange/);
});

test("parallel swarms retain isolated writers, capacity and shared repository roles", () => {
  assert.match(normalized(joe), /Keep TEAM's budget, reservations, shared roles and gates; every writer counts/);
  assert.match(normalized(runtime), /Additional writers use separately owned worktrees/);
  assert.match(normalized(runtime), /swarm does not create another Run or controller per issue/);
  assert.match(normalized(run), /Shared Shepherd and Discovery remain repository-wide/);
  assert.match(normalized(runtime), /native grouping or naming is unavailable.*explicit associations/);
  assert.match(normalized(runtime), /Missing placement proof blocks writes/);
});

test("review corrections stay on the original delivery and identify the candidate", () => {
  const pass = normalized(run);
  assert.match(pass, /review corrections to the existing delivery owner and PR/);
  assert.match(pass, /reviewed candidate and findings/);
  assert.match(pass, /fresh candidate evidence and applicable independent review after repair/);
  assert.match(normalized(runtime), /pin their candidate\/evidence/);
  assert.match(normalized(state), /review\/correction history/);
});

test("restart reconciles durable membership and pending handoffs before dispatch", () => {
  const facts = normalized(state);
  assert.match(facts, /stable key.*delivery:<provider-qualified-anchor>/);
  assert.match(facts, /not a new helper-enforced schema/);
  assert.match(facts, /Reuse the same key when a PR is published/);
  assert.match(facts, /note` replaces a value: read and preserve.*prior history/);
  assert.match(facts, /pending handoffs with native and provider observations before new dispatch/);
  assert.match(facts, /lost questions or unresolved effects remain explicit waits/);
  assert.match(normalized(run), /saved membership is not liveness or accepted transfer/);
  for (const stage of ["coding", "awaiting peer", "awaiting PM", "awaiting human"]) {
    assert.ok(run.includes(`\`${stage}\``), `explicit ${stage} stage`);
  }
});

test("completion and suspension retain history without idle expense or implicit cleanup", () => {
  const pass = normalized(run);
  assert.match(pass, /completion or explicit suspension.*inspectable history and evidence/);
  assert.match(pass, /Retire accepted terminal agents without concrete duties/);
  assert.match(pass, /concrete retained duty and next owner/);
  assert.match(pass, /Pending peer\/human waits must be reconciled, not erased/);
  assert.match(pass, /Agent retirement never implicitly removes branches or worktrees/);
});
