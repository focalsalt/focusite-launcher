import React, { useCallback, useRef, useState } from "react";
import { motion } from "motion/react";
import { FolderOpen, Package, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { instanceService } from "@/services/instanceService";
import { workshopService } from "@/services/workshopService";
import type { MinecraftInstance, VersionCapabilities } from "@/types/navigation";
import type { ModFileInfo } from "@/services/instanceService";
import { FramelessEmptyState, tabContentVariants, ModItem } from "./shared";
import { useI18n } from "@/i18n";
import { SlidingIndicator, useSlidingIndicator } from "@/components/ui/sliding-indicator";
import { useModSides } from "@/lib/useModSides";

interface ModsTabProps {
  instance: MinecraftInstance;
  caps: VersionCapabilities;
  mods: ModFileInfo[];
  coremods: ModFileInfo[];
  toggleMod: (filename: string, enabled: boolean) => void | Promise<void>;
  toggleCoremod: (filename: string, enabled: boolean) => void | Promise<void>;
  tabDirection: number;
  ref?: React.Ref<HTMLDivElement>;
}

export const ModsTab: React.FC<ModsTabProps> = ({ instance, caps, mods, coremods, toggleMod, toggleCoremod, tabDirection, ref }: ModsTabProps) => {
  const { t } = useI18n();
  const [legacyModTab, setLegacyModTab] = useState<"mods" | "coremods">("mods");
  const pill = useSlidingIndicator(legacyModTab);
  const sides = useModSides(instance.id, mods);
  // Always mounted, so screen readers hear the status change inside it.
  const sideStatus = (
    <p role="status" className="text-2xs text-slate-400 empty:hidden">
      {mods.length === 0
        ? null
        : sides.isChecking
          ? t.mods.sideChecking
          : sides.failed
            ? t.mods.sideFailed
            : sides.modrinthFailed
              ? t.mods.sideModrinthFailed
              : null}
    </p>
  );
  // Stable callbacks for the memoised rows that still call the parent's latest handlers.
  const handlers = useRef({ toggleMod, toggleCoremod });
  handlers.current = { toggleMod, toggleCoremod };
  const onToggleMod = useCallback((name: string, on: boolean) => void handlers.current.toggleMod(name, on), []);
  const onToggleCoremod = useCallback((name: string, on: boolean) => void handlers.current.toggleCoremod(name, on), []);

  return (
              <motion.div
                key="mods"
                custom={tabDirection}
                ref={ref}
                variants={tabContentVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-4"
              >
                {caps.modsTabMode === "legacydualnav" ? (
                  <>
                    <div className="flex items-center justify-between pb-2 border-b border-white/5">
                      <div className="relative flex items-center gap-1 rounded-xl bg-white/5 p-1 border border-white/10">
                        <SlidingIndicator box={pill.box} className="top-1 bottom-1 rounded-lg bg-brand shadow-sm shadow-brand/50" />
                        <button
                          type="button"
                          ref={pill.register("mods")}
                          onClick={() => setLegacyModTab("mods")}
                          className={`relative px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${legacyModTab === "mods"
                            ? "text-on-solid"
                            : "text-slate-400 hover:text-slate-200"
                            }`}
                        >
                          <span className="relative z-10 flex items-center gap-1.5">
                            <Package className="h-3.5 w-3.5" />
                            Mods
                          </span>
                        </button>

                        <button
                          type="button"
                          ref={pill.register("coremods")}
                          onClick={() => setLegacyModTab("coremods")}
                          className={`relative px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${legacyModTab === "coremods"
                            ? "text-on-solid"
                            : "text-slate-400 hover:text-slate-200"
                            }`}
                        >
                          <span className="relative z-10 flex items-center gap-1.5">
                            <Package className="h-3.5 w-3.5" />
                            Core Mods
                          </span>
                        </button>
                      </div>

                      <div>
                        {legacyModTab === "mods" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => instanceService.openInstanceDirectory(instance.id, "mods")}
                            className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                          >
                            <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                            {t.mods.openMods}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => instanceService.openInstanceDirectory(instance.id, "coremods")}
                            className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                          >
                            <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                            {t.mods.openCoremods}
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-brand-light/20 bg-brand/10 p-3 text-xs text-brand-light leading-relaxed">
                      {t.mods.legacyNote}
                    </div>

                    {legacyModTab === "mods" && sideStatus}

                    {legacyModTab === "mods" ? (
                      mods.length === 0 ? (
                        <FramelessEmptyState
                          icon={Package}
                          title={t.mods.emptyTitle}
                          description={t.mods.emptyDesc}
                        />
                      ) : (
                        <div className="space-y-1.5">
                          {mods.map((mod) => (
                            <ModItem
                              key={mod.filename}
                              name={mod.filename}
                              enabled={mod.enabled}
                              onToggle={onToggleMod}
                              side={sides.get(mod.filename)?.side}
                              sideSource={sides.get(mod.filename)?.source}
                            />
                          ))}
                        </div>
                      )
                    ) : coremods.length === 0 ? (
                      <FramelessEmptyState
                        icon={Package}
                        title={t.mods.emptyCoreTitle}
                        description={t.mods.emptyCoreDesc}
                      />
                    ) : (
                      <div className="space-y-1.5">
                        {coremods.map((mod) => (
                          <ModItem
                            key={mod.filename}
                            name={mod.filename}
                            enabled={mod.enabled}
                            onToggle={onToggleCoremod}
                          />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between pb-2 border-b border-white/5">
                      <div>
                        <h2 className="text-sm font-bold text-white">{t.mods.installedTitle(mods.length)}</h2>
                        <p className="text-xs text-slate-400">
                          {t.mods.sharedNote}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => workshopService.openWorkshopWindow(instance.id, "mod")}
                          className="text-xs h-8 bg-brand hover:bg-brand-hover text-on-solid font-medium"
                        >
                          <ShoppingBag className="h-3.5 w-3.5 mr-1.5" />
                          {t.mods.openWorkshop}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => instanceService.openInstanceDirectory(instance.id, "mods")}
                          className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                        >
                          <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                          {t.mods.openMods}
                        </Button>
                      </div>
                    </div>

                    {sideStatus}

                    {mods.length === 0 ? (
                      <FramelessEmptyState
                        icon={Package}
                        title={t.mods.emptyTitle2}
                        description={t.mods.emptyDesc2}
                      />
                    ) : (
                      <div className="space-y-1.5">
                        {mods.map((mod) => (
                          <ModItem
                            key={mod.filename}
                            name={mod.filename}
                            enabled={mod.enabled}
                            onToggle={onToggleMod}
                            side={sides.get(mod.filename)?.side}
                            sideSource={sides.get(mod.filename)?.source}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </motion.div>
  );
};
