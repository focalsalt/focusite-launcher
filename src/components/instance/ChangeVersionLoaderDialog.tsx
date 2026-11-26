import React, { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowRight,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Upload,
  HardDriveDownload,
} from "lucide-react";
import { LoaderType, MinecraftInstance } from "@/types/navigation";
import { instanceService } from "@/services/instanceService";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  workshopService,
  MigrationPlan,
} from "@/services/workshopService";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { loaderDisplayName } from "@/lib/loader";
import { useI18n } from "@/i18n";
import { useVersionManifest, VersionLoaderFields } from "./VersionLoaderFields";

interface ChangeVersionLoaderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instance: MinecraftInstance;
  onSuccess: () => void;
}

const LOADERS: readonly LoaderType[] = ["Vanilla", "Fabric", "Forge", "NeoForge", "Quilt", "Custom"];

/** Pick a jar already stored in the instance's `custom_jar` folder, or add a new one. */
const CustomJarPicker: React.FC<{
  instanceId: string;
  value: string;
  onChange: (name: string) => void;
}> = ({ instanceId, value, onChange }) => {
  const { t } = useI18n();
  const [jars, setJars] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    instanceService
      .listCustomJars(instanceId)
      .then(setJars)
      .catch((err) => toast(toUserMessage(err), "error"));
  }, [instanceId]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const saved = await instanceService.saveCustomJar(instanceId, file.name, bytes);
      setJars((prev) => (prev.includes(saved) ? prev : [...prev, saved].sort()));
      onChange(saved);
      toast(t.changeVer.customJarSaved(saved), "success");
    } catch (err) {
      toast(toUserMessage(err), "error");
    }
  };

  return (
    <div className="space-y-1">
      <label htmlFor="change-jar" className="font-semibold text-xs text-slate-300">{t.changeVer.customJarLabel}</label>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Select value={jars.includes(value) ? value : ""} onValueChange={onChange} disabled={jars.length === 0}>
            <SelectTrigger id="change-jar" className="h-8">
              <SelectValue placeholder={jars.length === 0 ? t.changeVer.customJarNone : t.changeVer.customJarPick} />
            </SelectTrigger>
            <SelectContent className="max-h-56">
              {jars.map((j) => (
                <SelectItem key={j} value={j}>
                  {j}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={() => inputRef.current?.click()}>
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          {t.changeVer.customJarUpload}
        </Button>
        <input ref={inputRef} type="file" accept=".jar" className="hidden" onChange={handleFile} />
      </div>
    </div>
  );
};

export const ChangeVersionLoaderDialog: React.FC<ChangeVersionLoaderDialogProps> = ({
  open,
  onOpenChange,
  instance,
  onSuccess,
}) => {
  const { t } = useI18n();
  const [targetVersion, setTargetVersion] = useState<string>(instance.version);
  const [targetLoader, setTargetLoader] = useState<LoaderType>(instance.loader || "Vanilla");
  const [targetLoaderVersion, setTargetLoaderVersion] = useState<string>(
    instance.loaderVersion || ""
  );

  const { manifest, isLoading: isLoadingVersions } = useVersionManifest(open);
  const [migrationPlan, setMigrationPlan] = useState<MigrationPlan | null>(null);
  const [isPlanning, setIsPlanning] = useState<boolean>(false);
  const [isMigrating, setIsMigrating] = useState<boolean>(false);
  const setErrorMsg = (msg: string) => toast(msg, "error");

  // Always start from the instance's current version/loader when the dialog is (re)opened,
  // and whenever the instance itself changes.
  useEffect(() => {
    if (!open) return;
    setTargetVersion(instance.version);
    setTargetLoader(instance.loader || "Vanilla");
    setTargetLoaderVersion(instance.loaderVersion || "");
    setMigrationPlan(null);
  }, [open, instance.id, instance.version, instance.loader, instance.loaderVersion]);

  // Fabric/Quilt profiles cannot be resolved without an explicit loader version.
  const needsLoaderVersion =
    (targetLoader === "Fabric" || targetLoader === "Quilt" || targetLoader === "Custom") &&
    !targetLoaderVersion.trim();
  // A custom loader has no Minecraft version of its own; the backend stores "Custom" like at creation.
  const effectiveVersion = targetLoader === "Custom" ? "Custom" : targetVersion;

  // Vanilla has no mods to port and Custom has no Modrinth metadata, so neither needs a compatibility check.
  const skipCheck = targetLoader === "Vanilla" || targetLoader === "Custom";

  const runMigration = async (plan: MigrationPlan) => {
    setIsMigrating(true);
    try {
      await workshopService.executeStackMigration(
        instance.id,
        effectiveVersion,
        targetLoader,
        targetLoaderVersion.trim() || null,
        plan
      );
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      setErrorMsg(t.errors.migrateFailed(toUserMessage(err)));
    } finally {
      setIsMigrating(false);
    }
  };

  // Apply: first press checks installed mods (unless Vanilla/Custom); if anything changes, the plan is
  // shown and a second press confirms. A plan that changes nothing applies straight away.
  const handleApply = async () => {
    if (migrationPlan) {
      await runMigration(migrationPlan);
      return;
    }
    if (skipCheck) {
      await runMigration({
        current_version: instance.version,
        current_loader: instance.loader || "Vanilla",
        target_version: effectiveVersion,
        target_loader: targetLoader,
        upgradable: [],
        incompatible: [],
        compatible_unchanged: [],
      });
      return;
    }
    setIsPlanning(true);
    try {
      const plan = await workshopService.planStackMigration(instance.id, effectiveVersion, targetLoader);
      if (plan.upgradable.length === 0 && plan.incompatible.length === 0) {
        setIsPlanning(false);
        await runMigration(plan);
      } else {
        setMigrationPlan(plan);
      }
    } catch (err: any) {
      setErrorMsg(t.errors.planFailed(toUserMessage(err)));
    } finally {
      setIsPlanning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} preventBackdropClose={isMigrating || isPlanning}>
      <DialogContent className="max-w-2xl border-white/10 bg-slate-900/98 p-0 text-slate-100 shadow-2xl backdrop-blur-2xl overflow-hidden space-y-0">
        <DialogHeader className="h-16 shrink-0 justify-center border-b border-white/10 px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-tr from-brand to-brand-dark text-white shadow-md shadow-brand/20">
              <RefreshCw className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-bold text-slate-100">{t.changeVer.title}</DialogTitle>
              <DialogDescription className="truncate text-xs text-slate-400">
                {instance.name} · {instance.version} · {loaderDisplayName(instance.loader, t.common.vanilla)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 p-6">
          <p className="text-xs leading-relaxed text-slate-400">{t.changeVer.desc}</p>

          <div className="space-y-3">
            <VersionLoaderFields
              isOpen={open}
              loaders={LOADERS}
              manifest={manifest}
              isLoadingVersions={isLoadingVersions}
              version={targetVersion}
              onVersionChange={(v) => {
                setTargetVersion(v);
                setMigrationPlan(null);
              }}
              loader={targetLoader}
              onLoaderChange={(l) => {
                setTargetLoader(l);
                setMigrationPlan(null);
              }}
              loaderVersion={targetLoaderVersion}
              onLoaderVersionChange={(v) => {
                setTargetLoaderVersion(v);
                setMigrationPlan(null);
              }}
              customSlot={
                <CustomJarPicker
                  instanceId={instance.id}
                  value={targetLoaderVersion}
                  onChange={(name) => {
                    setTargetLoaderVersion(name);
                    setMigrationPlan(null);
                  }}
                />
              }
            />
          </div>

          {needsLoaderVersion && (
            <p className="text-2xs text-amber-300">
              {t.changeVer.needLoaderVersion(targetLoader)}
            </p>
          )}

          {/* 遷移評估報告 */}
          {migrationPlan && (
            <ScrollArea className="max-h-[35vh] pr-2 -mr-2">
              <div className="space-y-3 pt-2">
                {/* 遷移摘要 */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/10 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-white/60">
                      {migrationPlan.current_version} ({migrationPlan.current_loader})
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-white/40" />
                    <span className="font-mono text-brand-light font-semibold">
                      {migrationPlan.target_version} ({migrationPlan.target_loader})
                    </span>
                  </div>
                  <div className="flex gap-2 text-2xs">
                    <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">
                      {t.changeVer.upgradable(migrationPlan.upgradable.length)}
                    </Badge>
                    <Badge variant="outline" className="border-red-500/30 text-red-400">
                      {t.changeVer.incompatibleCount(migrationPlan.incompatible.length)}
                    </Badge>
                  </div>
                </div>

                {/* 可升級模組清單 */}
                {migrationPlan.upgradable.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                      <HardDriveDownload className="w-3.5 h-3.5" />
                      {t.changeVer.upgradeListTitle(migrationPlan.upgradable.length)}
                    </h4>
                    {migrationPlan.upgradable.map((item, i) => (
                      <div
                        key={i}
                        className="p-2 rounded bg-emerald-500/[0.04] border border-emerald-500/20 text-xs flex items-center justify-between"
                      >
                        <span className="text-white/90 font-medium">
                          {item.mod_name}
                        </span>
                        <div className="flex items-center gap-1.5 text-white/50 text-2xs">
                          <span className="line-through">{item.original_filename}</span>
                          <ArrowRight className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-300 font-mono">{item.new_filename}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 不相容停用清單 */}
                {migrationPlan.incompatible.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {t.changeVer.incompatibleListTitle(migrationPlan.incompatible.length)}
                    </h4>
                    <div className="p-2.5 rounded bg-amber-500/[0.04] border border-amber-500/20 text-xs space-y-1">
                      {migrationPlan.incompatible.map((filename, i) => (
                        <p key={i} className="text-amber-200/80 font-mono text-2xs">
                          • {filename}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="h-14 shrink-0 items-center justify-end gap-2.5 border-t border-white/10 bg-black/20 px-6 pt-0 sm:space-x-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isMigrating || isPlanning}
            className="border-white/10 bg-white/5 hover:bg-white/10"
          >
            {t.common.cancel}
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={isPlanning || isMigrating || needsLoaderVersion}
            className="bg-brand hover:bg-brand-light text-white"
          >
            {isMigrating || isPlanning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                {isPlanning ? t.changeVer.analyzing : t.changeVer.migrating}
              </>
            ) : migrationPlan ? (
              t.changeVer.confirmApply
            ) : (
              t.changeVer.confirm
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
