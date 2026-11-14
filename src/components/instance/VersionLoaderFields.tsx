import React, { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Star, ShieldCheck } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";
import { toUserMessage } from "@/lib/errorMessage";
import { manifestService, VersionManifestV2 } from "@/services/manifestService";
import { loaderService, LoaderVersionOption } from "@/services/loaderService";
import { LoaderType } from "@/types/navigation";
import { useI18n } from "@/i18n";

export function isVersionOlderThan125(versionStr: string): boolean {
  const clean = versionStr.trim();
  if (
    clean.startsWith("a") ||
    clean.startsWith("b") ||
    clean.startsWith("c") ||
    clean.startsWith("rd-") ||
    clean.startsWith("inf-")
  ) {
    return true;
  }
  const match = clean.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return false;
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  const patch = match[3] ? parseInt(match[3], 10) : 0;
  if (major === 1) {
    if (minor < 2) return true;
    if (minor === 2 && patch < 5) return true;
  }
  return false;
}

/** Loads the Mojang version manifest once the owning dialog is opened. */
export function useVersionManifest(isOpen: boolean) {
  const [manifest, setManifest] = useState<VersionManifestV2 | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen || manifest) return;
    setIsLoading(true);
    manifestService
      .getVersionManifest()
      .then(setManifest)
      .catch((err) => {
        console.error("Failed to load versions:", err);
        toast(toUserMessage(err), "error");
      })
      .finally(() => setIsLoading(false));
  }, [isOpen, manifest]);

  return { manifest, isLoading };
}

interface VersionLoaderFieldsProps {
  isOpen: boolean;
  loaders: readonly LoaderType[];
  manifest: VersionManifestV2 | null;
  isLoadingVersions: boolean;
  version: string;
  onVersionChange: (v: string) => void;
  loader: LoaderType;
  onLoaderChange: (l: LoaderType) => void;
  loaderVersion: string;
  onLoaderVersionChange: (v: string) => void;
  /** Rendered instead of the version fields when the loader is "Custom". */
  customSlot?: React.ReactNode;
}

