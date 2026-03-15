# CLAUDE.md — WorkGrid Studio

WorkGrid Studio is a cross-platform desktop database management app built with **Tauri 2**, **React 19**, **TypeScript**, **Vite**, **TailwindCSS v4**, and **Zustand**. This is a **pnpm monorepo** — the desktop app frontend lives in `src/`, the Rust-backed native shell in `src-tauri/`, the auto-update Cloudflare Worker in `wgs-updater/`, and the marketing website in `wgs-website/`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| Frontend framework | React 19 |
| Language | TypeScript 5.8 (strict) |
| Build tool | Vite 7 |
| CSS | TailwindCSS v4 (PostCSS) |
| State management | Zustand 5 |
| Icons | lucide-react, react-icons |
| Class utility | clsx + tailwind-merge (via `cn()`) |
| Package manager | pnpm 10 (required) |
| Rust async runtime | tokio |
| Rust DB driver | mysql_async (rustls TLS) |

---

## Repository Layout

```
workgrid-studio/
├── src/                           # React/TypeScript frontend (desktop app UI)
│   ├── app/
│   │   ├── App.tsx                # Root component: loads profiles, renders Workbench
│   │   └── providers/
│   │       └── ThemeProvider.tsx
│   ├── components/
│   │   ├── layout/                # Structural shell components
│   │   │   ├── Workbench.tsx      # Top-level shell: activity bar, sidebar, editor, status bar
│   │   │   ├── EditorNode.tsx     # Recursive split-pane editor renderer
│   │   │   └── Sash.tsx           # Draggable resize handle
│   │   ├── ui/                    # Generic reusable UI primitives
│   │   │   ├── AutocompleteInput.tsx
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── CellContextMenu.tsx
│   │   │   ├── CodeEditorShell.tsx
│   │   │   ├── FindToolbar.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Skeleton.tsx
│   │   │   ├── SqlAutocomplete.tsx
│   │   │   ├── ToastContainer.tsx
│   │   │   └── Tree.tsx
│   │   └── views/                 # Feature-specific panels and modals
│   │       ├── AiChatSidebar.tsx
│   │       ├── CommandPalette.tsx
│   │       ├── ConfirmModal.tsx
│   │       ├── ContextSubmenu.tsx
│   │       ├── CreateDatabaseModal.tsx
│   │       ├── DatabaseView.tsx
│   │       ├── EditDatabaseModal.tsx
│   │       ├── ExplainPlanView.tsx
│   │       ├── ExplorerTree.tsx
│   │       ├── ModelsPage.tsx
│   │       ├── PrivacyDisclosureModal.tsx
│   │       ├── PrivacyPolicyPanel.tsx
│   │       ├── QueryTab.tsx
│   │       ├── ResultsTab.tsx
│   │       ├── SchemaDiagramTab.tsx
│   │       ├── ServersSidebar.tsx
│   │       ├── SettingsPage.tsx
│   │       ├── TableDataTab.tsx
│   │       ├── TableDesigner.tsx
│   │       ├── TasksView.tsx
│   │       └── WelcomeTab.tsx
│   ├── content/
│   │   └── privacyPolicy.ts       # Privacy policy text content
│   ├── hooks/
│   │   ├── useAppVersion.ts       # Reads __APP_VERSION__ injected by Vite
│   │   └── useProfileManager.ts
│   ├── lib/
│   │   ├── appVersion.ts
│   │   ├── db.ts                  # Typed wrappers around all Tauri IPC commands
│   │   ├── output.ts              # Bottom panel output helpers
│   │   ├── privacy.ts             # Privacy preference helpers
│   │   ├── sqlHighlight.ts        # SQL syntax highlighting utilities
│   │   ├── sqlSuggestions.ts      # SQL autocomplete suggestion logic
│   │   ├── storage.ts             # readData/writeData JSON persistence via Tauri IPC
│   │   └── utils/
│   │       ├── cn.ts              # clsx + tailwind-merge helper
│   │       └── dataGrid.ts        # Data grid utility helpers
│   ├── state/                     # Zustand stores (one file per domain)
│   │   ├── appStore.ts            # Global theme, toasts, hotkeys, focus
│   │   ├── layoutStore.ts         # Activity view, sidebar widths, editor split tree, tabs
│   │   ├── modelsStore.ts         # AI model configuration
│   │   ├── profilesStore.ts       # DB connection profiles (persisted to disk)
│   │   ├── queryHistoryStore.ts   # Per-profile query history
│   │   ├── resultsStore.ts        # Query result sets (in-memory)
│   │   ├── schemaStore.ts         # Cached schema/table/column metadata
│   │   └── tasksStore.ts          # Task tracker
│   ├── styles/
│   │   └── globals.css            # Tailwind base + CSS custom properties
│   ├── main.tsx                   # React entry point
│   └── vite-env.d.ts
│
├── src-tauri/                     # Rust Tauri backend
│   ├── src/
│   │   ├── lib.rs                 # Tauri command registration, DbState, run()
│   │   ├── main.rs                # Binary entry point (calls lib::run())
│   │   ├── ai.rs                  # AI integration (model API calls)
│   │   ├── crypto.rs              # AES-GCM password encryption/decryption
│   │   ├── db.rs                  # MySQL query execution logic
│   │   ├── error.rs               # Shared error types and formatting
│   │   ├── files.rs               # JSON file persistence (read/write/delete)
│   │   ├── logging.rs             # Per-profile query and error logging
│   │   └── ssh.rs                 # SSH tunnel support
│   ├── capabilities/
│   │   └── default.json           # Tauri v2 capability/permission config
│   ├── Cargo.toml
│   ├── tauri.conf.json            # App name, identifier, window config, updater, bundle
│   └── build.rs
│
├── wgs-updater/                   # Cloudflare Worker — Tauri auto-update endpoint
│   ├── src/
│   │   ├── index.ts               # Hono app: GET /api/update/:target/:current_version
│   │   └── types.ts               # UpdateResponse and shared types
│   ├── wrangler.jsonc             # Cloudflare Workers config (domain: wgs-updater.skiddph.com)
│   ├── worker-configuration.d.ts  # Auto-generated Cloudflare env bindings
│   ├── package.json
│   ├── tsconfig.json
│   ├── AGENTS.md                  # Agent instructions for this sub-project
│   └── README.md
│
├── wgs-website/                   # Cloudflare Pages — marketing & SEO website
│   ├── src/
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── public/
│   ├── vite.config.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md
│
├── scripts/                       # Node ESM build/release utilities
│   ├── changelog.mjs              # CHANGELOG generation and promotion tool
│   └── versioning.mjs             # Version sync/bump across package.json, Cargo.toml, tauri.conf.json
│
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml
│   │   ├── feature_request.yml
│   │   └── config.yml
│   ├── workflows/
│   │   ├── manual-multi-platform-build.yml  # Triggered build: bump, build all platforms, draft release
│   │   └── changelog-on-push.yml            # Auto-appends commit subjects to [Unreleased] CHANGELOG
│   └── dependabot.yml
│
├── .agent/                        # AI agent rules and task workflows
│   ├── rules/
│   │   └── coding-standards.md   # Always-on: Senior Desktop Architect persona + architecture rules
│   └── workflows/
│       ├── add-editor-tab.md     # How to add a new tab type end-to-end
│       ├── add-tauri-command.md  # How to add a Rust command + TypeScript wrapper
│       └── add-zustand-store.md  # Store creation pattern with persistence and loading guards
│
├── .claude/                       # Claude Code settings
│   ├── settings.json              # Tool permissions (worktree-scoped)
│   └── settings.local.json        # Local overrides (not committed)
│
├── public/                        # Static assets served by Vite
├── index.html                     # Vite HTML entry point
├── package.json                   # Version source of truth + monorepo root scripts
├── pnpm-workspace.yaml            # pnpm monorepo workspace definition
├── vite.config.ts                 # Vite + Tauri dev server + bundle analyzer
├── tsconfig.json                  # TypeScript strict config (target: ES2020)
├── tsconfig.node.json
└── postcss.config.mjs             # TailwindCSS v4 PostCSS plugin
```

