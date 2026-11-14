import React, { useState } from "react";
import { motion } from "motion/react";
import { FolderOpen, Package, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { instanceService } from "@/services/instanceService";
import { workshopService } from "@/services/workshopService";
import type { MinecraftInstance, VersionCapabilities } from "@/types/navigation";
import type { ModFileInfo } from "@/services/instanceService";
import { FramelessEmptyState, tabContentVariants, ModItem } from "./shared";
import { useI18n } from "@/i18n";

interface ModsTabProps {
  instance: MinecraftInstance;
  caps: VersionCapabilities;
  mods: ModFileInfo[];
  coremods: ModFileInfo[];
  toggleMod: (filename: string, enabled: boolean) => void | Promise<void>;
  toggleCoremod: (filename: string, enabled: boolean) => void | Promise<void>;
  tabDirection: number;
}

export const ModsTab: React.FC<ModsTabProps> = ({ instance, caps, mods, coremods, toggleMod, toggleCoremod, tabDirection }: ModsTabProps) => {
  const { t } = useI18n();
  const [legacyModTab, setLegacyModTab] = useState<"mods" | "coremods">("mods");

  return (
              <motion.div
                key="mods"
                custom={tabDirection}
                variants={tabContentVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-4"
              >
                {caps.modsTabMode === "legacydualnav" ? (
                  <>
                    <div className="flex items-center justify-between pb-2 border-b border-white/5">
                      <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 border border-white/10">
                        <button
                          type="button"
                          onClick={() => setLegacyModTab("mods")}
                          className={`relative px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${legacyModTab === "mods"
                            ? "text-white"
                            : "text-slate-400 hover:text-slate-200"
                            }`}
                        >
                          {legacyModTab === "mods" && (
                            <motion.div
                              layoutId="legacy-mod-pill"
                              className="absolute inset-0 rounded-lg bg-brand shadow-sm shadow-brand/50"
                              transition={{ type: "spring", stiffness: 500, damping: 35 }}
                            />
                          )}
                          <span className="relative z-10 flex items-center gap-1.5">
                            <Package className="h-3.5 w-3.5" />
                            Mods
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setLegacyModTab("coremods")}
                          className={`relative px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${legacyModTab === "coremods"
                            ? "text-white"
                            : "text-slate-400 hover:text-slate-200"
                            }`}
                        >
                          {legacyModTab === "coremods" && (
                            <motion.div
                              layoutId="legacy-mod-pill"
                              className="absolute inset-0 rounded-lg bg-brand shadow-sm shadow-brand/50"
                              transition={{ type: "spring", stiffness: 500, damping: 35 }}
                            />
                          )}
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
                              version={`${(((mod.sizeBytes ?? mod.size_bytes ?? 0)) / 1024).toFixed(1)} KB`}
                              desc={mod.enabled ? t.common.enabled : t.mods.disabledSuffix}
                              enabled={mod.enabled}
                              onToggle={(checked) => toggleMod(mod.filename, checked)}
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
                            version={`${(((mod.sizeBytes ?? mod.size_bytes ?? 0)) / 1024).toFixed(1)} KB`}
                            desc={mod.enabled ? t.mods.enabledCore : t.mods.disabledSuffix}
                            enabled={mod.enabled}
                            onToggle={(checked) => toggleCoremod(mod.filename, checked)}
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
                          className="text-xs h-8 bg-brand hover:bg-brand-light text-white font-medium"
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
                            version={`${(((mod.sizeBytes ?? mod.size_bytes ?? 0)) / 1024).toFixed(1)} KB`}
                            desc={mod.enabled ? t.common.enabled : t.mods.disabledSuffix}
                            enabled={mod.enabled}
                            onToggle={(checked) => toggleMod(mod.filename, checked)}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </motion.div>
  );
};
