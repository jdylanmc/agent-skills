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
  writeFileSync(join(repo, ".gitignore"), "target/\nnode_modules\n");
  run(repo, "add", "-A");
  run(repo, "commit", "-q", "-m", "init");
  run(repo, "push", "-q", "-u", "origin", "main");
  return { root, repo, origin };
}

function branchWorktree(f, name, { commit = false, merge = false, push = false } = {}) {
  const path = join(f.root, name);
  run(f.repo, "worktree", "add", "-q", "-b", name, path, "main");
  if (commit) {
    writeFileSync(join(path, `${name}.txt`), name);
    run(path, "add", "-A");
    run(path, "commit", "-q", "-m", name);
  }
  if (push) run(path, "push", "-q", "origin", name);
  if (merge) {
    run(f.repo, "merge", "-q", "--no-ff", "-m", `merge ${name}`, name);
    run(f.repo, "push", "-q", "origin", "main");
  }
  return realpathSync(path);
}

const decide = rows => Object.fromEntries(rows.map(row => [row.branch, row.decision]));
const quiet = { pr: false, size: false };

test("parses worktree porcelain", () => {
  const rows = parseWorktrees("worktree /a\nHEAD abc\nbranch refs/heads/main\n\nworktree /b\nHEAD def\ndetached\nlocked reason\n");
  assert.deepEqual(rows.map(row => [row.path, row.branch, row.detached, row.locked]),
    [["/a", "main", false, false], ["/b", undefined, true, true]]);
});

test("removes only merged, clean worktrees and keeps the rest with a reason", () => {
  const f = fixture();
  branchWorktree(f, "merged", { commit: true, merge: true });
  branchWorktree(f, "dirty", { commit: true, merge: true });
  writeFileSync(join(f.root, "dirty", "scratch.txt"), "x");
  branchWorktree(f, "unmerged", { commit: true });
  const rows = plan({ repo: f.repo, ...quiet });
  assert.deepEqual(decide(rows), { merged: "remove", dirty: "keep", unmerged: "keep" });
  assert.match(rows.find(row => row.branch === "dirty").reason, /uncommitted/);
  assert.match(rows.find(row => row.branch === "unmerged").reason, /not merged|unknown/);
});

test("dry run changes nothing; apply removes the worktree and its merged branch", () => {
  const f = fixture();
  const merged = branchWorktree(f, "merged", { commit: true, merge: true });
  const keep = branchWorktree(f, "keep", { commit: true });
  const rows = plan({ repo: f.repo, ...quiet });
  assert.ok(existsSync(merged));
  const results = apply(rows, { repo: f.repo });
  assert.equal(results[0].branch, "deleted");
  assert.ok(!existsSync(merged));
  assert.ok(existsSync(keep));
  assert.equal(run(f.repo, "branch", "--list", "merged"), "");
  assert.notEqual(run(f.repo, "branch", "--list", "keep"), "");
});

test("never touches the current worktree or the main checkout", () => {
  const f = fixture();
  const current = branchWorktree(f, "current", { commit: true, merge: true });
  const rows = plan({ repo: current, ...quiet });
  assert.equal(rows.find(row => row.branch === "current").decision, "keep");
  assert.equal(rows.find(row => row.branch === "current").reason, "current or main checkout");
  assert.ok(!rows.some(row => row.path === f.repo));
});

test("a squash-merged PR is removed only when the PR head equals the local head", () => {
  const f = fixture();
  const path = branchWorktree(f, "squashed", { commit: true });
  const head = run(path, "rev-parse", "HEAD");
  const merged = plan({ repo: f.repo, size: false, pr: () => ({ number: 7, state: "MERGED", headRefOid: head }) });
  assert.equal(merged[0].decision, "remove");
  assert.equal(merged[0].force, true);
  const moved = plan({ repo: f.repo, size: false, pr: () => ({ number: 7, state: "MERGED", headRefOid: "0".repeat(40) }) });
  assert.equal(moved[0].decision, "keep");
});

test("a closed PR is removed only when its commits are on a remote", () => {
  const f = fixture();
  const pushed = branchWorktree(f, "pushed", { commit: true, push: true });
  const local = branchWorktree(f, "local", { commit: true });
  const closed = path => ({ number: 9, state: "CLOSED", headRefOid: run(path, "rev-parse", "HEAD") });
  const rows = plan({ repo: f.repo, size: false, pr: branch => closed(branch === "pushed" ? pushed : local) });
  assert.deepEqual(decide(rows), { pushed: "remove", local: "keep" });
});

test("build output is removed only from named, clean worktrees, never through a symlink", () => {
  const f = fixture();
  const idle = branchWorktree(f, "idle", { commit: true });
  const dirty = branchWorktree(f, "dirtybuild", { commit: true });
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "keep.txt"), "x");
  for (const path of [idle, dirty]) {
    mkdirSync(join(path, "target"));
    writeFileSync(join(path, "target", "o"), "x");
  }
  symlinkSync(outside, join(idle, "node_modules"));
  writeFileSync(join(dirty, "edit.txt"), "x");
  const rows = plan({ repo: f.repo, ...quiet });
  const results = apply(rows, { repo: f.repo, cleanBuild: [idle, dirty] });
  assert.ok(!existsSync(join(idle, "target")));
  assert.ok(existsSync(join(idle, "node_modules")), "symlink left alone");
  assert.ok(existsSync(join(outside, "keep.txt")));
  assert.ok(existsSync(join(dirty, "target")), "dirty worktree is not touched");
  assert.deepEqual(results.map(result => result.path), [idle]);
});

test("a vanished worktree directory is pruned", () => {
  const f = fixture();
  const gone = branchWorktree(f, "gone", { commit: true });
  rmSync(gone, { recursive: true });
  const rows = plan({ repo: f.repo, ...quiet });
  assert.equal(rows[0].decision, "prune");
  apply(rows, { repo: f.repo });
  assert.ok(!run(f.repo, "worktree", "list", "--porcelain").includes("gone"));
});
