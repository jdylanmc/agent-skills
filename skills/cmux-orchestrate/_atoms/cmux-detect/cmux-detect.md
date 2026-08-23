---
name: cmux-detect
description: Detect whether the caller is inside cmux and report socket, workspace, pane, and surface context without failing outside cmux.
level: atom
allowed-tools: ["execute"]
includes: []
composes: []
disable-model-invocation: false
user-invocable: false
used-by: ["cmux-orchestrate/_molecules/cmux-session/cmux-session.md"]
---

# cmux Detect

## Inputs

- Environment variables from the current process.
- Optional output from `cmux identify` after the command is validated by
  `cmux-invoke`.

## Operation

1. Read `CMUX_SOCKET_PATH`. If it is absent, return `cmux_absent` and continue
   without invoking cmux.
2. When present, report the socket path exactly as provided by the environment.
3. Report caller workspace, pane, and surface from `CMUX_WORKSPACE_ID`,
   `CMUX_PANE_ID`, and `CMUX_SURFACE_ID` when available.
4. If a socket connection fails, return a degraded result that names
   `automation.socketControlMode` values: `off`, `cmuxOnly`, `automation`,
   `password`, and `allowAll`. State that `cmuxOnly` is the default and can block
   external callers.

## Output

A detection record with `present`, `category`, and, when present, `socketPath`,
`workspaceId`, `paneId`, and `surfaceId`.

## Guarantees

- Absence outside cmux is a normal degraded state, not an error.
- No default socket path is invented.
- The caller workspace comes from `CMUX_WORKSPACE_ID`, not current focus.

## Boundaries

This atom does not create panes, send input, read surfaces, or infer missing
identifiers from focused cmux state.