---

## Development Commands

```bash
# Install dependencies (always use pnpm)
pnpm install

# Frontend only (hot reload in browser at localhost:1420)
pnpm dev

# Full desktop app (Tauri + Vite, spawns a native window)
pnpm tauri dev

# Type-check frontend
pnpm build   # runs tsc && vite build (also runs version:sync + version:check via prebuild)

# Production desktop bundle (outputs to src-tauri/target/release/bundle/)
pnpm tauri build
```

There is **no test suite** configured at this time. TypeScript strict mode acts as the primary compile-time correctness check.

---

## Versioning System

`package.json` is the **single source of truth** for the version. `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` are derived and must stay in sync.

```bash
pnpm version:current       # Print current version
pnpm version:sync          # Propagate package.json version → tauri.conf.json, Cargo.toml
pnpm version:check         # Assert all three files agree (fails with diff if not)
pnpm version:bump:patch    # Bump patch, sync all files
pnpm version:bump:minor    # Bump minor, sync all files
pnpm version:bump:major    # Bump major, sync all files
```

`pnpm build` automatically runs `version:sync` then `version:check` via the `prebuild` lifecycle hook. **Never edit the version in `tauri.conf.json` or `Cargo.toml` directly** — always go through `package.json` or the bump scripts.

---

## CI/CD

