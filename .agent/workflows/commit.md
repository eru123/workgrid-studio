---
description: Stage and commit all changes with a short message. No co-author. Max 150 chars.
---

Stage all changes and commit. Rules:
1. Run `git status` and `git diff HEAD` to understand what changed
2. Run `git add -A`
3. Write a commit message: imperative mood, 1–150 chars, single line, NO co-author, NO body, NO attribution
4. Run `git commit -m "<message>"`
5. Show result with `git log --oneline -1`
