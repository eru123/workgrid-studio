import { useLayoutStore } from "@/state/layoutStore";
import { useProfilesStore } from "@/state/profilesStore";
import { privacyDisclosurePoints } from "@/content/privacyPolicy";
import { Shield, Settings } from "lucide-react";

export function PrivacyDisclosureModal() {
  const openTab = useLayoutStore((s) => s.openTab);
  const setGlobalPreferences = useProfilesStore((s) => s.setGlobalPreferences);

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border bg-popover shadow-2xl">
        <div className="border-b bg-muted/20 px-5 py-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h2 className="text-sm font-semibold">Before you get started</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            A quick summary of what can leave this machine and how to control it.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4 text-sm">
          {privacyDisclosurePoints.map((point) => (
            <div key={point} className="flex gap-2 text-muted-foreground">
              <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
              <p>{point}</p>
            </div>
          ))}
        </div>

        <div className="border-t bg-muted/10 px-5 py-3">
          <p className="text-[11px] text-muted-foreground">
            Opt out anytime in Settings &gt; Privacy by disabling AI requests or update checks.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setGlobalPreferences({ privacyDisclosureAcceptedAt: Date.now() });
                openTab({ title: "Settings", type: "settings", meta: {} });
              }}
              className="inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs hover:bg-accent transition-colors"
            >
              <Settings className="h-3.5 w-3.5" />
              Review settings
            </button>
            <button
              type="button"
              onClick={() =>
                setGlobalPreferences({ privacyDisclosureAcceptedAt: Date.now() })
              }
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
