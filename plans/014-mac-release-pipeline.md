# Mac release pipeline: signed DMG on every version bump

## Context

Aira has no download. The site, README and PRODUCT.md all say "build from source". The user now has an Apple Developer account and wants: merge a PR to `main` → a signed, notarized Mac build appears and the website's download button serves it. Decisions already made: repo goes **public**, bundle id becomes **`com.codevry.aira`** (before the first signed build, so nothing is ever signed under the old id).

Current state: no `.github/`, no signing config, `security find-identity` finds no cert yet, repo private, 0 releases, 0 Actions secrets. Vercel already redeploys `docs/` on every push to `main`.

## Approach

**Plain GitHub Actions workflow, no `tauri-action`.** Tauri's own CLI imports the certificate from env vars and notarizes, so the whole pipeline is `bun tauri build` + `gh release create`. Release gating by version, not by every merge:

- Trigger: push to `main` (plus `workflow_dispatch`).
- Read `version` from `src-tauri/tauri.conf.json`. If release `v<version>` already exists → skip. So a merge that bumps the version ships; other merges are no-ops.
- Build a **universal** DMG (Apple Silicon + Intel) on `macos-latest`, signed with Developer ID and notarized by Tauri (hardened runtime is Tauri's default; no entitlements needed for spawning shells/agents).
- One asset per release, Tauri's own versioned name **`Aira_0.1.0_universal.dmg`**. No unversioned alias: whatever lands in the user's Downloads carries the version.
- The website's Download button resolves the versioned file at page load: `docs/site.js` fetches `https://api.github.com/repos/DawnImpulse/aira/releases/latest`, sets every `a[data-download]` href to the `.dmg` asset's `browser_download_url` and fills `[data-latest]` with `tag_name`. The static fallback href is `https://github.com/DawnImpulse/aira/releases/latest` (the release page, which shows the same versioned DMG), so if the API call fails or is rate-limited (60 req/h per IP, unauthenticated) the user still gets a versioned file, one click later. The site never needs editing per release.
- Version is visible to end users in: the DMG filename, the GitHub release (`v0.1.0`, title "Aira v0.1.0", generated notes), the site's button line ("v0.1.0 · macOS"), Finder → Get Info on `Aira.app` (`CFBundleShortVersionString` from `tauri.conf.json`), the existing **Aira → About Aira** menu (`PredefinedMenuItem::about` in `src-tauri/src/lib.rs:25` already shows name + version), and a new version line in the Settings sidebar footer.

Skipped on purpose: Tauri updater plugin (add once there are installed users), separate arch builds (universal is one flag), data-dir migration code (no external users yet; one `mv` for the user's own Mac, below).

## Changes

### 1. Bundle id rename `com.codevry.ide` → `com.codevry.aira`
- `src-tauri/tauri.conf.json:5` identifier
- `src-tauri/src/ai.rs:14` Keychain `SERVICE` (and the `.selftest` strings at :405/:408)
- `src/components/SettingsDialog.tsx:223` Keychain service text
- `scripts/screenshots/mock.js:275,391` mock paths (cosmetic consistency)
- `PRODUCT.md:39` brand note; `PRODUCT.md:35` "No signed release yet" line
- Leave crate name `ide`, `IDE_AGENT_EVENTS`, hook file names and old plans untouched.

Effect: app config/data move to `~/Library/Application Support/com.codevry.aira`; saved AI provider keys live under a new Keychain service. Only the user is affected (private repo, no releases). One-time on the user's Mac: `mv ~/Library/Application\ Support/com.codevry.{ide,aira}`, then re-save provider keys in Settings.

### 2. `.github/workflows/release.yml` (new)
```yaml
name: Release
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: write }
concurrency: release
jobs:
  mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - id: v
        run: |
          V=$(jq -r .version src-tauri/tauri.conf.json)
          echo "version=$V" >> "$GITHUB_OUTPUT"
          gh release view "v$V" >/dev/null 2>&1 && echo "skip=1" >> "$GITHUB_OUTPUT" || true
        env: { GH_TOKEN: ${{ github.token }} }
      - if: ${{ !steps.v.outputs.skip }}
        uses: oven-sh/setup-bun@v2
      - if: ${{ !steps.v.outputs.skip }}
        uses: dtolnay/rust-toolchain@stable
        with: { targets: aarch64-apple-darwin,x86_64-apple-darwin }
      - if: ${{ !steps.v.outputs.skip }}
        uses: swatinem/rust-cache@v2
        with: { workspaces: src-tauri }
      - if: ${{ !steps.v.outputs.skip }}
        run: bun install && bun tauri build --target universal-apple-darwin
        env:
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          KEYCHAIN_PASSWORD: ${{ github.run_id }}
      - if: ${{ !steps.v.outputs.skip }}
        run: |
          gh release create "v$V" src-tauri/target/universal-apple-darwin/release/bundle/dmg/Aira_*.dmg --title "Aira v$V" --generate-notes
        env: { GH_TOKEN: ${{ github.token }}, V: ${{ steps.v.outputs.version }} }
```
(Exact env/step details may shift slightly during implementation; shape stays.)

### 3. Website + docs
- `docs/index.html`: nav (:183) and hero (:199) buttons → **"Download for Mac"**, `data-download`, fallback href `…/releases/latest`; `#install` section (:398–411) → heading "Get it.", a download button + "<span data-latest>Latest</span> · macOS, Apple Silicon and Intel, signed and notarized" line, then the existing build-from-source block kept beneath as the secondary path. Remove "there's no signed download yet". Hero note (:202) "early preview v0.1" → `<span data-latest>early preview</span>`.
- `docs/features.html:87`, `docs/guide.html:82`, `docs/feedback.html:89`: header button → "Download for Mac", `data-download`, same fallback href.
- `docs/site.js`: ~8 lines, fetch the latest release once, set `a[data-download]` hrefs to the `.dmg` asset's `browser_download_url`, fill `[data-latest]` with `tag_name`. Fails silently; the static hrefs and text stay as fallback.
- `src/components/SettingsDialog.tsx`: show `Aira <version>` under the side nav via `getVersion()` from `@tauri-apps/api/app` (already a dependency). Mock in `scripts/screenshots/mock.js` returns `0.1.0`.
- `README.md` Build section: add a Download line with the stable URL above the from-source commands.
- `TODO.md`: move "Mac application deploy" to Done once the first release is green.
- Save this plan as `plans/014-mac-release-pipeline.md` before implementing (repo convention).

## User one-time setup (not automatable from here)

1. **Developer ID Application cert**: Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority (save to disk) → developer.apple.com → Certificates → + → *Developer ID Application* → upload CSR → download, double-click to install → Keychain Access → My Certificates → right-click → Export as `.p12` with a password.
2. **Secrets** (`gh secret set NAME` in the repo, or Settings → Secrets → Actions):
   - `APPLE_CERTIFICATE` = `base64 -i cert.p12`
   - `APPLE_CERTIFICATE_PASSWORD` = the export password
   - `APPLE_SIGNING_IDENTITY` = output of `security find-identity -v -p codesigning`, e.g. `Developer ID Application: Saksham … (TEAMID)`
   - `APPLE_ID` = Apple account email
   - `APPLE_PASSWORD` = app-specific password from account.apple.com → Sign-In and Security
   - `APPLE_TEAM_ID` = developer.apple.com/account → Membership details
3. **Make the repo public** (GitHub → Settings → Danger Zone). Checked: `*.local` files and `.memsearch` are gitignored, no env/secret files in history, the horm form token in `docs/feedback.html` is a public client token by design. Optional first: the open Dependabot alert is `glib < 0.20` in `Cargo.lock` (Linux-only transitive dep, not compiled on macOS) — `cargo update -p glib` if it resolves cleanly.

## Release flow afterwards

Bump `version` in `src-tauri/tauri.conf.json` (and `package.json`, `src-tauri/Cargo.toml` to match) in the PR → merge → ~20–30 min later `v0.1.1` exists with `Aira_0.1.1_universal.dmg`; the site's button resolves it on the next page load. Merges without a version bump build nothing.

## Verification

1. Rename: `bun run build` typechecks; `grep -rn codevry.ide src src-tauri scripts PRODUCT.md` returns nothing; `bun tauri dev` starts, writes config under `com.codevry.aira`, Settings shows the new service name.
2. Workflow: push the branch, `workflow_dispatch` it once from the branch (before merge) or merge and watch `gh run watch`. Expect a `v0.1.0` release with `Aira_0.1.0_universal.dmg`.
3. On the Mac: click Download on the site, confirm the saved file is `Aira_0.1.0_universal.dmg`; `spctl -a -vv -t install Aira.app` → `source=Notarized Developer ID`; app opens without Gatekeeper warning, About Aira and Settings both say 0.1.0, spawns a terminal and an agent, Keychain prompt names `com.codevry.aira`.
4. Site: open the Vercel preview, the hero note and install section read "v0.1.0" after the API call, click Download on each page, confirm it fetches the DMG. `bun run screenshots` to refresh the Settings shot (new version line).
5. Second merge with no version bump: workflow runs ~10 s and skips.

## Implementation status (2026-11-12)

Done on branch `mac-release`: bundle id rename, `.github/workflows/release.yml` (plus a guard that fails the job when `APPLE_CERTIFICATE` is unset, and `--target "$GITHUB_SHA"` so the tag points at the commit that built), site download buttons + `site.js` resolver, Settings version line, README/PRODUCT updates.

Verified: `bun run build` typechecks; workflow YAML parses; site rendered locally at 1280 and 390 wide with the API fallback path (no release exists yet, so the success path is untested); `grep codevry.ide` clean outside `plans/`.

Not verified: the pipeline itself. It cannot run until the Developer ID cert and the six `APPLE_*` secrets exist and the repo is public. Order: cert → secrets → public → merge. Screenshots not refreshed (`bun run screenshots` would touch every webp for a one-line Settings change); do it with the next UI change.
