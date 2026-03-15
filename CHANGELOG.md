# Changelog

## [Unreleased]
- Add OS credential store integration for vault encryption keys
- Load query history on app initialization with loading state and skeleton UI
- Add edge drop zones for tab splitting and improve drag-and-drop UX
- Add per-profile ping latency display in explorer tree
- Enhance cell context menu with JSON/CSV/SQL export and search functionality
- Add bundle analyzer and virtualization for query results
- Enhance editor tabs with keyboard navigation and ARIA accessibility
- Add comprehensive privacy controls and disclosure
- Add auto-reconnect and structured error handling for connections
- Add wgs-website workspace with React, Vite, and SEO metadata
- Replace SVG favicon with PNG icons and update branding visuals
- Add explain plan, result sorting, and new result tabs to query view
- Add comprehensive security policy, contributing guidelines and issue templates
- Add import result type and host key management UI (`forget_host_key` function)
- Update DB import functions to use transactions, structured returns, and better error/progress handling
- Replace leak-prone SSH tunnel shutdown with bounded join, channel signaling, and proper thread joining
- Replace basic SSH host key logging with TOFU verification
- Modularize the Rust backend and optimize AI query generation/database operations
- Replace `RngCore` with `Rng` for improved randomness generation and simplify secret key management
- Consolidate output logging and enhance bottom panel UX
- Simplify timestamp generation using `chrono` crate
- Reorganize editor tabs and add new tab types
- Remove outdated agent rules and CLAUDE.md to simplify monorepo documentation
- Properly clean up SSH tunnel threads on reconnect
- **[Breaking]** Use secure per-installation encryption key for vault
- Update updater endpoint to handle multiple bundle types and improve CORS support
- Fix potential code scanning alerts for hard-coded cryptographic values (Alerts #5, #17)
- Handle corrupted AI logs gracefully with backup creation
- Fix search navigation and selection bounds in `ExplorerTree`
- Correct sash direction and cursor styling for layout panels
- Prevent text wrapping in query-tab toolbar controls
- Build: Add Content Security Policy (CSP) for Tauri app
- Restrict file system permissions to user home directory and improve file dialog UX

### ⚙️ Chores
- Update dependencies, lockfile, and bump version to `0.1.5`
- Update GitHub Actions workflows (`changelog-on-push.yml`, `manual-multi-platform-build.yml`)
- Fix missing newline in Tauri configuration file
- Add license section to `README`

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
