# PreEBS Agent Guide

This file defines how coding agents should work in this repository.

## Product

PreEBS is a keyboard-first weekly timesheet. People enter Monday–Friday hours here, export JSON, and import that JSON into EBS with the Chrome or Firefox extension.

## Stack

- `crates/preebs-core`: domain, validation, week export, config transfer, SQLite
- `crates/preebs-cli`: the `preebs` binary. No HTTP server
- `crates/preebs-app`: Tauri v2 shell and a Svelte 5 + Vite UI
- `chrome-extension/` and `firefox-extension/`: unchanged consumers of the week export
- `docs/rust-plan.md`: domain rules and intentional differences from the previous TypeScript app (that tree is only in git history)
- `docs/cli.md`: stable `--json` schemas

The CLI and the app open the same SQLite file. A committed write bumps `meta.revision`. The app polls that counter.

## Non-negotiables

- Domain changes belong in `preebs-core`, with tests.
- Week export JSON must stay byte-compatible with the golden file produced from the TypeScript exporter. The extensions depend on it.
- Hours are 0 through 24 in steps of 0.5.
- `book` sets a cell. It does not add. Over-max rejects the whole booking.
- The grid save does not enforce the daily max. It warns.
- Do not collapse a task to one hour type.
- Do not add horizontal scrolling to the week grid.
- Keep focus, labels, and contrast in the desktop UI.

## Checks

```bash
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

The app crate links WebKitGTK on Linux, so those commands need the Tauri system packages listed in `.github/workflows/ci.yml`. `cargo` also runs the frontend build, so `crates/preebs-app` needs `npm ci` first.

Rust 1.90 is pinned in `rust-toolchain.toml` because Tauri 2.12 requires it.
