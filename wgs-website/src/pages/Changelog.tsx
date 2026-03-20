import { useState } from "react";
import changelogRaw from "../../../CHANGELOG.md?raw";
import { usePageTitle } from "../hooks/usePageTitle";
import { PAGE_META } from "../seo";

const PAGE_SIZE = 3;

interface ChangeEntry {
  version: string;
  date: string;
  items: string[];
}

function parseChangelog(raw: string): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  let current: ChangeEntry | null = null;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/\r$/, ""); // strip Windows CRLF
    const versionMatch = line.match(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/);
    if (versionMatch) {
      if (current) entries.push(current);
      current = { version: versionMatch[1], date: versionMatch[2], items: [] };
      continue;
    }
    if (current && line.startsWith("- ")) {
      current.items.push(line.slice(2).trim());
    }
  }

  if (current) entries.push(current);
  return entries;
}

const entries = parseChangelog(changelogRaw);

export function Changelog() {
  usePageTitle(PAGE_META["/changelog"].title);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const shown = entries.slice(0, visible);
  const hasMore = visible < entries.length;

  return (
    <div className="inner-page container">
      <div className="inner-hero fade-up">
        <p className="eyebrow">History</p>
        <h1 className="inner-title">Changelog</h1>
        <p className="inner-lead">
          A record of every released version. Unreleased changes are not shown
          here &mdash; follow{" "}
          <a
            href="https://github.com/eru123/workgrid-studio"
            target="_blank"
            rel="noopener noreferrer"
          >
            the repository
          </a>{" "}
          for in-progress work.
        </p>
      </div>

      <div className="changelog-list fade-up" style={{ animationDelay: "100ms" }}>
        {entries.length === 0 ? (
          <p style={{ color: "var(--text-soft)" }}>No released versions yet.</p>
        ) : (
          <>
            {shown.map((entry) => (
              <article key={entry.version} className="changelog-entry">
                <header className="changelog-entry-header">
                  <div className="changelog-version-badge">v{entry.version}</div>
                  <time className="changelog-date" dateTime={entry.date}>
                    {new Date(entry.date + "T00:00:00").toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </time>
                  <a
                    href={`https://github.com/eru123/workgrid-studio/releases/tag/app-v${entry.version}`}
                    className="changelog-gh-link"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View v${entry.version} on GitHub`}
                  >
                    GitHub Release ↗
                  </a>
                </header>
                {entry.items.length > 0 && (
                  <ul className="changelog-items">
                    {entry.items.map((item, i) => (
                      <li key={i} dangerouslySetInnerHTML={{ __html: mdBold(item) }} />
                    ))}
                  </ul>
                )}
              </article>
            ))}

            {hasMore && (
              <div className="changelog-show-more">
                <button
                  className="ghost-link changelog-more-btn"
                  onClick={() => setVisible((v) => v + PAGE_SIZE)}
                >
                  <span>
                    Show {Math.min(PAGE_SIZE, entries.length - visible)} more
                  </span>
                  <span aria-hidden="true">↓</span>
                </button>
                <span className="changelog-count">
                  Showing {visible} of {entries.length} releases
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Naively convert **bold** markdown to <strong> for changelog items. */
function mdBold(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
