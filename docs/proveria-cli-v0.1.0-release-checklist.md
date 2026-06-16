# Proveria CLI v0.1.0 Release Checklist

Use this checklist to cut the first developer-preview Rust CLI release.

## Preflight

- [ ] Confirm `main` is up to date.
- [ ] Confirm no release-blocking PRs are open.
- [ ] Confirm `Cargo.toml` workspace version is `0.1.0`.
- [ ] Confirm release notes are ready in
      [docs/releases/proveria-cli-v0.1.0.md](/Users/drewshoaf/proveria/docs/releases/proveria-cli-v0.1.0.md).
- [ ] Confirm packaging docs are ready in
      [docs/cli-release-packaging.md](/Users/drewshoaf/proveria/docs/cli-release-packaging.md).
- [ ] Confirm the local API and CLI compliance QA checklist has passed or any
      remaining gaps are accepted.
- [ ] Confirm API key expiration and rotation QA has passed or any remaining
      gaps are accepted.

## Local Checks

Run:

```bash
cargo fmt
cargo check -p proveria
cargo test -p proveria
scripts/check-cli-release-version.sh proveria-cli-v0.1.0
scripts/cli-release-smoke.sh
```

Then smoke the installed binary:

```bash
cargo install --path apps/proveria-cli --force
PROVERIA_CLI_BIN="$(command -v proveria)" scripts/cli-release-smoke.sh
```

## Tag And Draft Release

Create and push the release tag:

```bash
git tag proveria-cli-v0.1.0
git push origin proveria-cli-v0.1.0
```

Wait for the `Proveria CLI Release` workflow to finish. It should create a
draft GitHub release with:

```text
proveria-aarch64-apple-darwin.tar.gz
proveria-aarch64-apple-darwin.tar.gz.sha256
proveria-x86_64-pc-windows-msvc.zip
proveria-x86_64-pc-windows-msvc.zip.sha256
proveria-x86_64-unknown-linux-gnu.tar.gz
proveria-x86_64-unknown-linux-gnu.tar.gz.sha256
```

## Artifact QA

Download at least the macOS artifact for the local machine and smoke it:

```bash
mkdir -p /tmp/proveria-cli-release-smoke
tar -xzf proveria-aarch64-apple-darwin.tar.gz -C /tmp/proveria-cli-release-smoke
PROVERIA_CLI_BIN=/tmp/proveria-cli-release-smoke/proveria scripts/cli-release-smoke.sh
```

Confirm checksum format:

```bash
cat proveria-aarch64-apple-darwin.tar.gz.sha256
```

Expected: one SHA-256 hash followed by the artifact file name.

## Homebrew Tap Prep

Download artifacts and render the formula:

```bash
mkdir -p /tmp/proveria-cli-release-artifacts
gh release download proveria-cli-v0.1.0 \
  --repo proveria/proveria-cli \
  --dir /tmp/proveria-cli-release-artifacts

scripts/render-homebrew-formula.sh \
  proveria-cli-v0.1.0 \
  /tmp/proveria-cli-release-artifacts \
  > Formula/proveria.rb
```

In the tap repo, run:

```bash
brew audit --strict --online proveria/tap/proveria
brew test proveria
```

## Publish

- [ ] Paste the release notes from
      [docs/releases/proveria-cli-v0.1.0.md](/Users/drewshoaf/proveria/docs/releases/proveria-cli-v0.1.0.md)
      into the draft GitHub release.
- [ ] Confirm release artifacts and checksums are present.
- [ ] Confirm artifact smoke passed.
- [ ] Publish the GitHub release.
- [ ] If the tap is ready, commit the rendered Homebrew formula to the tap repo.

## Post-Release

- [ ] Confirm the release page is public.
- [ ] Confirm archive download works.
- [ ] Confirm direct binary smoke still passes from the downloaded archive.
- [ ] Confirm docs mention the correct release tag and install path.
- [ ] Record any release issues for the next patch release.
