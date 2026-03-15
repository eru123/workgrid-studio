# Changelog

## [Unreleased]
- refactor: add import result type and host key management UI
- refactor: update db import functions and add host key management
- Add forget_host_key function to Tauri command exports
- refactor: update db_import_csv return type to structured format
- refactor: replace leak-prone tunnel shutdown with bounded join and channel signaling
- chore: expand file system permissions and improve file dialog UX
- feat: add OS credential store integration for vault encryption keys
- feat: load query history on app initialization
- refactor: optimize CSV import with transaction and error handling
- refactor: improve tunnel shutdown and thread cleanup
- fix: Properly clean up SSH tunnel threads on reconnect
- refactor: replace basic SSH host key logging with TOFU verification
- chore: restrict file system permissions to user home directory
- build(security): add Content Security Policy for Tauri app
- fix(vault)!: use secure per-installation encryption key
- Update changelog-on-push.yml
- fix(deps): update dependencies and lockfile for improved compatibility
- chore: fix missing newline in tauri configuration file
- fix: update updater endpoint to handle multiple bundle types and improve CORS support
- Modularized the rust backend
- feat: add edge drop zones for tab splitting and improve drag-and-drop UX
- feat: add per-profile ping latency display in explorer tree
- feat: enhance cell context menu with JSON/CSV/SQL export and add search functionality
- Update manual-multi-platform-build.yml
- chore: bump workgrid-studio version to 0.1.5 in Cargo.lock
- Potential fix for code scanning alert no. 5: Hard-coded cryptographic value
- refactor: optimize AI query generation and database operations
- fix: Handle corrupted AI logs gracefully with backup creation
- Fix search navigation and selection bounds in ExplorerTree
- refactor(ssh): improve tunnel shutdown logic with proper thread joining
- refactor: replace RngCore with Rng for improved randomness generation
- refactor: simplify secret key management and improve reliability
- refactor: consolidate output logging and enhance bottom panel UX
- Potential fix for code scanning alert no. 17: Hard-coded cryptographic value
- feat: add loading state and skeleton UI for query history
- refactor: simplify timestamp generation using chrono crate
- fix: correct sash direction and cursor styling for layout panels
- chore: add license section to README
- feat: add bundle analyzer and virtualization for query results
- feat: enhance editor tabs with keyboard navigation and ARIA accessibility
- feat(privacy): add comprehensive privacy controls and disclosure
- feat(connection): add auto-reconnect and structured error handling
- style(query-tab): prevent text wrapping in toolbar controls
- feat: add GitHub issue templates and update README with contribution guidelines

## [0.1.5] - 2026-03-14
- Exclude main branch from changelog workflow
- Add environment variable for Node.js version
- Update manual-multi-platform-build.yml
- docs(project): overhaul project documentation and updater service
- feat: Implement a new API endpoint for Tauri update checks using GitHub releases.
- Create dependabot.yml

## [0.1.4] - 2026-03-14
- Add GitHub Actions workflow to update changelog
- Enhance manual build workflow for versioning and changelog    
- feat(changelog): introduce automated changelog management

## [0.1.3] - 2026-03-14
- feat: add clear_ai_logs function to Tauri API
- chore: bump version to v0.1.2
- feat: initial multi-platform CI/CD build workflow
