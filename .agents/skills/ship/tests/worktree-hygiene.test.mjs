import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, test } from "node:test";
import { apply, parseWorktrees, plan } from "../scripts/worktree-hygiene.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function run(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "worktree-hygiene-")));
  roots.push(root);
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, repo], { stdio: "ignore" });
  run(repo, "checkout", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a\n");
  writeFileSync(join(repo, ".gitignore"), "target/\nnode_modules\n.env.local\n*.db\n");
  run(repo, "add", "-A");
  run(repo, "commit", "-q", "-m", "init");
  run(repo, "push", "-q", "-u", "origin", "main");
  return { root, repo, origin };
}

function worktree(f, name, { commit = true, push = false } = {}) {
  const path = join(f.root, name);
  run(f.repo, "worktree", "add", "-q", "-b", name, path, "main");
  if (commit) {
    writeFileSync(join(path, `${name}.txt`), name);
    run(path, "add", "-A");
    run(path, "commit", "-q", "-m", name);
  }
  if (push) run(path, "push", "-q", "origin", name);
  return realpathSync(path);
}

const head = path => run(path, "rev-parse", "HEAD");
const prState = (state, path) => () => ({ number: 1, state, headRefOid: head(path) });
// Injected evidence: no running processes, and the live remote has these tips.
const quiet = (extra = {}) => ({ size: false, processes: [], remoteTips: [], cwd: tmpdir(), ...extra });
const only = rows => rows.map(row => [row.branch, row.decision]);

test("parses worktree porcelain", () => {
  const rows = parseWorktrees("worktree /a\nHEAD abc\nbranch refs/heads/main\n\nworktree /b\nHEAD def\ndetached\nlocked reason\n");
  assert.deepEqual(rows.map(row => [row.path, row.branch, row.detached, row.locked]),
    [["/a", "main", false, false], ["/b", undefined, true, true]]);
});

test("a merged PR whose head equals the local head is removable", () => {
  const f = fixture();
  const path = worktree(f, "done");
  const [row] = plan({ repo: f.repo, ...quiet({ pr: prState("MERGED", path) }) });
  assert.equal(row.decision, "removable");
});

test("a fresh branch with no PR is kept, even though its commit is reachable from main", () => {
  const f = fixture();
  worktree(f, "fresh", { commit: false });
  const [row] = plan({ repo: f.repo, ...quiet({ pr: () => null }) });
  assert.equal(row.decision, "keep");
  assert.match(row.reason, /no PR/);
});

test("an open PR keeps its worktree even when the commit is merged into main", () => {
  const f = fixture();
  const path = worktree(f, "open");
  run(f.repo, "merge", "-q", "--no-ff", "-m", "m", "open");
  run(f.repo, "push", "-q", "origin", "main");
  const [row] = plan({ repo: f.repo, ...quiet({ pr: prState("OPEN", path) }) });
  assert.equal(row.decision, "keep");
  assert.equal(row.reason, "PR open");
});

test("unknown PR state keeps the worktree", () => {
  const f = fixture();
  worktree(f, "unknown");
  const [row] = plan({ repo: f.repo, ...quiet({ pr: () => undefined }) });
  assert.equal(row.decision, "keep");
  assert.match(row.reason, /unknown/);
});

test("ignored local data blocks removal, and tracked-ignored build output does not", () => {
  const f = fixture();
  const data = worktree(f, "data");
  const build = worktree(f, "build");
  writeFileSync(join(data, ".env.local"), "SECRET=1");
  writeFileSync(join(data, "local.db"), "rows");
  mkdirSync(join(build, "target"));
  writeFileSync(join(build, "target", "o"), "x");
  const rows = plan({ repo: f.repo, ...quiet({ pr: branch => ({ number: 1, state: "MERGED", headRefOid: head(branch === "data" ? data : build) }) }) });
  assert.deepEqual(only(rows).sort(), [["build", "removable"], ["data", "keep"]]);
  assert.match(rows.find(row => row.branch === "data").reason, /ignored local files would be lost: .*\.env\.local/);
});

test("a running process in the worktree keeps it, and an unverifiable check keeps it too", () => {
  const f = fixture();
  const path = worktree(f, "busy");
  const merged = prState("MERGED", path);
  assert.match(plan({ repo: f.repo, ...quiet({ pr: merged, processes: [join(path, "sub")] }) })[0].reason, /process is running/);
  assert.match(plan({ repo: f.repo, ...quiet({ pr: merged, processes: null }) })[0].reason, /cannot verify/);
});

test("the directory the command runs from is protected, whatever --repo says", () => {
  const f = fixture();
  const path = worktree(f, "here");
  mkdirSync(join(path, "deep"));
  const [row] = plan({ repo: f.repo, ...quiet({ pr: prState("MERGED", path), cwd: join(path, "deep") }) });
  assert.equal(row.decision, "keep");
  assert.equal(row.guard, "current");
});

test("a closed PR is removable only when a live remote ref contains the exact commit", () => {
  const f = fixture();
  const path = worktree(f, "closed", { push: true });
  const closed = prState("CLOSED", path);
  assert.equal(plan({ repo: f.repo, ...quiet({ pr: closed, remoteTips: [head(path)] }) })[0].decision, "removable");
  assert.equal(plan({ repo: f.repo, ...quiet({ pr: closed, remoteTips: [] }) })[0].decision, "keep");
  assert.equal(plan({ repo: f.repo, ...quiet({ pr: closed, remoteTips: null }) })[0].decision, "keep");
});

