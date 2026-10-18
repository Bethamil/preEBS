# Releasing PreEBS

PreEBS ships for macOS and Linux. A tag `vX.Y.Z` builds unsigned installers, the `preebs` CLI, and the browser extensions, publishes a GitHub Release, and updates the Homebrew cask.

## Version

The tag, without the leading `v`, must match all of:

- `[workspace.package] version` in `Cargo.toml`
- `version` in `crates/preebs-app/src-tauri/tauri.conf.json`
- `version` in `crates/preebs-app/package.json`

```bash
git tag v2.0.0
git push origin v2.0.0
```

The release workflow refuses the tag when those three disagree. CI on branches does not publish anything. Tags do not run the pull-request CI workflow (`tags-ignore`).

## What the tag builds

| Asset | Contents |
| --- | --- |
| `PreEBS_<version>_aarch64.dmg` | Unsigned macOS app for Apple Silicon. The CLI is bundled as `PreEBS.app/Contents/MacOS/preebs-cli` (that name avoids clobbering the workspace `preebs` binary during the build). |
| `PreEBS_<version>_x64.dmg` | The same app for Intel Macs. |
| `PreEBS_<version>_amd64.deb` | Linux package. |
| `PreEBS_<version>_amd64.AppImage` | Linux AppImage. |
| `preebs-macos-aarch64`, `preebs-macos-x64`, `preebs-linux-x86_64` | Standalone CLI binaries. |
| `preebs-chrome.zip`, `preebs-firefox.zip` | The extension folders, unchanged. |

Release notes are generated from merged pull requests (`gh release create --generate-notes`). macOS builds are unsigned (`signingIdentity` is `-`). There is no in-app “install CLI” button: Homebrew links the binary that is already inside the app.

The sidecar is staged by `crates/preebs-app/scripts/stage-cli.sh` before `tauri build`. `src-tauri/build.rs` only writes a placeholder when that file is missing, so `cargo test` still compiles. A real bundle must run the stage script first (CI and the release workflow do).

## Homebrew

Install:

```bash
brew tap Bethamil/preebs
brew install --cask preebs
```

The cask `preebs` installs `PreEBS.app` and links `Contents/MacOS/preebs-cli` as the `preebs` command (`binary` with `target: "preebs"`). A `postflight` block runs `xattr -dr com.apple.quarantine` on the app so the unsigned build can open.

### Tap repository

Create an empty GitHub repository named `homebrew-preebs` under the `Bethamil` account. Homebrew treats `brew tap Bethamil/preebs` as `github.com/Bethamil/homebrew-preebs`. The release workflow commits `Casks/preebs.rb` there. You do not need to write the cask by hand; the first successful tag creates it.

### Secret

The workflow pushes with a personal access token stored as the Actions secret `HOMEBREW_TAP_TOKEN` on `Bethamil/preEBS` (Settings → Secrets and variables → Actions). The token needs contents write on `Bethamil/homebrew-preebs` only. A fine-grained token with that single repository and the Contents permission is enough. Classic `repo` scope also works. `GITHUB_TOKEN` from this repository cannot push to the tap.

If the secret is missing, the GitHub Release is still created and the tap step fails. Add the secret and re-run the failed job, or push an empty commit on the tag is not possible: delete the tag locally and on the remote only if you intend to publish that version again, or re-run after the secret exists without deleting the release.

## Local bundles

```bash
cd crates/preebs-app
npm install
cargo build --release -p preebs-cli --manifest-path ../../Cargo.toml
bash scripts/stage-cli.sh
npx tauri build --bundles app,dmg
```

On Linux, `--bundles deb` or `--bundles deb,appimage`. AppImage needs `libfuse2` (or `libfuse2t64`) and `file`, and `APPIMAGE_EXTRACT_AND_RUN=1` on runners without FUSE.
