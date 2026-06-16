# Proveria CLI Release Packaging

This is the initial release path for the Rust CLI while the public developer
repos are still being shaped.

For the first release gate, use
[proveria-cli-v0.1.0-release-checklist.md](/Users/drewshoaf/proveria/docs/proveria-cli-v0.1.0-release-checklist.md).

## GitHub Release

The release workflow is `.github/workflows/proveria-cli-release.yml`.

It runs when either:

- a tag matching `proveria-cli-v*` is pushed; or
- the workflow is started manually with a tag input.

Recommended tag format:

```bash
proveria-cli-v0.1.0
```

Release artifacts:

- `proveria-x86_64-unknown-linux-gnu.tar.gz`
- `proveria-aarch64-apple-darwin.tar.gz`
- `proveria-x86_64-pc-windows-msvc.zip`
- one `.sha256` file per archive

The workflow creates the GitHub release as a draft so the checksums and notes
can be reviewed before publishing.

## Release Steps

1. Confirm `Cargo.toml` workspace version is correct.
2. Run local checks:

   ```bash
   cargo fmt
   cargo check -p proveria
   cargo test -p proveria
   scripts/check-cli-release-version.sh proveria-cli-v0.1.0
   scripts/cli-release-smoke.sh
   ```

3. Install the local binary and smoke it as an installed command:

   ```bash
   cargo install --path apps/proveria-cli --force
   PROVERIA_CLI_BIN="$(command -v proveria)" scripts/cli-release-smoke.sh
   ```

4. Create and push the tag:

   ```bash
   git tag proveria-cli-v0.1.0
   git push origin proveria-cli-v0.1.0
   ```

5. Review the draft GitHub release artifacts and checksums.
6. Download at least one macOS/Linux release archive and smoke the extracted
   binary:

   ```bash
   mkdir -p /tmp/proveria-cli-release-smoke
   tar -xzf proveria-aarch64-apple-darwin.tar.gz -C /tmp/proveria-cli-release-smoke
   PROVERIA_CLI_BIN=/tmp/proveria-cli-release-smoke/proveria scripts/cli-release-smoke.sh
   ```

7. Publish the GitHub release.

## Smoke Script

The local release smoke script is:

```bash
scripts/cli-release-smoke.sh
```

By default it runs the CLI through Cargo. Set `PROVERIA_CLI_BIN` to smoke a
specific installed or extracted binary:

```bash
PROVERIA_CLI_BIN=/path/to/proveria scripts/cli-release-smoke.sh
```

The smoke verifies:

- `proveria --help`;
- `proveria --version`;
- local file hashing;
- receipt artifact help flags;
- zsh completion generation.

## Homebrew

For the first public tap, create or use a dedicated tap repo:

```text
proveria/homebrew-tap
```

Formula path:

```text
Formula/proveria.rb
```

After the draft release artifacts exist, download the release artifacts and
checksums, then render the formula:

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

The rendered formula has this shape:

```ruby
class Proveria < Formula
  desc "CLI for local hashing, attestations, receipts, and API workflows"
  homepage "https://github.com/proveria/proveria-cli"

  on_macos do
    on_arm do
      url "https://github.com/proveria/proveria-cli/releases/download/proveria-cli-v0.1.0/proveria-aarch64-apple-darwin.tar.gz"
      sha256 "<aarch64-apple-darwin sha256>"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/proveria/proveria-cli/releases/download/proveria-cli-v0.1.0/proveria-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "<x86_64-unknown-linux-gnu sha256>"
    end
  end

  def install
    bin.install "proveria"
  end

  test do
    assert_match "Proveria CLI", shell_output("#{bin}/proveria --help")
  end
end
```

Before committing the formula to the tap, run:

```bash
brew audit --strict --online proveria/tap/proveria
brew test proveria
```

Target install command:

```bash
brew install proveria/tap/proveria
```

If the formula is eventually accepted into a public tap named simply
`homebrew-proveria`, the shorter target can become:

```bash
brew install proveria
```

Update `homepage` and release URLs if the CLI is later moved to a dedicated
public repository.
