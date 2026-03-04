# WorkGrid Studio

WorkGrid Studio is a desktop app built with Tauri 2, React, TypeScript, and Vite.  
The frontend lives in the root project, and the native desktop shell lives in `src-tauri/`.

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

#### macOS/Linux (short)

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

## Developer Setup

### Install Dependencies

```bash
pnpm install
```

### Start in Development

- Frontend only (Vite):

  ```bash
  pnpm dev
  ```

- Full desktop app (Tauri + Vite):

  ```bash
  pnpm tauri dev
  ```

## Production Build

- Frontend production build:

  ```bash
  pnpm build
  ```

This generates static assets in `dist/`.

- Desktop production bundle (installers/binaries):

  ```bash
  pnpm tauri build
  ```

  Build outputs are generated under `src-tauri/target/release/bundle/`.

## Versioning

`package.json` is the version source of truth.  
`src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` are synced automatically.

- Sync all version files:

  ```bash
  pnpm version:sync
  ```

- Check version sync state:

  ```bash
  pnpm version:check
  ```

- Bump and sync:

  ```bash
  pnpm version:bump:patch
  pnpm version:bump:minor
  pnpm version:bump:major
  ```

- Read current version:

  ```bash
  pnpm version:current
  ```

`pnpm build` runs `version:sync` and `version:check` automatically via `prebuild`.

The GitHub Actions workflow `manual-multi-platform-build.yml` now asks for bump level on dispatch, bumps/syncs version files, commits and tags (`app-vX.Y.Z`), then builds releases from that version tag.
