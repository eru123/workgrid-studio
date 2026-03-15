import { useAppStore } from "@/state/appStore";
import { useProfilesStore } from "@/state/profilesStore";

interface EnsureAiUseAllowedOptions {
  providerName?: string;
  includesSchemaContext?: boolean;
}

export function ensureAiUseAllowed(
  options: EnsureAiUseAllowedOptions = {},
): boolean {
  const { providerName, includesSchemaContext = true } = options;
  const { globalPreferences, setGlobalPreferences } = useProfilesStore.getState();
  const addToast = useAppStore.getState().addToast;

  if (globalPreferences.blockAiRequests) {
    addToast({
      title: "AI Requests Disabled",
      description:
        "AI features are disabled in Settings > Privacy. Turn off 'Do not send data to AI' to use them again.",
      variant: "destructive",
    });
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
