import { lstatSync, realpathSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const USAGE = `Usage: node worktree-hygiene.mjs [--repo <dir>] [--base <ref>] [--fetch] [--no-pr] [--no-size]
         [--apply] [--clean-build --path <worktree>]... [--json]

Lists linked worktrees with branch, PR state, dirty status and size, and decides
which are finished. Dry run unless --apply. Never touches the main checkout, the
current worktree, a dirty or locked worktree, or one whose commits are not safely
on a remote or merged.`;

const BUILD_DIRS = ["target", "node_modules"];

function git(cwd, args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFail) return null;
    throw error;
  }
}

export function parseWorktrees(porcelain) {
  return porcelain.split("\n\n").filter(Boolean).map(block => {
    const entry = { locked: false, prunable: false, detached: false };
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) entry.path = line.slice(9);
      else if (line.startsWith("HEAD ")) entry.head = line.slice(5);
      else if (line.startsWith("branch ")) entry.branch = line.slice(7).replace(/^refs\/heads\//, "");
      else if (line === "detached") entry.detached = true;
      else if (line.startsWith("locked")) entry.locked = true;
      else if (line.startsWith("prunable")) entry.prunable = true;
    }
    return entry;
  });
}

function sizeKb(path) {
  try {
    return Number.parseInt(execFileSync("du", ["-sk", path], { encoding: "utf8" }).split(/\s/)[0], 10);
  } catch {
    return null;
  }
}

function ghPullRequest(repo, branch) {
  try {
    const out = execFileSync("gh", ["pr", "list", "--head", branch, "--state", "all", "--limit", "5",
      "--json", "number,state,headRefOid"], { cwd: repo, encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "ignore"] });
    const prs = JSON.parse(out);
    return prs.find(pr => pr.state === "OPEN") ?? prs[0] ?? null;
  } catch {
    return undefined;
  }
}

export function plan(options = {}) {
  const start = resolve(options.repo ?? process.cwd());
  const toplevel = realpathSync(git(start, ["rev-parse", "--show-toplevel"]));
  const base = options.base ?? "origin/main";
  if (options.fetch) git(toplevel, ["fetch", "--quiet", "--prune", "origin"]);
  const worktrees = parseWorktrees(git(toplevel, ["worktree", "list", "--porcelain"]));
  const main = realpathSync(worktrees[0].path);
  const lookup = options.pr === false ? () => undefined : options.pr ?? (branch => ghPullRequest(toplevel, branch));
  const baseKnown = git(toplevel, ["rev-parse", "--verify", "--quiet", base], { allowFail: true }) !== null;

  return worktrees.slice(1).map(entry => {
    const row = { path: entry.path, branch: entry.branch ?? null, head: entry.head, pr: null, dirty: false, sizeKb: null,
      build: [], decision: "keep", reason: "" };
    if (entry.prunable) return { ...row, decision: "prune", reason: "directory is gone; git worktree prune clears it" };
    const path = realpathSync(entry.path);
    row.path = path;
    if (path === toplevel || path === main) return { ...row, reason: "current or main checkout" };
    if (entry.locked) return { ...row, reason: "locked" };
    const status = git(path, ["status", "--porcelain"], { allowFail: true });
    if (status === null) return { ...row, reason: "cannot read status" };
    row.dirty = status.length > 0;
    if (options.size !== false) {
      row.sizeKb = sizeKb(path);
      row.build = BUILD_DIRS.map(name => ({ name, kb: sizeKb(join(path, name)) })).filter(item => item.kb);
    }
    if (row.dirty) return { ...row, reason: "uncommitted or untracked changes" };

    const pr = entry.branch ? lookup(entry.branch) : undefined;
    row.pr = pr ? { number: pr.number, state: pr.state } : null;
    const merged = baseKnown && git(path, ["merge-base", "--is-ancestor", entry.head, base], { allowFail: true }) !== null;
    const prMerged = pr?.state === "MERGED" && pr.headRefOid === entry.head;
    const prClosed = pr?.state === "CLOSED" && pr.headRefOid === entry.head;
    const onRemote = (git(path, ["branch", "--remote", "--contains", entry.head], { allowFail: true }) ?? "").length > 0;
    if (merged || prMerged) return { ...row, decision: "remove", reason: merged ? `merged into ${base}` : "PR merged", force: !merged };
    if (prClosed && onRemote) return { ...row, decision: "remove", reason: "PR closed, commits on a remote" };
    if (pr?.state === "OPEN") return { ...row, reason: "PR open" };
    return { ...row, reason: pr === undefined ? "not merged; PR state unknown" : "commits not merged or on a remote" };
  });
}

