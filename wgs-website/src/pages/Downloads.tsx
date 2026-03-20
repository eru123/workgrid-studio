import changelogRaw from "../../../CHANGELOG.md?raw";
import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { PAGE_META } from "../seo";

function getLatestVersion(raw: string): string {
  const match = raw.match(/^## \[(\d+\.\d+\.\d+)\]/m);
  return match ? match[1] : "latest";
}

// ── Platform SVG icons ───────────────────────────────────────────────────────

function WindowsIcon() {
  // Classic 4-pane flag shape (perspective grid, original SVG)
  return (
    <svg className="platform-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 5.55 11.5 4.3V12H3zM12.5 4.12 21 2.87V12h-8.5zM3 13h8.5v7.7L3 19.45zM12.5 13H21v8.18L12.5 19.88z" />
    </svg>
  );
}

function AppleIcon() {
  // Apple logo silhouette — standard platform indicator (nominative use)
  return (
    <svg className="platform-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function LinuxIcon() {
  // Terminal window with >_ prompt — universal Linux symbol (original SVG)
  return (
    <svg className="platform-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="18" rx="2.5" />
      <polyline points="6 9 9.5 12 6 15" />
      <line x1="12" y1="15" x2="18" y2="15" />
    </svg>
  );
}

const PLATFORM_ICONS: Record<string, () => React.ReactElement> = {
  Windows: WindowsIcon,
  macOS: AppleIcon,
  Linux: LinuxIcon,
};

const LATEST = getLatestVersion(changelogRaw);
const TAG = `app-v${LATEST}`;
const RELEASE_URL = `https://github.com/eru123/workgrid-studio/releases/tag/${TAG}`;
const LATEST_URL = "https://github.com/eru123/workgrid-studio/releases/latest";

const platforms = [
  {
    name: "Windows",
    description: "Windows 10 or later (64-bit)",
    files: [
      {
        label: "NSIS Installer (.exe)",
        note: "Recommended",
        filename: `WorkGrid.Studio_${LATEST}_x64-setup.exe`,
      },
      {
        label: "MSI Package (.msi)",
        note: "",
        filename: `WorkGrid.Studio_${LATEST}_x64_en-US.msi`,
      },
    ],
  },
  {
    name: "macOS",
    description: "macOS 11 Big Sur or later (Apple Silicon & Intel)",
    files: [
      {
        label: "Universal DMG (.dmg)",
        note: "Recommended — runs natively on both Apple Silicon and Intel",
        filename: `WorkGrid.Studio_${LATEST}_universal.dmg`,
      },
    ],
  },
  {
    name: "Linux",
    description: "x86-64 Linux distributions",
    files: [
      {
        label: "AppImage (.AppImage)",
        note: "Recommended — works on most distros, no install needed",
        filename: `workgrid-studio_${LATEST}_amd64.AppImage`,
      },
      {
        label: "Debian / Ubuntu (.deb)",
        note: "",
        filename: `workgrid-studio_${LATEST}_amd64.deb`,
      },
    ],
  },
];

export function Downloads() {
  usePageTitle(PAGE_META["/downloads"].title);
  return (
    <div className="inner-page container">
      <div className="inner-hero fade-up">
        <p className="eyebrow">Free · Open Source</p>
        <h1 className="inner-title">Download WorkGrid Studio</h1>
        <p className="inner-lead">
          Latest release: <strong>v{LATEST}</strong>. Under 10 MB on all
          platforms. No account, no subscription, no telemetry.
        </p>
      </div>

      <div className="downloads-grid fade-up" style={{ animationDelay: "100ms" }}>
        {platforms.map((platform) => {
          const PlatformIcon = PLATFORM_ICONS[platform.name];
          return (
          <div key={platform.name} className="download-card">
            <div className="download-card-header">
              <span className="download-icon">
                {PlatformIcon && <PlatformIcon />}
              </span>
              <div>
                <h2 className="download-platform">{platform.name}</h2>
                <p className="download-req">{platform.description}</p>
              </div>
            </div>
            <div className="download-files">
              {platform.files.map((file) => (
                <a
                  key={file.filename}
                  href={`https://github.com/eru123/workgrid-studio/releases/download/${TAG}/${file.filename}`}
                  className="download-file-link"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="download-file-info">
                    <span className="download-file-label">{file.label}</span>
                    {file.note && (
                      <span className="download-file-note">{file.note}</span>
                    )}
                  </div>
                  <span className="download-arrow" aria-hidden="true">↓</span>
                </a>
              ))}
            </div>
          </div>
          );
        })}
      </div>

      {/* Release page link */}
      <div className="downloads-footer fade-up" style={{ animationDelay: "200ms" }}>
        <p>
          Can't find your platform or need a different build?{" "}
          <a href={RELEASE_URL} target="_blank" rel="noopener noreferrer">
            View all assets for v{LATEST} on GitHub
          </a>
          {" · "}
          <a href={LATEST_URL} target="_blank" rel="noopener noreferrer">
            Always latest release
          </a>
        </p>
      </div>

      {/* Updater note */}
      <div
        className="downloads-notice fade-up"
        style={{ animationDelay: "240ms" }}
        role="note"
      >
        <strong>Note about the in-app updater:</strong> The auto-updater is
        built-in and functional, but the current release process does not
        publish the update manifest files required by Tauri's updater. As a
        result, the app will always report that it is up to date regardless of
        the installed version. Please check this page or{" "}
        <a
          href="https://github.com/eru123/workgrid-studio/releases"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub Releases
        </a>{" "}
        manually for new versions. See the{" "}
        <Link to="/docs#updater">documentation</Link> for more detail.
      </div>
    </div>
  );
}
