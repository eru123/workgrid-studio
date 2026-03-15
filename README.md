# WorkGrid Studio

WorkGrid Studio is a cross-platform desktop database management app built with **Tauri 2**, **React 19**, **TypeScript**, **Vite**, **TailwindCSS v4**, and **Zustand**. This is a **pnpm monorepo** containing the desktop app, auto-updater service, and marketing website as separate packages.

## Monorepo Structure

```
workgrid-studio/
├── src/                    # React/TypeScript frontend (desktop app UI)
├── src-tauri/              # Rust Tauri backend (native shell, DB driver, IPC commands)
├── wgs-updater/            # Cloudflare Worker — auto-update endpoint for Tauri updater
├── wgs-website/            # Cloudflare Pages — marketing & SEO website
├── scripts/                # Node ESM build utilities (versioning, changelog)
├── .github/                # CI/CD workflows, issue templates, Dependabot config
├── .agent/                 # Agent rules and task workflows for AI-assisted development
│   ├── rules/              # Always-on coding standards and architecture rules
│   └── workflows/          # Step-by-step guides for common development tasks
├── .claude/                # Claude Code settings and permissions
├── public/                 # Static assets served by Vite
├── index.html              # Vite HTML entry point
├── package.json            # Root package — version source of truth, workspace config
├── pnpm-workspace.yaml     # pnpm monorepo workspace definition
└── vite.config.ts          # Vite + Tauri dev server configuration
```

Each sub-project (`wgs-updater/`, `wgs-website/`) has its own `package.json`, `tsconfig.json`, and `README.md`. They are deployed independently — see their respective READMEs for details.

---

## Install Requirements

Install these once on your machine before developing.

### 1) Node.js and pnpm

1. Install Node.js (LTS): https://nodejs.org/
2. Enable Corepack and activate pnpm:

   ```bash
   corepack enable
   corepack prepare pnpm@latest --activate
   ```

3. Verify:

   ```bash
   node -v
   pnpm -v
   ```

### 2) Rust toolchain

#### Windows

1. Install **Visual Studio Build Tools 2022** (required for `x86_64-pc-windows-msvc`):
   https://visualstudio.microsoft.com/visual-cpp-build-tools/
   Select the `Desktop development with C++` workload.
2. Install Rustup:
   - Option A (recommended):

   ```bash
   winget install Rustlang.Rustup
   ```

   - Option B:
     Download and run `rustup-init.exe` from https://rustup.rs/

3. Set stable MSVC toolchain:

   ```bash
   rustup default stable-x86_64-pc-windows-msvc
   ```

4. Verify:

   ```bash
   rustc -V
   cargo -V
   rustup -V
   ```

#### macOS / Linux

1. Install Rustup:

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. Load Cargo environment and set stable toolchain:

   ```bash
   source "$HOME/.cargo/env"
   rustup default stable
   ```

3. Verify:

   ```bash
   rustc -V
   cargo -V
   rustup -V
   ```

### 3) Tauri system prerequisites

Install platform-specific dependencies required by Tauri:
https://v2.tauri.app/start/prerequisites/

---

## Developer Setup

### Install dependencies

```bash
pnpm install
```

### Start in development

- Frontend only (Vite, hot-reload in browser at `localhost:1420`):

  ```bash
  pnpm dev
  ```

- Full desktop app (Tauri + Vite, opens a native window):

  ```bash
  pnpm tauri dev
  ```

---

## Production Build

- Frontend production build (outputs to `dist/`):

  ```bash
  pnpm build
  ```

- Desktop bundle (installers/binaries in `src-tauri/target/release/bundle/`):

  ```bash
  pnpm tauri build
  ```

---

## Versioning

`package.json` is the single source of truth for the version.
`src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` are derived and kept in sync automatically.

```bash
pnpm version:current        # Print current version
pnpm version:sync           # Propagate package.json version → tauri.conf.json, Cargo.toml
pnpm version:check          # Assert all three files agree (exits non-zero on mismatch)
pnpm version:bump:patch     # Bump patch, sync all files
pnpm version:bump:minor     # Bump minor, sync all files
pnpm version:bump:major     # Bump major, sync all files
```

`pnpm build` runs `version:sync` and `version:check` automatically via the `prebuild` lifecycle hook. Never edit the version in `tauri.conf.json` or `Cargo.toml` directly.

---

## Changelog

`CHANGELOG.md` is maintained automatically. Manual edits are not required.

**How it works:**

1. Every push to `main` triggers the `Update Changelog` GitHub Actions workflow, which appends new commit subjects as bullet points under the `[Unreleased]` heading in `CHANGELOG.md`.
2. When the manual build workflow runs it promotes `[Unreleased]` to a dated version heading (e.g. `## [0.1.4] - 2026-03-14`) before committing the version bump. The promoted entries become the GitHub release description.

```bash
pnpm changelog:unreleased         # Print current pending entries
pnpm changelog:promote <version>  # Promote [Unreleased] to a versioned section
```

These are handled automatically by CI — run them locally only when needed.

---

## CI/CD

**`.github/workflows/manual-multi-platform-build.yml`** — manually triggered via `workflow_dispatch`.

Workflow steps:
1. Prompts for bump level (`patch` / `minor` / `major`).
2. Bumps and syncs version files across `package.json`, `tauri.conf.json`, and `Cargo.toml`.
3. Promotes the `[Unreleased]` changelog section to the new version.
4. Commits and tags `app-vX.Y.Z`, then builds in parallel on Ubuntu 22.04, macOS 14 (arm64), and Windows 2022.
5. Publishes a **draft pre-release** to GitHub Releases with the changelog entries as the release body.

**`.github/workflows/changelog-on-push.yml`** — runs on every push to any branch (excluding changelog/version-file-only commits).

Appends the pushed commit subjects to the `[Unreleased]` section of `CHANGELOG.md` and commits the result back with a `[skip ci]` marker to prevent loops.

---

## Auto-updater service (`wgs-updater/`)

`wgs-updater` is a Cloudflare Worker that acts as the update endpoint for Tauri's built-in updater plugin. It is deployed separately from the desktop app.

**Endpoint:** `GET /api/update/:target/:current_version`

The worker queries the GitHub Releases API, compares the latest release tag against the client version using semver, and returns either `204 No Content` (already up to date) or the Tauri update payload (version, notes, signature, download URL).

See [`wgs-updater/README.md`](wgs-updater/README.md) for full documentation and deployment instructions.

---

## License

WorkGrid Studio is licensed under the [Apache License 2.0](LICENSE).