function removeBuildOutput(worktree) {
  const removed = [];
  for (const name of BUILD_DIRS) {
    const target = join(worktree, name);
    let info;
    try { info = lstatSync(target); } catch { continue; }
    if (info.isSymbolicLink() || !info.isDirectory()) continue;
    if (!realpathSync(target).startsWith(worktree + sep)) continue;
    rmSync(target, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

export function apply(rows, options = {}) {
  const repo = realpathSync(git(resolve(options.repo ?? process.cwd()), ["rev-parse", "--show-toplevel"]));
  const results = [];
  for (const row of rows.filter(item => item.decision === "remove")) {
    git(repo, ["worktree", "remove", row.path]);
    let branch = "kept";
    if (row.branch) {
      const deleted = git(repo, ["branch", "-d", row.branch], { allowFail: true }) !== null
        || (row.force && git(repo, ["branch", "-D", row.branch], { allowFail: true }) !== null);
      branch = deleted ? "deleted" : "kept";
    }
    results.push({ path: row.path, removed: true, branch, freedKb: row.sizeKb });
  }
  if (rows.some(item => item.decision === "prune")) git(repo, ["worktree", "prune"]);
  const wanted = new Set((options.cleanBuild ?? []).map(path => realpathSync(path)));
  for (const row of rows.filter(item => wanted.has(item.path))) {
    const protectedRow = row.dirty || row.decision === "remove" || row.reason === "current or main checkout" || row.reason === "locked";
    if (!protectedRow) results.push({ path: row.path, build: removeBuildOutput(row.path) });
  }
  return results;
}

function parseArguments(argv) {
  const options = { cleanBuild: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repo") options.repo = argv[++index];
    else if (argument === "--base") options.base = argv[++index];
    else if (argument === "--fetch") options.fetch = true;
    else if (argument === "--no-pr") options.pr = false;
    else if (argument === "--no-size") options.size = false;
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--clean-build") options.wantsBuild = true;
    else if (argument === "--path") options.cleanBuild.push(argv[++index]);
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (options.wantsBuild && options.cleanBuild.length === 0) throw new Error("--clean-build needs at least one --path <worktree>");
  if (options.cleanBuild.length > 0 && !options.wantsBuild) throw new Error("--path is only used with --clean-build");
  return options;
}

const gb = kb => (kb === null || kb === undefined ? "?" : `${(kb / 1048576).toFixed(1)} GB`);

export function main(argv) {
  const options = parseArguments(argv);
  if (options.help) return console.log(USAGE);
  const rows = plan(options);
  const results = options.apply ? apply(rows, options) : [];
  if (options.json) return console.log(JSON.stringify({ dryRun: !options.apply, rows, results }, null, 2));
  for (const row of rows) {
    const pr = row.pr ? `#${row.pr.number} ${row.pr.state}` : "no PR";
    console.log(`${row.decision.toUpperCase().padEnd(6)} ${gb(row.sizeKb).padStart(8)}  ${row.branch ?? "(detached)"}  [${pr}${row.dirty ? ", dirty" : ""}]  ${row.path}\n       ${row.reason}`);
  }
  const removable = rows.filter(row => row.decision === "remove");
  const reclaim = removable.reduce((total, row) => total + (row.sizeKb ?? 0), 0);
  console.log(`\n${rows.length} linked worktrees. ${options.apply ? "Removed" : "Would remove"} ${removable.length} (${gb(reclaim)}).`);
  if (!options.apply) console.log("Dry run. Add --apply to remove them.");
  for (const result of results) {
    console.log(result.build ? `build output removed in ${result.path}: ${result.build.join(", ") || "none"}` : `removed ${result.path} (branch ${result.branch})`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
