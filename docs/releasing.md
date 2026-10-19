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
brew tap Bethamil/preebs https://github.com/Bethamil/preEBS.git
brew install --cask Bethamil/preebs/preebs
```

The cask `preebs` installs `PreEBS.app` and links `Contents/MacOS/preebs-cli` as the `preebs` command (`binary` with `target: "preebs"`). A `postflight` block runs `xattr -dr com.apple.quarantine` on the app so the unsigned build can open.

### Tap repository

This app repository also serves as the tap. The explicit URL is required because the repository is named `preEBS`, rather than `homebrew-preebs`. The release workflow generates `Casks/preebs.rb` with the release URLs and SHA-256 hashes, then commits it to the repository's default branch (`main`). The first successful release creates the cask, so Homebrew installation becomes available after that release finishes.

### Authentication and retries

The workflow uses the automatically supplied `GITHUB_TOKEN` with `contents: write` to update the cask in this same repository. No personal access token, extra Actions secret, or separate tap repository is required. Repository rules must allow the workflow to push this cask commit to the default branch.

If the cask update fails after publishing the GitHub Release, fix the cause and re-run the failed job. Existing release assets are uploaded again, and an unchanged cask does not create another commit. Keep the published release and tag in place.

## Local bundles

```bash
cd crates/preebs-app
npm install
cargo build --release -p preebs-cli --manifest-path ../../Cargo.toml
bash scripts/stage-cli.sh
npx tauri build --bundles app,dmg
```

On Linux, `--bundles deb` or `--bundles deb,appimage`. AppImage needs `libfuse2` (or `libfuse2t64`) and `file`, and `APPIMAGE_EXTRACT_AND_RUN=1` on runners without FUSE.
