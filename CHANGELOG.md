# Changelog

## [Unreleased]
- Exclude main branch from changelog workflow
- Add environment variable for Node.js version
- Update manual-multi-platform-build.yml
- docs(project): overhaul project documentation and updater service
- feat: Implement a new API endpoint for Tauri update checks using GitHub releases.
- Create dependabot.yml
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

## [0.1.4] - 2026-03-14
- Add GitHub Actions workflow to update changelog
- Enhance manual build workflow for versioning and changelog    
- feat(changelog): introduce automated changelog management

## [0.1.3] - 2026-03-14
- feat: add clear_ai_logs function to Tauri API
- chore: bump version to v0.1.2
- feat: initial multi-platform CI/CD build workflow
