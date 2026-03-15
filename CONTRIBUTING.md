# Contributing to WorkGrid Studio

Thank you for your interest in contributing! This document explains how to get involved, report issues, and submit changes.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)
- [Development Setup](#development-setup)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Coding Guidelines](#coding-guidelines)
- [Commit Messages](#commit-messages)

---

## Code of Conduct

By participating in this project you agree to be respectful and constructive in all interactions. We will not tolerate harassment, discrimination, or personal attacks of any kind.

---

## Reporting Bugs

Before filing a bug report, please:

1. Search [existing issues](../../issues) to avoid duplicates.
2. Reproduce the issue on the **latest release**.
3. Check the [SECURITY.md](SECURITY.md) — if the bug is a security vulnerability, **do not open a public issue**.

When ready, open a new issue using the **Bug Report** template and fill in all requested fields.

---

## Requesting Features

Feature requests are welcome. Before submitting:

1. Search [existing issues](../../issues) to see if it has already been proposed.
2. Consider whether the feature fits the scope of a desktop database management tool.

Open a new issue using the **Feature Request** template and describe the problem you are trying to solve, not just the solution.

---

## Development Setup

See the [README](README.md) for full install instructions. Quick summary:

```bash
# 1. Install Node.js (LTS) and enable pnpm
corepack enable && corepack prepare pnpm@latest --activate

# 2. Install Rust stable
rustup default stable

# 3. Install Tauri system prerequisites
# https://v2.tauri.app/start/prerequisites/

# 4. Clone the repo and install dependencies
git clone https://github.com/<owner>/workgrid-studio.git
cd workgrid-studio
pnpm install

# 5. Start the full desktop app in development mode
pnpm tauri dev
```

---

## Submitting a Pull Request

1. **Fork** the repository and create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes.** Keep commits focused — one logical change per commit.

3. **Type-check** before pushing:
   ```bash
   pnpm build
   ```
   This runs `tsc`, Vite build, and version consistency checks. Fix all errors before opening a PR.

4. **Push** your branch and open a pull request against `main`.

5. Fill in the pull request description, including:
   - What the change does and why.
   - Any related issue numbers (`Closes #123`).
   - Screenshots or screen recordings for UI changes.

6. A maintainer will review your PR. Please be responsive to feedback — PRs with no activity for 30 days may be closed.

### Pull request checklist

- [ ] TypeScript strict mode passes (`pnpm build`)
- [ ] No `// @ts-ignore` or `// @ts-expect-error` added without justification
- [ ] UI changes tested in both light and dark themes
- [ ] Version files not manually edited (`package.json` is the single source of truth)
- [ ] No secrets, credentials, or personal data included

---

## Coding Guidelines

- Follow the conventions described in [CLAUDE.md](CLAUDE.md).
- Use **functional components** and hooks — no class components.
- Use the `cn()` helper for conditional Tailwind classes.
- Use `crypto.randomUUID()` for ID generation.
- Keep components focused; avoid mixing unrelated concerns in a single file.
- Do not add ESLint, Prettier, or other tooling configuration without prior discussion.

---

## Commit Messages

Use the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <short summary>
```

Common types: `feat`, `fix`, `refactor`, `style`, `docs`, `chore`, `ci`.

Examples:
```
feat(query-tab): add explain plan view
fix(session): handle reconnect on connection drop
docs: update contributing guide
```

Keep the summary under 72 characters and written in the imperative mood ("add", not "added" or "adds").
