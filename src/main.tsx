import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/App";
import "@/styles/globals.css";

// Register a Trusted Types 'default' policy for WebView2 (Chromium / Windows).
// WebKit (macOS / Linux) does not support Trusted Types — the feature-detect
// guard makes this a no-op on those platforms.
// All HTML injected via dangerouslySetInnerHTML originates from sqlHighlight.ts
// which HTML-escapes every token value with escapeHtml() before building the
// string, so the passthrough policy does not weaken security.
interface TrustedTypePolicyFactory {
    readonly defaultPolicy: unknown;
    createPolicy(name: string, rules: { createHTML?: (s: string) => string }): void;
}
const tt = "trustedTypes" in window
    ? (window as unknown as { trustedTypes: TrustedTypePolicyFactory }).trustedTypes
    : null;
if (tt && !tt.defaultPolicy) {
    tt.createPolicy("default", { createHTML: (s: string) => s });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