**`.github/workflows/manual-multi-platform-build.yml`** — manually triggered via `workflow_dispatch`.

Workflow steps:
1. Prompts for bump level (patch / minor / major).
2. Bumps and syncs version files (`package.json` → `tauri.conf.json`, `Cargo.toml`).
3. Promotes `[Unreleased]` in `CHANGELOG.md` to the new version heading.
4. Commits and tags `app-vX.Y.Z`, then builds in parallel on `ubuntu-22.04`, `macos-14` (arm64), and `windows-2022`.
5. Publishes a **draft pre-release** to GitHub Releases with changelog entries as the release body.

**`.github/workflows/changelog-on-push.yml`** — runs on every push to any branch (excluding changelog/version-only commits).

Appends pushed commit subjects as bullet points under the `[Unreleased]` section of `CHANGELOG.md` and commits the result back with a `[skip ci]` marker to prevent loops.

---

## Tauri IPC Architecture

All native capabilities are exposed as **Tauri commands** defined in `src-tauri/src/lib.rs`. The frontend calls them through typed wrapper functions in `src/lib/db.ts` and `src/lib/storage.ts` using `invoke()` from `@tauri-apps/api/core`.

### Registered commands

| Command | Purpose |
|---|---|
| `app_read_file` / `app_write_file` / `app_delete_file` | JSON persistence in `~/.workgrid-studio/data/` |
| `app_get_data_dir` | Returns the data directory path |
| `read_profile_log` / `clear_profile_log` | Read/clear per-profile log files |
| `db_connect` / `db_disconnect` | Open/close a MySQL connection pool keyed by `profile_id` |
| `db_list_databases` / `db_list_tables` / `db_list_columns` | Schema introspection |
| `db_get_databases_info` / `db_get_tables_info` | HeidiSQL-style rich metadata |
| `db_get_variables` / `db_set_variable` | MySQL server variables (SESSION/GLOBAL) |
| `db_get_status` | `SHOW GLOBAL STATUS` |
| `db_get_processes` / `db_kill_process` | Process list management |
| `db_execute_query` | Execute DDL/DML (no result rows) |
| `db_query` | Execute queries and return `QueryResultSet[]` |
| `db_get_collations` | List available collations |

### DbState

The Rust backend maintains a `DbState` struct with a `Mutex<HashMap<String, Pool>>` that maps `profile_id → mysql_async::Pool`. Connections are kept alive for the duration of the session and replaced on re-connect.

