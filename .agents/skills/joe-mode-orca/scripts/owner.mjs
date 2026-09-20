import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, renameSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const VERSION = 1;
const MODES = new Set(["session", "recurring"]);

function error(code, message) {
  const result = new Error(message);
  result.code = code;
  return result;
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) throw error("invalid", `${label} is required`);
  return value;
}

function identity(input) {
  return {
    repo: text(input.repo, "repo"),
    commonDir: resolve(text(input.commonDir, "commonDir")),
    controlHost: text(input.controlHost, "controlHost"),
    coordinator: text(input.coordinator, "coordinator"),
    run: text(input.run, "run"),
  };
}

function same(a, b) {
  return a && b && a.repo === b.repo && a.commonDir === b.commonDir &&
    a.controlHost === b.controlHost && a.coordinator === b.coordinator && a.run === b.run;
}

function boardPath(input) {
  if (input.boardPath !== undefined) {
    const path = resolve(text(input.boardPath, "boardPath"));
    if (!isAbsolute(path)) throw error("invalid", "boardPath must be absolute");
    return path;
  }
  return resolve(text(input.commonDir, "commonDir"), "joe-owner.json");
}

function validatePath(path, allowMissing = true) {
  if (existsSync(path)) {
    if (lstatSync(path).isSymbolicLink()) throw error("unsafe", `symlink refused: ${path}`);
    if (!lstatSync(path).isFile()) throw error("unsafe", `not a regular file: ${path}`);
  } else if (!allowMissing) throw error("missing", `missing board: ${path}`);
}

function readBoard(path) {
  validatePath(path);
  if (!existsSync(path)) return null;
  let value;
  try { value = JSON.parse(readFileSync(path, "utf8")); } catch (cause) {
    throw error("corrupt", `corrupt owner board: ${cause.message}`);
  }
  if (!value || typeof value !== "object") {
    throw error("incompatible", "owner board is incompatible");
  }
  if (value.orca && value.orca.version !== VERSION) throw error("incompatible", "owner board is incompatible");
  return value;
}

function foreignActive(board) {
  return board?.pm?.mode === "enabled" || Boolean(board?.pm?.lease);
}

function lockPath(path) { return `${path}.write-lock`; }

function withLock(path, operation) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lock = lockPath(path);
  let fd;
  try { fd = openSync(lock, "wx", 0o600); } catch (cause) {
    if (cause.code === "EEXIST") throw error("busy", `owner board busy: ${lock}`);
    throw cause;
  }
  try { return operation(); } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(lock); } catch (cause) {
      if (cause.code !== "ENOENT") throw cause;
    }
  }
}

function writeBoard(path, value) {
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, path);
    const directory = openSync(dirname(path), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temp); } catch (cause) {
      if (cause.code !== "ENOENT") throw cause;
    }
  }
}

function loadIdentity(input) {
  const value = identity(input);
  const path = boardPath(input);
  if (resolve(value.commonDir) !== resolve(dirname(path)) && path !== resolve(value.commonDir, "joe-owner.json")) {
    throw error("invalid", "boardPath must be beneath commonDir");
  }
  return { value, path };
}

function baseState(value, mode) {
  return {
    orca: {
      version: VERSION, status: "paused", mode, identity: value,
      pass: null, operation: null, history: [], updatedAt: new Date().toISOString(),
    },
  };
}

function requireState(input, allowed = []) {
  const { value, path } = loadIdentity(input);
  const board = readBoard(path);
  if (!board) throw error("missing", "owner board is uninitialized");
  if (!board.orca) throw error("incompatible", "Orca owner subsection is uninitialized");
  if (foreignActive(board)) throw error("conflict", "another Joe adapter is active on this owner board");
  if (!same(board.orca.identity, value)) throw error("conflict", "owner identity mismatch");
  if (allowed.length && !allowed.includes(board.orca.status)) {
    throw error("state", `operation requires status: ${allowed.join(", ")}`);
  }
  return { value, path, board };
}

