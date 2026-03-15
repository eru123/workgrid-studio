# Changelog

## [Unreleased]
- feat: add comprehensive project setup and layout management
- Update contribution guidelines to include linting and pre-commit hooks
- chore: bump workgrid-studio version to 0.1.6
- chore: bump version to v0.1.6

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
