# Legacy PreEBS

This is the previous Next.js and Electron app. The current app is the Rust workspace at the repository root: `crates/preebs-core`, `crates/preebs-cli`, and `crates/preebs-app`.

`preebs migrate` imports `preebs-db.json` from this era. The Chrome and Firefox extensions stayed at the repository root and still import the week export JSON.