function result(status, extra = {}) { return { status, ...extra }; }

export function inspect(input) {
  const { path } = loadIdentity(input);
  const board = readBoard(path);
  if (foreignActive(board)) throw error("conflict", "another Joe adapter is active on this owner board");
  return board?.orca ? result("initialized", { path, board }) : result("uninitialized", { path });
}

export function init(input) {
  const { value, path } = loadIdentity(input);
  return withLock(path, () => {
    const current = readBoard(path);
    if (foreignActive(current)) throw error("conflict", "another Joe adapter is active on this owner board");
    if (!current) {
      const board = baseState(value, text(input.mode ?? "session", "mode"));
      if (!MODES.has(board.orca.mode)) throw error("invalid", "mode must be session or recurring");
      if (board.orca.mode === "recurring") board.orca.jobBinding = text(input.jobBinding, "jobBinding");
      writeBoard(path, board);
      return result("initialized", { path, board });
    }
    if (!current.orca) {
      const board = { ...current, ...baseState(value, text(input.mode ?? "session", "mode")) };
      if (!MODES.has(board.orca.mode)) throw error("invalid", "mode must be session or recurring");
      if (board.orca.mode === "recurring") board.orca.jobBinding = text(input.jobBinding, "jobBinding");
      writeBoard(path, board);
      return result("initialized", { path, board });
    }
    if (!same(current.orca.identity, value) || current.orca.mode !== input.mode) {
      throw error("conflict", "init conflicts with existing owner board");
    }
    return result("already_initialized", { path, board: current });
  });
}

export function resume(input) {
  const { path, board, value } = requireState(input, ["paused", "stopped"]);
  return withLock(path, () => {
    const current = readBoard(path);
    if (!same(current.orca.identity, value)) throw error("conflict", "owner changed");
    if (current.orca.pass || current.orca.operation) throw error("blocked", "active pass or unresolved operation");
    if (current.orca.mode === "recurring" && input.jobBinding !== current.orca.jobBinding) {
      throw error("blocked", "recurring job binding is not verified");
    }
    current.orca.status = "active";
    current.orca.updatedAt = new Date().toISOString();
    writeBoard(path, current);
    return result("resumed", { path, board: current });
  });
}

export function claim(input) {
  const { path, board, value } = requireState(input, ["active"]);
  return withLock(path, () => {
    const current = readBoard(path);
    if (!same(current.orca.identity, value)) throw error("conflict", "owner changed");
    if (current.orca.pass) throw error("busy", "an active pass already exists");
    if (current.orca.operation) throw error("blocked", "unresolved operation blocks claim");
    const token = randomUUID();
    current.orca.pass = { token, coordinator: value.coordinator, run: value.run, host: value.controlHost, generation: (current.orca.generation ?? 0) + 1, claimedAt: new Date().toISOString() };
    current.orca.generation = current.orca.pass.generation;
    current.orca.updatedAt = new Date().toISOString();
    writeBoard(path, current);
    return result("claimed", { token, generation: current.orca.generation });
  });
}

function guardCurrent(input, current, token) {
  if (!current.orca.pass || current.orca.pass.token !== token) throw error("stale", "stale pass token is not current");
  if (!same(current.orca.identity, identity(input))) throw error("conflict", "owner identity mismatch");
  if (current.orca.status !== "active") throw error("paused", "controller is not active");
}

export function assertPass(input) {
  const { path, board } = requireState(input);
  guardCurrent(input, board, text(input.token, "token"));
  return result("authorized", { path, generation: board.orca.pass.generation });
}

