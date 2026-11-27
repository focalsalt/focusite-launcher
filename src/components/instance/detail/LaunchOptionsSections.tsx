import React, { useEffect, useId, useState } from "react";
import { Braces, Gamepad2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { instanceService } from "@/services/instanceService";
import type { MinecraftInstance } from "@/types/navigation";
import { formatEnvVars, parseEnvVars, splitArgs } from "@/lib/launchOptions";
import { toast } from "@/lib/toast";
import { toUserMessage } from "@/lib/errorMessage";
import { useI18n } from "@/i18n";
import { SectionHeading } from "./shared";

interface LaunchOptionsSectionsProps {
  instance: MinecraftInstance;
  onInstanceUpdated?: (updated: MinecraftInstance) => void;
}

/** Game arguments and environment variables of one instance. */
export const LaunchOptionsSections: React.FC<LaunchOptionsSectionsProps> = ({ instance, onInstanceUpdated }) => {
  const { t } = useI18n();
  const id = useId();
  const [gameArgs, setGameArgs] = useState<string>("");
  const [envText, setEnvText] = useState<string>("");

  // Re-sync the editable fields when another instance is shown.
  useEffect(() => {
    setGameArgs(instance.customGameArgs?.join(" ") ?? "");
    setEnvText(formatEnvVars(instance.environmentVars));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id]);

  const save = async (settings: Parameters<typeof instanceService.updateInstanceSettings>[1]) => {
    try {
      onInstanceUpdated?.(await instanceService.updateInstanceSettings(instance.id, settings));
      toast(t.instSettings.jvmUpdated, "success");
    } catch (err) {
      toast(toUserMessage(err), "error");
    }
  };

  const saveEnv = () => {
    const parsed = parseEnvVars(envText);
    if ("invalidLine" in parsed) {
      toast(t.instSettings.envInvalid(parsed.invalidLine), "error");
      return;
    }
    void save({ environmentVars: parsed.vars });
  };

  return (
    <>
      <section className="space-y-3">
        <SectionHeading
          icon={<Gamepad2 className="h-4 w-4 text-brand-light" />}
          title={t.instSettings.gameArgsTitle}
          description={t.instSettings.jvmHint}
        />
        <div className="flex gap-2 pt-1">
          <Input
            value={gameArgs}
            onChange={(e) => setGameArgs(e.target.value)}
            placeholder={t.instSettings.jvmPlaceholder}
            aria-label={t.instSettings.gameArgsTitle}
            className="h-9 border-white/10 bg-black/30 font-mono text-xs"
          />
          <Button size="sm" onClick={() => void save({ customGameArgs: splitArgs(gameArgs) })} className="h-9 shrink-0 px-4 text-xs">
            {t.common.save}
          </Button>
        </div>
      </section>

      <div className="h-px w-full bg-white/5" />

      <section className="space-y-3">
        <SectionHeading
          icon={<Braces className="h-4 w-4 text-brand-light" />}
          title={t.instSettings.envTitle}
          description={t.instSettings.envDesc}
        />
        <div className="flex items-start gap-2 pt-1">
          <textarea
            id={id}
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            placeholder="NAME=value"
            aria-label={t.instSettings.envTitle}
            rows={3}
            spellCheck={false}
            className="w-full resize-y rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-xs text-slate-100 placeholder:text-slate-400"
          />
          <Button size="sm" onClick={saveEnv} className="h-9 shrink-0 px-4 text-xs">
            {t.common.save}
          </Button>
        </div>
      </section>
    </>
  );
};
