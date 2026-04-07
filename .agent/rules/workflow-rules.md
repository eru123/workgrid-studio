---
trigger: always_on
---

# Instructions

## Commit Rules
- Commit after every task or change unless told otherwise
- Message must be 1–150 characters, single line only — no body, no footer
- No co-author lines, no "Co-Authored-By", no "Generated with", no attribution of any kind
- Use plain imperative English: "add", "fix", "update", "remove", "rename"

## GitHub
- Use `gh` CLI for all GitHub operations
- Use `/issue <number>` to read an issue with all its comments
- Use `/pr <number>` to read a PR with all its reviews and comments
- Reference issues/PRs as `owner/repo#number`

## General
- Short responses, no summaries of what you just did
- Prefer editing existing files over creating new ones

## Execution Rules
- NEVER run or auto-run the dev server (`pnpm dev`, `pnpm tauri dev`, etc.) yourself.
- NEVER run or auto-run the build command (`pnpm build`, `tsc`, etc.) yourself.
- Assume the user is managing the dev server in a separate terminal. Ask the user to run these commands if they are needed.
