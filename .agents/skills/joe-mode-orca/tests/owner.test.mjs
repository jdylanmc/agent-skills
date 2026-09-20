import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { test } from "node:test";
import * as owner from "../scripts/owner.mjs";

const script = fileURLToPath(new URL("../scripts/owner.mjs", import.meta.url));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "joe-orca-owner-"));
  const commonDir = join(root, "common");
  const repo = join(root, "repo");
  return { repo, commonDir, controlHost: "host-a", coordinator: "pm-a", run: "run-a" };
}
function setup(input = fixture()) {
  mkdirSync(input.commonDir, { recursive: true });
  return input;
}
function call(name, input) {
  const result = spawnSync(process.execPath, [script, name, JSON.stringify(input)], { encoding: "utf8" });
  return { ...result, value: result.status === 0 ? JSON.parse(result.stdout) : null };
}

test("inspect is read-only and init preserves unrelated board fields", () => {
  const input = setup();
  assert.equal(owner.inspect(input).status, "uninitialized");
  owner.init({ ...input, mode: "session" });
  const path = join(input.commonDir, "joe-owner.json");
  const board = JSON.parse(readFileSync(path, "utf8"));
  board.unrelated = { preserved: true };
  writeFileSync(path, JSON.stringify(board));
  assert.equal(owner.init({ ...input, mode: "session" }).status, "already_initialized");
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).unrelated, { preserved: true });
});

test("init refuses conflict, corrupt, and symlink state", () => {
  const input = setup();
  owner.init({ ...input, mode: "session" });
  assert.throws(() => owner.init({ ...input, coordinator: "other", mode: "session" }), /conflict/);
  writeFileSync(join(input.commonDir, "joe-owner.json"), "{");
  assert.throws(() => owner.inspect(input), /corrupt/);
  const second = setup();
  symlinkSync(join(input.commonDir, "joe-owner.json"), join(second.commonDir, "joe-owner.json"));
  assert.throws(() => owner.inspect({ ...second }), /symlink/);
});

test("paused resume claim guard record reconcile release lifecycle", () => {
  const input = setup();
  owner.init({ ...input, mode: "session" });
  assert.throws(() => owner.claim(input), /status/);
  owner.resume(input);
  const claim = owner.claim(input);
  assert.equal(owner.assert({ ...input, token: claim.token }).status, "authorized");
  assert.equal(owner.record({ ...input, token: claim.token, operationId: "op-1", intent: "dispatch" }).status, "recorded");
  assert.throws(() => owner.release({ ...input, token: claim.token }), /unresolved/);
  owner.reconcile({ ...input, operationId: "op-1", status: "accepted" });
  assert.equal(owner.release({ ...input, token: claim.token }).status, "released");
  assert.throws(() => owner.assert({ ...input, token: claim.token }), /stale/);
});

test("two real processes race and only one claim succeeds", () => {
  const input = setup();
  owner.init({ ...input, mode: "session" });
  owner.resume(input);
  const args = JSON.stringify(input);
  const children = [0, 1].map(() => spawn(process.execPath, [script, "claim", args], { encoding: "utf8" }));
  const results = children.map((child) => new Promise((resolve) => {
    let out = ""; let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("close", (code) => resolve({ code, out, err }));
  }));
  return Promise.all(results).then((values) => {
    assert.equal(values.filter((value) => value.code === 0).length, 1);
    assert.equal(values.filter((value) => value.code !== 0 && value.err.includes("busy")).length, 1);
  });
});

test("pause invalidates token and recovery requires human proof and transfers coordinator", () => {
  const input = setup();
  owner.init({ ...input, mode: "session" });
  owner.resume(input);
  const claim = owner.claim(input);
  owner.pause({ ...input, reason: "human pause" });
  assert.throws(() => owner.assert({ ...input, token: claim.token }), /stale|paused/);
  assert.throws(() => owner.recover({ ...input, previousCoordinator: input.coordinator, newCoordinator: "pm-b" }), /human authority|blocked/);
  const recovered = owner.recover({ ...input, previousCoordinator: input.coordinator, newCoordinator: "pm-b", authority: "human-1", reconciled: true, previousReleased: true });
  assert.equal(recovered.status, "recovered");
  assert.equal(owner.inspect({ ...input, coordinator: "pm-b" }).board.orca.identity.coordinator, "pm-b");
});

test("wrong host and unresolved operation survive restart as explicit blocks", () => {
  const input = setup();
  owner.init({ ...input, mode: "session" });
  owner.resume(input);
  const claim = owner.claim(input);
  owner.record({ ...input, token: claim.token, operationId: "op-2", intent: "worker-start" });
  assert.throws(() => owner.assert({ ...input, controlHost: "host-b", token: claim.token }), /identity mismatch/);
  assert.throws(() => owner.claim(input), /active pass|status/);
  assert.throws(() => owner.resume({ ...input, controlHost: "host-b" }), /identity mismatch/);
});

test("known foreign enabled or leased Joe state blocks Orca activation", () => {
  const input = setup();
  writeFileSync(join(input.commonDir, "joe-owner.json"), JSON.stringify({
    pm: { mode: "enabled", lease: null },
    unrelated: "kept",
  }));
  assert.throws(() => owner.inspect(input), /another Joe adapter/);
  assert.throws(() => owner.init({ ...input, mode: "session" }), /another Joe adapter/);
});