test("a stale remote-tracking ref is not evidence: deleting the remote branch keeps the work", () => {
  const f = fixture();
  const path = worktree(f, "gone", { push: true });
  run(f.repo, "push", "-q", "origin", "--delete", "gone");
  const [row] = plan({ repo: f.repo, size: false, processes: [], cwd: tmpdir(), pr: prState("CLOSED", path) });
  assert.equal(row.decision, "keep", "live ls-remote no longer shows the commit");
});

test("apply removes only what is named, and keeps everything else", () => {
  const f = fixture();
  const named = worktree(f, "named");
  const other = worktree(f, "other");
  const options = quiet({ pr: branch => prState("MERGED", branch === "named" ? named : other)() });
  const rows = plan({ repo: f.repo, ...options });
  const results = apply(rows, { repo: f.repo, ...options, remove: [named] });
  assert.equal(results[0].branch, "deleted");
  assert.ok(!existsSync(named));
  assert.ok(existsSync(other), "removable but not named, so untouched");
  assert.notEqual(run(f.repo, "branch", "--list", "other"), "");
});

test("a commit made after the plan blocks removal and keeps the branch", () => {
  const f = fixture();
  const path = worktree(f, "stale");
  const options = quiet({ pr: () => ({ number: 1, state: "MERGED", headRefOid: head(path) }) });
  const rows = plan({ repo: f.repo, ...options });
  writeFileSync(join(path, "later.txt"), "new work");
  run(path, "add", "-A");
  run(path, "commit", "-q", "-m", "later");
  const results = apply(rows, { repo: f.repo, ...options, remove: [path] });
  assert.match(results[0].skipped, /commits after|HEAD changed/);
  assert.ok(existsSync(path));
  assert.notEqual(run(f.repo, "branch", "--list", "stale"), "");
});

test("a branch that moved after the removal check is not deleted", () => {
  const f = fixture();
  const path = worktree(f, "moved");
  const planned = head(path);
  run(path, "switch", "-q", "--detach");
  run(f.repo, "worktree", "remove", "--force", path);
  writeFileSync(join(f.repo, "x.txt"), "x");
  run(f.repo, "add", "-A");
  run(f.repo, "commit", "-q", "-m", "x");
  assert.equal(run(f.repo, "update-ref", "refs/heads/moved", run(f.repo, "rev-parse", "HEAD")), "");
  assert.throws(() => run(f.repo, "update-ref", "-d", "refs/heads/moved", planned), "expected-old-value protects a moved branch");
});

test("build output is removed only from named, clean worktrees, never through a symlink or from tracked files", () => {
  const f = fixture();
  const idle = worktree(f, "idle");
  const dirty = worktree(f, "dirtybuild");
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "keep.txt"), "x");
  for (const path of [idle, dirty]) {
    mkdirSync(join(path, "target"));
    writeFileSync(join(path, "target", "o"), "x");
  }
  symlinkSync(outside, join(idle, "node_modules"));
  writeFileSync(join(dirty, "edit.txt"), "x");
  const options = quiet({ pr: () => null });
  const results = apply(plan({ repo: f.repo, ...options }), { repo: f.repo, ...options, cleanBuild: [idle, dirty] });
  assert.ok(!existsSync(join(idle, "target")));
  assert.ok(existsSync(join(idle, "node_modules")), "symlink left alone");
  assert.ok(existsSync(join(outside, "keep.txt")));
  assert.ok(existsSync(join(dirty, "target")), "dirty worktree untouched");
  assert.match(results[1].skipped, /uncommitted/);
});

test("tracked source under a build-output name is never deleted", () => {
  const f = fixture();
  const path = worktree(f, "tracked");
  mkdirSync(join(path, "node_modules"));
  writeFileSync(join(path, "node_modules", "src.js"), "tracked");
  run(path, "add", "-f", "node_modules/src.js");
  run(path, "commit", "-q", "-m", "track");
  const options = quiet({ pr: () => null });
  const results = apply(plan({ repo: f.repo, ...options }), { repo: f.repo, ...options, cleanBuild: [path] });
  assert.deepEqual(results[0].build, []);
  assert.ok(existsSync(join(path, "node_modules", "src.js")));
});

test("unreadable git status blocks everything, including build cleanup", () => {
  const f = fixture();
  const path = worktree(f, "broken");
  mkdirSync(join(path, "target"));
  writeFileSync(join(f.repo, ".git", "worktrees", "broken", "index"), "not an index");
  const options = quiet({ pr: () => null });
  const rows = plan({ repo: f.repo, ...options });
  assert.equal(rows[0].guard, "unreadable");
  const results = apply(rows, { repo: f.repo, ...options, cleanBuild: [path] });
  assert.match(results[0].skipped, /cannot read git status/);
  assert.ok(existsSync(join(path, "target")));
});

test("a vanished worktree directory is pruned", () => {
  const f = fixture();
  const gone = worktree(f, "gone2");
  rmSync(gone, { recursive: true });
  const rows = plan({ repo: f.repo, ...quiet() });
  assert.equal(rows[0].decision, "prune");
  apply(rows, { repo: f.repo, ...quiet() });
  assert.ok(!run(f.repo, "worktree", "list", "--porcelain").includes("gone2"));
});