export function recordOperation(input) {
  const { path, board, value } = requireState(input, ["active"]);
  const token = text(input.token, "token");
  guardCurrent(input, board, token);
  const operationId = text(input.operationId, "operationId");
  return withLock(path, () => {
    const current = readBoard(path);
    guardCurrent(input, current, token);
    if (current.orca.operation) {
      if (current.orca.operation.id !== operationId) throw error("blocked", "another operation is pending");
      if (current.orca.operation.intent !== input.intent) throw error("conflict", "operation intent changed");
      return result("already_recorded", { operation: current.orca.operation });
    }
    const operation = { id: operationId, intent: text(input.intent, "intent"), token, status: "pending", recordedAt: new Date().toISOString(), task: input.task ?? null, dispatch: input.dispatch ?? null };
    current.orca.operation = operation;
    current.orca.updatedAt = new Date().toISOString();
    writeBoard(path, current);
    return result("recorded", { operation });
  });
}

export function reconcileOperation(input) {
  const { path, board } = requireState(input);
  const operationId = text(input.operationId, "operationId");
  if (!board.orca.operation || board.orca.operation.id !== operationId) throw error("missing", "operation is not pending");
  return withLock(path, () => {
    const current = readBoard(path);
    if (!current.orca.operation || current.orca.operation.id !== operationId) throw error("missing", "operation is not pending");
    current.orca.history.push({ ...current.orca.operation, status: text(input.status, "status"), reconciledAt: new Date().toISOString() });
    current.orca.operation = null;
    writeBoard(path, current);
    return result("reconciled", { operation: current.orca.history.at(-1) });
  });
}

export const assert = assertPass;
export const record = recordOperation;
export const reconcile = reconcileOperation;

export function release(input) {
  const { path, board } = requireState(input, ["active"]);
  const token = text(input.token, "token");
  guardCurrent(input, board, token);
  return withLock(path, () => {
    const current = readBoard(path);
    guardCurrent(input, current, token);
    if (current.orca.operation) throw error("blocked", "unresolved operation blocks release");
    current.orca.history.push({ type: "released", token, releasedAt: new Date().toISOString() });
    current.orca.pass = null;
    current.orca.updatedAt = new Date().toISOString();
    writeBoard(path, current);
    return result("released");
  });
}

function close(input, status) {
  const { path, board, value } = requireState(input, ["active", "paused", "stopped"]);
  return withLock(path, () => {
    const current = readBoard(path);
    if (!same(current.orca.identity, value)) throw error("conflict", "owner changed");
    if (current.orca.pass) current.orca.history.push({ type: "pass-invalidated", pass: current.orca.pass, at: new Date().toISOString() });
    current.orca.status = status;
    current.orca.gate = { newDispatch: "closed", closedAt: new Date().toISOString(), reason: text(input.reason, "reason") };
    current.orca.pass = null;
    current.orca.updatedAt = new Date().toISOString();
    writeBoard(path, current);
    return result(status, { board: current });
  });
}

export const pause = (input) => close(input, "paused");
export const stop = (input) => close(input, "stopped");

export function recover(input) {
  const { path, board } = requireState({ ...input, coordinator: input.previousCoordinator }, ["paused", "stopped"]);
  if (!input.authority || !input.reconciled || !input.previousReleased) throw error("blocked", "human authority, reconciliation, and previous release proof required");
  return withLock(path, () => {
    const current = readBoard(path);
    if (current.orca.identity.coordinator !== input.previousCoordinator) throw error("conflict", "previous coordinator mismatch");
    const nextCoordinator = text(input.newCoordinator, "newCoordinator");
    current.orca.identity = { ...current.orca.identity, coordinator: nextCoordinator };
    current.orca.history.push({ type: "recovered", at: new Date().toISOString(), authority: input.authority });
    current.orca.pass = null;
    writeBoard(path, current);
    return result("recovered");
  });
}

export const operations = { inspect, init, resume, claim, assert: assertPass, record: recordOperation, reconcile: reconcileOperation, release, pause, stop, recover };

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    const [name, raw] = process.argv.slice(2);
    if (!operations[name]) throw error("invalid", `unknown operation: ${name}`);
    process.stdout.write(`${JSON.stringify(operations[name](JSON.parse(raw ?? "{}")))}\n`);
  } catch (cause) {
    process.stderr.write(`${cause.code ?? "error"}: ${cause.message}\n`);
    process.exitCode = 1;
  }
}