### Data storage

Persisted files live in `~/.workgrid-studio/` (Linux/macOS) or `%USERPROFILE%\.workgrid-studio\` (Windows):

```
~/.workgrid-studio/
├── data/
│   └── profiles.json        # Saved connection profiles
├── logs/
│   └── <profile_id>/
│       ├── mysql.log.txt    # Query log (QUERY: / INFO: / ERROR: lines)
│       └── error.log.txt    # Error-only log
└── cache/
```

---

## Frontend Architecture

### State Stores (Zustand)

All state is managed through Zustand stores. Each store is colocated in `src/state/`:

| Store | Responsibility |
|---|---|
| `appStore` | Theme (`light`/`dark`/`system`), toast notifications, hotkeys enabled flag, focused container |
| `layoutStore` | Activity bar view, sidebar/panel dimensions, **editor split tree**, tab management |
| `profilesStore` | Connection profiles — loaded from disk on startup, debounce-saved on mutation |
| `schemaStore` | Cached DB/table/column metadata |
| `queryHistoryStore` | Per-profile query history (persisted) |
| `resultsStore` | Query result sets (in-memory, not persisted) |
| `modelsStore` | AI model provider configuration |
| `tasksStore` | Task tracker items |

### Editor Layout (Split Pane Tree)

`layoutStore` manages a recursive binary tree of type `SplitTree = SplitLeaf | SplitNode`. Leaves hold tabs; nodes hold two subtrees with a direction (`horizontal` | `vertical`) and a `ratio` (0–1).

Tab types (`EditorTabType`): `sql`, `results`, `schema`, `models`, `tasks`, `database-view`, `table-designer`.

Each tab carries an optional `meta: Record<string, string>` for domain data (e.g., `profileId`, `database`, `table`).

`database-view` tabs are **deduplicated** by `profileId + database` — opening the same database twice focuses the existing tab.

### Application Shell

`Workbench` renders:
- **Activity bar** (left, fixed 48px): Explorer, Servers, AI Models, Tasks icons + Sidebar/Panel toggles
- **Primary sidebar** (resizable, default 260px): switches content by `activeView`
- **Editor area**: renders the `SplitTree` recursively via `EditorNode`
- **Bottom panel** (resizable, default 300px): Output / Problems / Logs tabs
- **Status bar** (bottom, 24px): app name + version

Keyboard shortcuts: `Ctrl+B` = toggle sidebar, `Ctrl+\`` = toggle bottom panel.

### Styling Conventions

- **TailwindCSS v4** with PostCSS — no `tailwind.config.js` (v4 uses CSS-native config).
- CSS custom properties (design tokens) defined in `src/styles/globals.css`.
- Use the `cn()` helper from `src/lib/utils/cn.ts` for conditional class merging: `cn("base", condition && "extra")`.
- Semantic color tokens: `bg-background`, `text-foreground`, `bg-muted`, `bg-accent`, `bg-card`, `text-primary-foreground`, etc.
- Prefer Tailwind utilities over inline styles. Use `style={}` only for dynamic numeric values (widths, heights from state).

### Path Aliases

`@/` resolves to `./src/` (configured in both `tsconfig.json` and `vite.config.ts`).

```ts
import { cn } from "@/lib/utils/cn";
import { useLayoutStore } from "@/state/layoutStore";
```

---

## TypeScript Configuration

Strict mode is fully enabled. The compiler enforces:
- `strict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noFallthroughCasesInSwitch: true`
- Target: `ES2020`, module: `ESNext`, bundler resolution

**Do not** add `// @ts-ignore` or `// @ts-expect-error` except in places already established (e.g., `vite.config.ts` for the Node.js `process` global).

---

## Code Conventions

### General

