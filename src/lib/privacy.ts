import { useProfilesStore } from "@/state/profilesStore";
import { notifyError } from "@/lib/notifications";

interface EnsureAiUseAllowedOptions {
  providerName?: string;
  includesSchemaContext?: boolean;
}

export function ensureAiUseAllowed(
  options: EnsureAiUseAllowedOptions = {},
): boolean {
  const { providerName, includesSchemaContext = true } = options;
  const { globalPreferences, setGlobalPreferences } = useProfilesStore.getState();

  if (globalPreferences.blockAiRequests) {
    notifyError(
      "AI Requests Disabled",
      "AI features are disabled in Settings > Privacy. Turn off 'Do not send data to AI' to use them again.",
    );
    return false;
  }

  if (globalPreferences.aiPromptWarningAcceptedAt) {
    return true;
  }

  const destination = providerName ? ` to ${providerName}` : "";
  const schemaNotice = includesSchemaContext
    ? "This request can send your prompt, selected schema context, and editor text"
    : "This request sends your prompt";
  const confirmed = window.confirm(
    `${schemaNotice}${destination}.\n\nYou can disable all AI requests any time in Settings > Privacy.\n\nContinue?`,
  );

  if (!confirmed) {
    return false;
  }

  setGlobalPreferences({ aiPromptWarningAcceptedAt: Date.now() });
  return true;
}
