import React from "react";
import { Check, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n";

/** Order of the backend's `auth-login-step` events. */
const STEPS = ["microsoft", "xbl", "xsts", "minecraft", "profile", "saving"] as const;

/** Checklist shown while the Xbox / Minecraft login chain runs; this stage cannot be cancelled. */
export const LoginSteps: React.FC<{ step: string }> = ({ step }) => {
  const { t } = useI18n();
  const labels: Record<(typeof STEPS)[number], string> = {
    microsoft: t.auth.stepMicrosoft,
    xbl: t.auth.stepXbl,
    xsts: t.auth.stepXsts,
    minecraft: t.auth.stepMinecraft,
    profile: t.auth.stepProfile,
    saving: t.auth.stepSaving,
  };
  const current = STEPS.indexOf(step as (typeof STEPS)[number]);
  return (
    <div className="space-y-3 py-1">
      <p className="text-center text-xs text-slate-400">{t.auth.verifyingNote}</p>
      <ul className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-4 text-xs">
        {STEPS.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s} className={`flex items-center gap-2.5 ${done || active ? "text-slate-100" : "text-slate-400"}`}>
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {done ? (
                  <Check className="h-4 w-4 text-success-400" />
                ) : active ? (
                  <Loader2 className="h-4 w-4 animate-spin text-brand-light" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
                )}
              </span>
              <span>{labels[s]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
