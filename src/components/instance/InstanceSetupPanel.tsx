import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { instanceService } from "@/services/instanceService";
import { useVersionManifest, VersionLoaderFields } from "./VersionLoaderFields";
import { LoaderType, MinecraftInstance } from "@/types/navigation";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { useI18n } from "@/i18n";

const LOADERS: readonly LoaderType[] = ["Vanilla", "Fabric", "Forge", "NeoForge", "Quilt"];

interface InstanceSetupPanelProps {
  instance: MinecraftInstance;
  onDone: (updated: MinecraftInstance) => void;
  onBack?: () => void;
}

/** Shown instead of the instance page for a folder that has no config of ours yet. */
export const InstanceSetupPanel: React.FC<InstanceSetupPanelProps> = ({ instance, onDone, onBack }) => {
  const { t } = useI18n();
  const { manifest, isLoading } = useVersionManifest(true);
  const [name, setName] = useState<string>(instance.name);
  const [version, setVersion] = useState<string>("");
  const [loader, setLoader] = useState<LoaderType>("Vanilla");
  const [loaderVersion, setLoaderVersion] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const needsLoaderVersion = loader !== "Vanilla";
  const canSave = !!version && (!needsLoaderVersion || !!loaderVersion) && !isSaving;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      onDone(
        await instanceService.setupInstance({
          instanceId: instance.id,
          name: name.trim(),
          version,
          loader,
          loaderVersion: needsLoaderVersion ? loaderVersion : undefined,
        }),
      );
    } catch (err) {
      toast(toUserMessage(err), "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 p-8 select-none">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-bold text-white">{t.inst.setupTitle}</h2>
          <p className="text-xs leading-relaxed text-slate-400">{t.inst.setupDesc}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-slate-300">{t.inst.setupName}</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 bg-black/30" />
      </div>

      <VersionLoaderFields
        isOpen
        loaders={LOADERS}
        manifest={manifest}
        isLoadingVersions={isLoading}
        version={version}
        onVersionChange={setVersion}
        loader={loader}
        onLoaderChange={setLoader}
        loaderVersion={loaderVersion}
        onLoaderVersionChange={setLoaderVersion}
      />

      <div className="flex justify-end gap-2">
        {onBack && (
          <Button type="button" variant="ghost" onClick={onBack} className="text-xs text-slate-400 hover:text-white">
            {t.inst.backToList}
          </Button>
        )}
        <Button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="bg-brand text-xs font-semibold text-white hover:bg-brand-light"
        >
          {t.inst.setupConfirm}
        </Button>
      </div>
    </div>
  );
};
