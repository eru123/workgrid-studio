# Changelog

## [Unreleased]
- Re-write UI and Backend engine for better performance and UI/UX improvement.

## [0.1.10] - 2026-03-21
- Fix errors on website deployment via cloudflare pages.

## [0.1.9] - 2026-03-20
- Replaced the libssh2-based SSH implementation with russh, a pure Rust SSH library. This change improves security, reduces dependencies, and provides better async support.
- Added docker support for SSH connections, you can now pass container name with ssh to automatically get the host ip address for you.
- Update project's website, new pages are implemented such as Documentation, Changelogs, Contact Us, About Us and Download Page.

## [0.1.8] - 2026-03-17
- **Explorer & Database View:** Auto-loads tables for filtered databases, hides empty databases, and reorganizes database view tabs for a cleaner navigation flow.
- **Connection Flow & SSH Compatibility:** Adds connection cancellation support, improves SSH key handling, and expands compatibility with OpenSSH key formats.
- **SSH Tunneling:** Simplifies the SSH tunnel implementation with a single-threaded bidirectional copy model to reduce connection complexity.
- **Diagnostics & Error Handling:** Enhances SSH/MySQL connection logging with clearer failure reporting to make connection issues easier to debug.
- **Dependencies:** Refreshes the main JavaScript dependency group, updates the `wgs-updater` workspace dependencies, and bumps Rust `rand` from `0.8.5` to `0.9.2`.
- **Maintenance:** Ignores test artifacts to keep the release and repository noise down.

## [0.1.7] - 2026-03-16
- **Workspace & Layout:** Added comprehensive project setup and layout management, and removed the legacy results tab flow to simplify the editor workspace.
- **Grid & Query UX:** Improved table data grid stability with fixed-width sticky columns and clearer selected-cell styling for better scanability.
- **Stability & Polish:** Resolved store-selector crashes caused by nullish coalescing and bundled broader UI/UX fixes surfaced during internal testing.
- **Contributor Experience:** Updated contribution guidelines to cover linting and pre-commit hook expectations.

## [0.1.6] - 2026-03-15
- **[Breaking] Vault & Security:** Migrated to secure, per-installation vault encryption via the OS credential store. Added Content Security Policy (CSP) and restricted file-system permissions.
- **Networking & SSH:** Overhauled SSH tunneling to fix memory leaks and thread hanging. Replaced basic host key logging with TOFU (Trust On First Use) verification and added connection auto-reconnects.
- **Query & Data Operations:** Added "Explain Plan", sorting, and results virtualization for performance. Grid data can now be exported to JSON/CSV/SQL, and CSV imports are fully transactional with progress tracking.
- **UI & Workspace:** Introduced edge drop-zones for tab splitting, a loading skeleton for query history, ping latency indicators, and full keyboard/ARIA support for editor tabs.
- **Core backend & AI:** Modularized the Rust backend, optimized AI query generation, resolved cryptographic vulnerabilities, and added failsafes for corrupted AI logs.
- **Ecosystem:** Launched the `wgs-website` React workspace, refreshed application branding/icons, and formalized open-source contribution and security policies.
- **Maintenance:** Consolidated logging systems, updated CI/CD workflows, bumped dependencies, and improved the app updater endpoint.
- Create ci.yml

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
