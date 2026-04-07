---
description: Check unreleased changelog items, summarize by business value (max 150 chars per item)
---
1. Use `view_file` to read the `CHANGELOG.md` file and locate the `[Unreleased]` section.
2. Extract all the list items located under the `[Unreleased]` section.
3. Consolidate and rewrite these items into a proper list from a **higher business point-of-view** (POV). Focus on user impact, features, enhancements, or resolved critical issues rather than technical implementation details.
4. Ensure each new rewritten list item is **1 to 150 characters maximum**.
5. Use `replace_file_content` to safely replace only the `[Unreleased]` block in `CHANGELOG.md` with the newly formatted list.
6. Commit the changes using the message format `docs: format unreleased changelog [skip ci][skip dependabot]` or similar, ensuring exactly `[skip ci][skip dependabot]` is included at the end.
