---
description: Fetch a GitHub PR with all comments and reviews. Usage: /pr <number>
---

Fetch and display a GitHub PR with all comments and reviews.

Parse the input for the PR number. Detect repo with `gh repo view --json nameWithOwner -q .nameWithOwner` if not provided.

Steps:
1. `gh pr view <number> --repo <owner/repo> --json number,title,body,state,author,baseRefName,headRefName,createdAt,reviewDecision`
2. `gh api repos/<owner/repo>/issues/<number>/comments --paginate --jq '.[] | {author: .user.login, body, createdAt: .created_at}'`
3. `gh api repos/<owner/repo>/pulls/<number>/comments --paginate --jq '.[] | {author: .user.login, body, path, line, createdAt: .created_at}'`
4. `gh api repos/<owner/repo>/pulls/<number>/reviews --paginate --jq '.[] | {author: .user.login, state, body, submittedAt: .submitted_at}'`
5. Display: PR details, full body, reviews, inline comments grouped by file, general comments in order.

If no PR number is provided: `gh pr list --limit 20`
