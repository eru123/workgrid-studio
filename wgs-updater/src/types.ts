/**
 * Response payload returned to Tauri's built-in updater when a newer version
 * is available. Shape is defined by the Tauri updater protocol:
 * https://v2.tauri.app/plugin/updater/#server-support
 */
export type UpdateResponse = {
  /** Full GitHub release tag, e.g. "app-v0.1.4" */
  version: string;
  /** Release notes (markdown). Sourced from the GitHub release body. */
  notes: string;
  /** ISO 8601 publish timestamp from the GitHub release. */
  pub_date: string;
  /** Contents of the detached minisign .sig file for the asset. */
  signature: string;
  /** Direct browser download URL for the platform-specific asset. */
  url: string;
};