- **No linter config** (no ESLint) — rely on TypeScript strict mode for correctness.
- Keep components focused. Large view files (like `Workbench.tsx`) may contain colocated sub-components at the bottom of the file; this is intentional.
- Prefer functional components with hooks. No class components.
- Use `crypto.randomUUID()` for ID generation (available in browser and Tauri WebView).

### Adding a new Tauri command

1. Define the Rust function with `#[tauri::command]` in `src-tauri/src/lib.rs`.
2. Register it in the `tauri::generate_handler![]` macro in the `run()` function.
3. Add a typed TypeScript wrapper in `src/lib/db.ts` using `invoke<ReturnType>("command_name", { params })`.
4. Use snake_case for command names and Rust parameters; the Tauri bridge converts them automatically.

### Adding a new Zustand store

1. Create `src/state/<domain>Store.ts`.
2. Define the state interface and the store with `create<State>()`.
3. For persisted state, use `readData`/`writeData` from `src/lib/storage.ts`.
4. Apply debouncing for writes (see `profilesStore.ts` for the pattern).

### Adding a new tab type

1. Add the type literal to `EditorTabType` in `src/state/layoutStore.ts`.
2. Create a corresponding view component in `src/components/views/`.
3. Handle the new type in `EditorNode.tsx` where tabs are rendered.
4. Optionally add deduplication logic in the `openTab` action if needed.

### Imports ordering (convention)

1. React / external libraries
2. Tauri APIs
3. Internal state (`@/state/`)
4. Internal lib utilities (`@/lib/`)
5. Internal components (`@/components/`)

---

## Database Support

Currently **only MySQL/MariaDB** is implemented in the Rust backend (`mysql_async`). The frontend `profilesStore.ts` defines additional `DatabaseType` values (`postgres`, `sqlite`, `mssql`) with UI metadata (labels, colors, default ports), but they are **not yet connected to any backend implementation**. Do not add connection logic for these types without first implementing the corresponding Rust commands.

---

## App Version Injection

Vite injects `__APP_VERSION__` as a global string constant at build time (read from `package.json`). It is typed in `src/vite-env.d.ts` and accessed via `src/lib/appVersion.ts` / `src/hooks/useAppVersion.ts`. Do not hard-code version strings anywhere else.

---

## Sub-projects

### `wgs-updater/` — Cloudflare Worker

Auto-update endpoint consumed by the Tauri updater plugin. Built with **Hono** on Cloudflare Workers. Deployed independently at `wgs-updater.skiddph.com`.

- Entry: `wgs-updater/src/index.ts`
- Config: `wgs-updater/wrangler.jsonc`
- Agent instructions: `wgs-updater/AGENTS.md`
- Full docs: `wgs-updater/README.md`

**Do not** modify this project when working on the desktop app unless the change specifically affects the update protocol.

### `wgs-website/` — Cloudflare Pages

Marketing and SEO website for WorkGrid Studio. Built with **Vite + React**. Deployed at `workgrid-studio.skiddph.com`.

- Entry: `wgs-website/src/`
- Config: `wgs-website/vite.config.ts`
- Full docs: `wgs-website/README.md`

**Do not** modify this project when working on the desktop app.

### `.agent/` — Agent Rules and Workflows

Contains always-on rules and step-by-step task workflows for AI-assisted development:

| File | Purpose |
|---|---|
| `.agent/rules/coding-standards.md` | Senior Desktop Architect persona, priorities, anti-patterns |
| `.agent/workflows/add-editor-tab.md` | End-to-end guide for adding a new tab type |
| `.agent/workflows/add-tauri-command.md` | Adding a Rust command + TypeScript wrapper |
| `.agent/workflows/add-zustand-store.md` | Store creation with persistence and loading guards |

---

## Known Incomplete Areas

- `closeLeaf` in `layoutStore.ts` is a stub (marked `// Merge neighbor logic — TODO`). Avoid triggering it until implemented.
- `modelsStore`, `schemaStore` — stores exist but may have minimal or placeholder implementations.
- Database types other than MySQL/MariaDB are UI-only stubs with no backend support.
- No test suite is configured.
