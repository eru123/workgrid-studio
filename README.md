# WorkGrid Studio

WorkGrid Studio is a cross-platform desktop database management app built with **Tauri 2**, **React 19**, **TypeScript**, and **Vite**.

---

> 📢 **July 7, 2026 - Announcement:** I just started the rewrite of the whole codebase and we will now disregard all development that was previously made and start to do a serious development, we will use existing OSS codebase from different repo moving forward.

---

> 📢 **July 4, 2026 - Announcement:** I had enough with AI fast-pace current ecosystem, when new model appearing almost monthly or weekly, we also ship new solution to new problems, ideas keep popping up before the first project even ship to production or even before the demo to users, so I am thinking to change how things work in this repository. This repository is meant to be a centralized database client, but on the process we encounter multiple problems including with SSH, Docker, Kubernetes, cloud-native database servers, and etc., while we solved those problem, we also encoutering more drawbacks, new ideas and solution, and realizing that it will go nowhere (I know we are doing this wrong; I am just one person you know? don't even get a star). So as of today, my decision will be a complete rewrite of the repo, we will keep the centralized database, but we will have a built-in Socker-based SSH, FTP, File Explorer, GPT for Agentic Coding, Code Editor and Extension System, although this already exist in the repo, we will have a complete rewrite because our initial implementation is wrong.

---

## 📋 Task Backlog (for delegated agents)

Benchmarked against HeidiSQL's feature set. Each item is scoped to be picked up by an independent agent.
**Legend:** 🔴 P0 (blocks daily use) · 🟠 P1 (core parity) · 🟡 P2 (differentiator) · 🟢 P3 (nice-to-have)

### Phase 1 — Database Engine Coverage (🔴 P0)
> WGS currently only has a real MySQL driver. Postgres/SQLite/MSSQL are stubs returning `not_implemented`. HeidiSQL covers 7 engines.

- [ ] **TASK-001 · Implement PostgreSQL driver** 🔴
  - File: `src-tauri/src/drivers/postgres.rs` (stub). Add deps to `Cargo.toml` (`deadpool-postgres` + `tokio-postgres`).
  - Implement `DbDriver` trait: `connect`, `disconnect`, `ping`, `begin_session`, `end_session`, `query`, `execute`, introspection.
  - Wire into `ConnectionManager` (`services/connection.rs`), `models` (`ColumnInfo`, `TableInfo`, `QueryResultSet`).
  - Acceptance: `db_query`/`db_list_tables` work against a live Postgres DB.
- [ ] **TASK-002 · Implement SQLite driver** 🔴
  - File: `src-tauri/src/drivers/sqlite.rs` (stub). Add `rusqlite` (use `spawn_blocking` for sync API).
  - Support file-based + in-memory DBs. Reuse `ConnectParams` (path in host field).
- [ ] **TASK-003 · Implement MSSQL driver** 🔴
  - File: `src-tauri/src/drivers/mssql.rs` (stub). Add `tiberius`.
  - Support Windows/SQL auth, named instances, encryption.

### Phase 2 — Data Grid (🔴 P0)
> HeidiSQL's VirtualTree grid supports inline edit, filter, sort, BLOB/hex. WGS has a workbench shell but no functional data grid yet.

- [ ] **TASK-010 · Data grid: render + inline edit** 🔴
  - Area: `src/wg/editor` + a new `src/wg/grid` module. Consume `QueryResultSet` from `db_query`.
  - Cell editing → `db_execute` with generated UPDATE/INSERT. Support NULL, types.
- [ ] **TASK-011 · Data grid: filter + sort + pagination** 🟠
  - Client + server-side WHERE filtering, column sort, lazy page fetch for large result sets.
- [ ] **TASK-012 · BLOB / binary + hex editor** 🟡
  - Modal editor for binary columns (`bineditor.pas` equivalent). Download/upload, hex view.

### Phase 3 — Import / Export (🟠 P1)
- [ ] **TASK-020 · Export module** 🟠
  - New Rust command `export.rs` + TS UI. Formats: SQL (insert/insert-ignore/replace/update), CSV, JSON, Markdown, HTML, XML, clipboard + file. Target: file, clipboard, or cross-server (like HeidiSQL `exportgrid.pas`).
- [ ] **TASK-021 · Import module (CSV/text)** 🟠
  - New `import.rs`. Delimiter auto-detection (`csv_detector.pas` reference), column mapping, batch insert. Supports binary file batch-insert.
- [ ] **TASK-022 · CSV delimiter auto-detector** 🟡
  - Standalone util: sniff separator/encloser/terminator/null token from sample.

### Phase 4 — Object Editors (🟠 P1)
- [ ] **TASK-030 · Table editor (create/alter)** 🟠 — columns, types, PK/FK, indexes, engine, collation.
- [ ] **TASK-031 · View editor** 🟠 — `view.pas` equivalent.
- [ ] **TASK-032 · Stored routine editor** 🟠 — procedures/functions (`routine_editor.pas`).
- [ ] **TASK-033 · Trigger editor** 🟡 — `trigger_editor.pas`.
- [ ] **TASK-034 · Scheduled event editor** 🟡 — `event_editor.pas` (MySQL/MariaDB).

### Phase 5 — SQL Tooling (🟠 P1)
- [ ] **TASK-040 · Query editor enhancements** 🟠 — beyond base Monaco: schema-aware autocomplete, SQL formatter/reformatter (`reformatter.pas`), inline SQL help.
- [ ] **TASK-041 · Schema sync / diff tool** 🟡 — `syncdb.pas` equivalent: diff two databases (structure+data), generate create/alter/insert SQL, apply. Strong differentiator.
- [ ] **TASK-042 · Find text on whole server** 🟡 — search a string across all tables/columns of a server (`actFindTextOnServer`).

### Phase 6 — Server / Admin Tools (🟡 P2)
- [ ] **TASK-050 · Processlist monitor + kill** 🟡 — `qKillQuery`/`qKillProcess` (`dbstructures.*.pas`).
- [ ] **TASK-051 · Table maintenance** 🟡 — optimize/repair/analyze in batch (`tabletools.pas`).
- [ ] **TASK-052 · User & role manager** 🟡 — privileges, roles, auth plugins (`usermanager.pas`).
- [ ] **TASK-053 · SSL / TLS connection settings** 🟠 — add SSL fields to `ConnectParams` + driver handshake (MySQL has it; extend PG/MSSQL).

### Phase 7 — Platform & DX (🟢 P3)
- [ ] **TASK-060 · Extension / plugin system** 🟢 — per README rewrite goal.
- [ ] **TASK-061 · Built-in AI agentic SQL help** 🟢 — GPT-for-coding integration mentioned in README.
- [ ] **TASK-062 · Theming / VCL-style parity** 🟢 — custom themes (HeidiSQL has VCL styles + i18n).
- [ ] **TASK-063 · Command-line / headless launch** 🟢 — connect via CLI args (`--login` style).
- [ ] **TASK-064 · i18n framework** 🟢 — Transifex-style translation pipeline.

### Notes for agents
- Backend commands live in `src-tauri/src/commands/`, drivers in `src-tauri/src/drivers/`, models in `src-tauri/src/models/`.
- Frontend shell: `src/wg/shell/`, editor: `src/wg/editor/`, backend bridge: `src/wg/backend/ipc.ts`.
- Reference client: HeidiSQL cloned at `C:\laragon\www\heidisql` (`source/*.pas`) — mirror its UX for parity.
- MySQL is the working reference driver; match its `DbDriver` contract exactly when implementing TASK-001..003.
