import { lstatSync, realpathSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const USAGE = `Usage: node worktree-hygiene.mjs [--repo <dir>] [--no-size]
         [--apply [--remove <worktree>]... [--clean-build <worktree>]...] [--json]

Lists linked worktrees and says which are removable. Dry run unless --apply.
Nothing is removed unless you name it with --remove (or --clean-build for build
output), and the helper re-checks it first. A worktree is removable only when
its PR is merged, or closed with the exact commit on a live remote ref, and it
has no uncommitted, untracked, or unexpected ignored files, no running process,
and is not the main or current checkout. Anything uncertain is kept.`;

// Rebuildable output and OS noise. Any other ignored file may be local data.
const BUILD_DIRS = ["target", "node_modules"];
const DISPOSABLE = new Set([...BUILD_DIRS, ".DS_Store"]);

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

// Returns the PR object, null when there is none, undefined when it cannot be read.
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

// Live remote tips, never the cached remote-tracking refs. null means unverifiable.
function liveRemoteTips(repo) {
  const out = git(repo, ["ls-remote", "origin"], { allowFail: true });
  return out === null ? null : out.split("\n").filter(Boolean).map(line => line.split("\t")[0]);
}

// Working directories of every running process. null means the check is unavailable.
function processDirectories() {
  let out;
  try {
    out = execFileSync("lsof", ["-d", "cwd", "-Fn"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 });
  } catch (error) {
    // lsof exits 1 when it could not read some processes but still lists the rest.
    out = error.stdout ? String(error.stdout) : null;
  }
  return out === null ? null : out.split("\n").filter(line => line.startsWith("n")).map(line => line.slice(1));
}

function inside(path, parent) {
  return path === parent || path.startsWith(parent + sep);
}

function commitOnRemote(repo, head, tips) {
  if (tips === null) return false;
  return tips.some(tip => tip === head
    || (git(repo, ["cat-file", "-e", `${tip}^{commit}`], { allowFail: true }) !== null
      && git(repo, ["merge-base", "--is-ancestor", head, tip], { allowFail: true }) !== null));
}

export function plan(options = {}) {
  const toplevel = realpathSync(git(resolve(options.repo ?? process.cwd()), ["rev-parse", "--show-toplevel"]));
  const worktrees = parseWorktrees(git(toplevel, ["worktree", "list", "--porcelain"]));
  const main = realpathSync(worktrees[0].path);
  const here = realpathSync(options.cwd ?? process.cwd());
  const lookup = options.pr ?? (branch => ghPullRequest(toplevel, branch));
  const tips = options.remoteTips === undefined ? liveRemoteTips(toplevel) : options.remoteTips;
  const processes = options.processes === undefined ? processDirectories() : options.processes;

  return worktrees.slice(1).map(entry => {
    const row = { path: entry.path, branch: entry.branch ?? null, head: entry.head, pr: null, dirty: null, ignored: [],
      sizeKb: null, build: [], guard: null, decision: "keep", reason: "" };
    const keep = (guard, reason) => ({ ...row, guard, reason });
    if (entry.prunable) return { ...row, decision: "prune", guard: "gone", reason: "directory is gone; git worktree prune clears the record" };
    const path = realpathSync(entry.path);
    row.path = path;
    if (path === main || inside(here, path) || path === toplevel) return keep("current", "main checkout, or the directory this command runs from");
    if (entry.locked) return keep("locked", "locked");
    const status = git(path, ["status", "--porcelain", "--ignored"], { allowFail: true });
    if (status === null) return keep("unreadable", "cannot read git status");
    const lines = status.split("\n").filter(Boolean);
    row.dirty = lines.some(line => !line.startsWith("!!"));
    row.ignored = lines.filter(line => line.startsWith("!!")).map(line => line.slice(3).replace(/\/$/, ""));
    if (options.size !== false) {
      row.sizeKb = sizeKb(path);
      row.build = BUILD_DIRS.map(name => ({ name, kb: sizeKb(join(path, name)) })).filter(item => item.kb);
    }
    if (row.dirty) return keep("dirty", "uncommitted or untracked changes");
    if (processes === null) return keep("unverified", "cannot verify that no process is running in it");
    if (processes.some(directory => inside(directory, path))) return keep("active", "a process is running in it");
    // Build output is checked on its own; removal needs the stricter checks below.
    const extras = row.ignored.filter(name => !DISPOSABLE.has(name.split("/")[0]));
    if (extras.length > 0) return { ...row, reason: `ignored local files would be lost: ${extras.slice(0, 3).join(", ")}${extras.length > 3 ? ", ..." : ""}` };

    const pr = entry.branch ? lookup(entry.branch) : null;
    row.pr = pr ? { number: pr.number, state: pr.state } : null;
    if (pr === undefined) return { ...row, reason: "PR state unknown" };
    if (pr === null) return { ...row, reason: "no PR to prove it is finished" };
    if (pr.state === "OPEN") return { ...row, reason: "PR open" };
    if (pr.headRefOid !== entry.head) return { ...row, reason: `commits after the ${pr.state.toLowerCase()} PR head` };
    if (pr.state === "MERGED") return { ...row, decision: "removable", reason: "PR merged, local head equals the PR head" };
    if (pr.state === "CLOSED" && commitOnRemote(toplevel, entry.head, tips)) {
      return { ...row, decision: "removable", reason: "PR closed, the exact commit is on a live remote ref" };
    }
    return { ...row, reason: pr.state === "CLOSED" ? "PR closed, but the commit is not verified on a live remote" : `PR ${pr.state}` };
  });
}

function removeBuildOutput(repo, worktree) {
  const removed = [];
  for (const name of BUILD_DIRS) {
    const target = join(worktree, name);
    let info;
    try { info = lstatSync(target); } catch { continue; }
    if (info.isSymbolicLink() || !info.isDirectory()) continue;
    if (!realpathSync(target).startsWith(worktree + sep)) continue;
    // Only untracked, ignored output is disposable. Tracked files under it are source.
    if (git(worktree, ["ls-files", "--", name], { allowFail: true }) !== "") continue;
    if (git(worktree, ["check-ignore", "-q", "--", name], { allowFail: true }) === null) continue;
    rmSync(target, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

// Re-reads the worktree immediately before every destructive step: a plan can be stale.
export function apply(planned, options = {}) {
  const repo = realpathSync(git(resolve(options.repo ?? process.cwd()), ["rev-parse", "--show-toplevel"]));
  const results = [];
  const fresh = path => plan({ ...options, size: false }).find(row => row.path === realpathSync(path));
  for (const requested of options.remove ?? []) {
    const before = planned.find(row => row.path === realpathSync(requested));
    const now = fresh(requested);
    if (!before || !now) { results.push({ path: requested, skipped: "not a linked worktree of this repository" }); continue; }
    if (now.decision !== "removable" || now.head !== before.head) {
      results.push({ path: now.path, skipped: now.decision !== "removable" ? now.reason : "HEAD changed since the plan" });
      continue;
    }
    git(repo, ["worktree", "remove", now.path]);
    // Delete the branch only if it still points at the commit that was proven finished.
    const branch = now.branch && git(repo, ["update-ref", "-d", `refs/heads/${now.branch}`, now.head], { allowFail: true }) !== null
      ? "deleted" : "kept";
    results.push({ path: now.path, removed: true, branch, freedKb: before.sizeKb });
  }
  for (const requested of options.cleanBuild ?? []) {
    const now = fresh(requested);
    if (!now || now.guard !== null) { results.push({ path: requested, skipped: now ? now.reason : "not a linked worktree of this repository" }); continue; }
    results.push({ path: now.path, build: removeBuildOutput(repo, now.path) });
  }
  if (planned.some(row => row.decision === "prune") && (options.prune ?? true)) git(repo, ["worktree", "prune"]);
  return results;
}

function parseArguments(argv) {
  const options = { remove: [], cleanBuild: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repo") options.repo = argv[++index];
    else if (argument === "--no-size") options.size = false;
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--remove") options.remove.push(argv[++index]);
    else if (argument === "--clean-build") options.cleanBuild.push(argv[++index]);
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`unknown argument: ${argument}`);
  }
  if ((options.remove.length > 0 || options.cleanBuild.length > 0) && !options.apply) throw new Error("--remove and --clean-build need --apply");
  if (options.apply && options.remove.length === 0 && options.cleanBuild.length === 0) throw new Error("--apply needs --remove <worktree> or --clean-build <worktree>; nothing is removed unless you name it");
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
    console.log(`${row.decision.toUpperCase().padEnd(9)} ${gb(row.sizeKb).padStart(8)}  ${row.branch ?? "(detached)"}  [${pr}]  ${row.path}\n          ${row.reason}`);
  }
  const removable = rows.filter(row => row.decision === "removable");
  console.log(`\n${rows.length} linked worktrees; ${removable.length} removable (${gb(removable.reduce((total, row) => total + (row.sizeKb ?? 0), 0))}).`);
  if (!options.apply) console.log("Dry run. Name what you own: --apply --remove <worktree> [--clean-build <worktree>].");
  for (const result of results) {
    if (result.skipped) console.log(`skipped ${result.path}: ${result.skipped}`);
    else console.log(result.build ? `build output removed in ${result.path}: ${result.build.join(", ") || "none"}` : `removed ${result.path} (branch ${result.branch})`);
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
