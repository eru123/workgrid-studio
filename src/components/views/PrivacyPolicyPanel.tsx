import {
  PRIVACY_POLICY_EFFECTIVE_DATE,
  privacyPolicySections,
} from "@/content/privacyPolicy";

export function PrivacyPolicyPanel() {
  return (
    <div className="rounded-lg border bg-muted/10">
      <div className="border-b px-4 py-3">
        <p className="font-medium">Privacy Policy</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Effective {PRIVACY_POLICY_EFFECTIVE_DATE}
        </p>
      </div>
      <div className="max-h-80 space-y-4 overflow-y-auto px-4 py-4 text-xs leading-relaxed">
        {privacyPolicySections.map((section) => (
          <section key={section.title} className="space-y-1.5">
            <h4 className="font-medium text-foreground">{section.title}</h4>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
