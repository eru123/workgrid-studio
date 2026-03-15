export const PRIVACY_POLICY_EFFECTIVE_DATE = "2026-03-14";

export interface PrivacyPolicySection {
  title: string;
  paragraphs: string[];
}

export const privacyDisclosurePoints = [
  "WorkGrid Studio does not include product telemetry or analytics.",
  "Database connection details are stored locally on this machine. Saved secrets are encrypted before they are written to disk.",
  "When you use AI features, your prompt, selected schema context, and relevant editor text are sent to your configured AI provider.",
  "When update checks are enabled, the app sends its current version and platform target to the configured update endpoint.",
  "You can disable AI requests and update checks at any time in Settings > Privacy.",
];

export const privacyPolicySections: PrivacyPolicySection[] = [
  {
    title: "What the app stores locally",
    paragraphs: [
      "WorkGrid Studio stores connection profiles, encrypted saved credentials, model/provider settings, tasks, query history, layout preferences, and local log files under your user profile in .workgrid-studio.",
      "The app may also store AI request previews, known SSH host fingerprints, and a local secret key used to protect saved secrets on this installation.",
    ],
  },
  {
    title: "What the app sends over the network",
    paragraphs: [
      "Database credentials are only sent to the database server or SSH host you explicitly configure.",
      "AI features send your prompt content and, when available, schema context such as database names, table names, column names, and current editor text to the AI provider you selected.",
      "Update checks send the current app version and platform target to the configured update service so the app can determine whether a newer version exists.",
    ],
  },
  {
    title: "What the app does not collect",
    paragraphs: [
      "WorkGrid Studio does not include telemetry, analytics, ad tracking, or background data collection for product usage.",
      "The project does not upload your database content anywhere unless you explicitly run a feature that connects to a database, AI provider, or update service.",
    ],
  },
  {
    title: "Your controls",
    paragraphs: [
      "You can disable all AI requests with the global Do not send data to AI switch in Settings > Privacy.",
      "You can disable update checks, clear all log files, or use Delete all data to wipe the local application directory, vault data, cached files, and logs from this machine.",
    ],
  },
];