/** Loader / Minecraft version / loader version pickers shared by the create and migrate dialogs. */
export const VersionLoaderFields: React.FC<VersionLoaderFieldsProps> = ({
  isOpen,
  loaders,
  manifest,
  isLoadingVersions,
  version,
  onVersionChange,
  loader,
  onLoaderChange,
  loaderVersion,
  onLoaderVersionChange,
  customSlot,
}) => {
  const { t } = useI18n();
  const [showSnapshots, setShowSnapshots] = useState<boolean>(false);
  const [showHistorical, setShowHistorical] = useState<boolean>(false);
  const [loaderOptions, setLoaderOptions] = useState<LoaderVersionOption[]>([]);
  const [isLoadingLoaders, setIsLoadingLoaders] = useState<boolean>(false);

  const loaderVersionRef = useRef(loaderVersion);
  loaderVersionRef.current = loaderVersion;

  // Fetch real loader versions whenever the Minecraft version or loader changes.
  useEffect(() => {
    if (!isOpen) return;
    // Custom keeps its jar name in `loaderVersion`, so only Vanilla clears it.
    if (loader === "Custom") return;
    if (loader === "Vanilla" || !version) {
      setLoaderOptions([]);
      onLoaderVersionChange("");
      setIsLoadingLoaders(false);
      return;
    }

    let isMounted = true;
    setIsLoadingLoaders(true);
    loaderService
      .getLoaderVersions(loader, version)
      .then((opts) => {
        if (!isMounted) return;
        setLoaderOptions(opts);
        // Keep the current pick (e.g. the instance's existing loader version) if still valid.
        if (!opts.some((o) => o.version === loaderVersionRef.current)) {
          const rec = opts.find((o) => o.isRecommended) || opts[0];
          onLoaderVersionChange(rec ? rec.version : "");
        }
        setIsLoadingLoaders(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to load loader versions:", err);
        setLoaderOptions([]);
        onLoaderVersionChange("");
        setIsLoadingLoaders(false);
      });

    return () => {
      isMounted = false;
    };
    // Refetch only when the loader or Minecraft version changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, loader, version]);

  const filteredVersions = useMemo(() => {
    if (!manifest?.versions) return version ? [{ id: version, type: "release" }] : [];
    return manifest.versions.filter((v) => {
      if (v.type === "release" || v.id === version) return true;
      if (showSnapshots && v.type === "snapshot") return true;
      if (showHistorical && (v.type === "old_beta" || v.type === "old_alpha")) return true;
      return false;
    });
  }, [manifest, showSnapshots, showHistorical, version]);

  const old = isVersionOlderThan125(version);

  return (
    <>
      <div className="space-y-1 shrink-0">
        <label className="font-semibold text-xs text-slate-300">{t.create.loaderLabel}</label>
        <Select value={loader} onValueChange={(v) => onLoaderChange(v as LoaderType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {loaders.map((l) => (
              <SelectItem key={l} value={l} disabled={l !== "Vanilla" && old}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {old && <p className="text-[11px] text-slate-500">{t.create.vanillaOnlyOld}</p>}
      </div>

      {loader === "Custom" ? (
        customSlot
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-xs text-slate-300">{t.create.versionLabel}</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-400 hover:text-slate-200">
                  <Checkbox checked={showSnapshots} onCheckedChange={setShowSnapshots} />
                  <span>{t.create.showSnapshots}</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-400 hover:text-slate-200">
                  <Checkbox checked={showHistorical} onCheckedChange={setShowHistorical} />
                  <span>{t.create.showOld}</span>
                </label>
              </div>
            </div>

            <Select
              value={version}
              onValueChange={(ver) => {
                onVersionChange(ver);
                if (isVersionOlderThan125(ver) && loader !== "Vanilla") onLoaderChange("Vanilla");
              }}
              disabled={isLoadingVersions}
            >
              <SelectTrigger className="w-full h-8">
                {isLoadingVersions ? (
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <RefreshCw className="h-3 w-3 animate-spin text-brand-light" />
                    <span>{t.create.loadingVersions}</span>
                  </div>
                ) : (
                  <SelectValue placeholder={t.create.selectVersionPlaceholder} />
                )}
              </SelectTrigger>
              <SelectContent className="max-h-56">
                {filteredVersions.map((v) => (
                  <SelectItem
                    key={v.id}
                    value={v.id}
                    extraRight={
                      <span className="text-[10px] text-slate-400 font-mono">
                        {v.type === "release"
                          ? t.common.release
                          : v.type === "snapshot"
                            ? t.common.snapshot
                            : t.create.historical}
                      </span>
                    }
                  >
                    Minecraft {v.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loader !== "Vanilla" ? (
            <div className="space-y-1">
              <label className="font-semibold text-xs text-slate-300">
                {t.create.loaderVersionLabel(loader)}
              </label>
              {loaderOptions.length === 0 && !isLoadingLoaders ? (
                <div className="flex h-8 w-full items-center rounded-xl border border-white/10 bg-black/20 px-3 text-xs text-slate-500 italic select-none">
                  {t.create.noCompatibleLoader(loader)}
                </div>
              ) : (
                <Select
                  value={loaderVersion}
                  onValueChange={onLoaderVersionChange}
                  disabled={isLoadingLoaders}
                >
                  <SelectTrigger className="w-full h-8">
                    {isLoadingLoaders ? (
                      <div className="flex items-center gap-1.5 text-slate-400">
                        <RefreshCw className="h-3 w-3 animate-spin text-brand-light" />
                        <span>{t.create.loadingLoader(loader)}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 truncate">
                        <SelectValue placeholder={t.create.selectLoaderPlaceholder(loader)} />
                        {loaderOptions.find((o) => o.version === loaderVersion)?.isRecommended && (
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
                        )}
                      </div>
                    )}
                  </SelectTrigger>
                  <SelectContent className="max-h-52">
                    {loaderOptions.map((opt) => (
                      <SelectItem
                        key={opt.version}
                        value={opt.version}
                        extraRight={
                          opt.isRecommended ? (
                            <div className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20 font-medium">
                              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                              <span>{t.create.recommended}</span>
                            </div>
                          ) : undefined
                        }
                      >
                        {opt.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02]">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/20 text-brand-light">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <p className="text-[11px] font-medium text-slate-200">{t.create.vanillaTitle}</p>
            </div>
          )}
        </div>
      )}
    </>
  );
};
