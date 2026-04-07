---
description: Fetch a GitHub issue and all its comments. Usage: /issue <number>
---

Fetch and display a GitHub issue with all comments.

Parse the input for the issue number. If it contains `owner/repo#number` or `owner/repo number`, use that repo. Otherwise detect with `gh repo view --json nameWithOwner -q .nameWithOwner`.

Steps:
1. `gh issue view <number> --repo <owner/repo> --json number,title,body,state,labels,author,createdAt`
2. `gh api repos/<owner/repo>/issues/<number>/comments --paginate --jq '.[] | {author: .user.login, body, createdAt: .created_at}'`
3. Display: title, number, state, author, date, full body, then each comment with author and date in order.

If no issue number is provided: `gh issue list --limit 20`
