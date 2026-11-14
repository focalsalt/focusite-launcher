import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { instanceService } from "@/services/instanceService";
import { FolderOpen, Layers, Palette, ShoppingBag } from "lucide-react";
import { workshopService } from "@/services/workshopService";
import type { MinecraftInstance, PackFileInfo, VersionCapabilities } from "@/types/navigation";
import { FramelessEmptyState, tabContentVariants, PackItem } from "./shared";
import { useI18n } from "@/i18n";

interface PacksTabProps {
  instance: MinecraftInstance;
  caps: VersionCapabilities;
  resourcepacks: PackFileInfo[];
  shaderpacks: PackFileInfo[];
  resourceShaderTab: "packs" | "shaders";
  resourceShaderDir: number;
  handleResourceShaderChange: (tab: "packs" | "shaders") => void;
  tabDirection: number;
}

export const PacksTab: React.FC<PacksTabProps> = ({ instance, caps, resourcepacks, shaderpacks, resourceShaderTab, resourceShaderDir, handleResourceShaderChange, tabDirection }: PacksTabProps) => {
  const { t } = useI18n();

  return (
              <motion.div
                key="resourcepacks"
                custom={tabDirection}
                variants={tabContentVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-6"
              >
                {!caps.supportsShaderpacks ? (
                  <>
                    <div className="flex items-center justify-between pb-2 border-b border-white/5">
                      <div>
                        <h2 className="text-sm font-bold text-white">
                          {caps.packFolderKind === "texturepacks"
                            ? t.packs.titleTexture
                            : t.packs.titleResource}
                        </h2>
                        <p className="text-xs text-slate-400">
                          {caps.packFolderKind === "texturepacks"
                            ? t.packs.descTexture
                            : t.packs.descResource}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          instanceService.openInstanceDirectory(
                            instance.id,
                            caps.packFolderKind === "texturepacks" ? "texturepacks" : "resourcepacks"
                          )
                        }
                        className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                      >
                        <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                        {t.packs.openFolder(caps.packFolderKind === "texturepacks" ? "texturepacks" : "resourcepacks")}
                      </Button>
                    </div>

                    {resourcepacks.length === 0 ? (
                      <FramelessEmptyState
                        icon={Palette}
                        title={t.packs.emptyTitle}
                        description={t.packs.emptyDynamicDesc(caps.packFolderKind === "texturepacks" ? "texturepacks/" : "resourcepacks/")}
                      />
                    ) : (
                      <div className="space-y-1.5">
                        {resourcepacks.map((pack) => (
                          <PackItem key={pack.filename} pack={pack} icon={Palette} />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* 二級水平 Sub-Nav */}
                    <div className="flex items-center justify-between pb-2 border-b border-white/5">
                      <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 border border-white/10">
                        <button
                          type="button"
                          onClick={() => handleResourceShaderChange("packs")}
                          className={`relative px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${resourceShaderTab === "packs"
                            ? "text-white"
                            : "text-slate-400 hover:text-slate-200"
                            }`}
                        >
                          {resourceShaderTab === "packs" && (
                            <motion.div
                              layoutId="resource-shader-pill"
                              className="absolute inset-0 rounded-lg bg-brand shadow-sm shadow-brand/50"
                              transition={{ type: "spring", stiffness: 500, damping: 35 }}
                            />
                          )}
                          <span className="relative z-10 flex items-center gap-1.5">
                            <Palette className="h-3.5 w-3.5" />
                            {t.packs.tabPacks}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleResourceShaderChange("shaders")}
                          className={`relative px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${resourceShaderTab === "shaders"
                            ? "text-white"
                            : "text-slate-400 hover:text-slate-200"
                            }`}
                        >
                          {resourceShaderTab === "shaders" && (
                            <motion.div
                              layoutId="resource-shader-pill"
                              className="absolute inset-0 rounded-lg bg-brand shadow-sm shadow-brand/50"
                              transition={{ type: "spring", stiffness: 500, damping: 35 }}
                            />
                          )}
                          <span className="relative z-10 flex items-center gap-1.5">
                            <Layers className="h-3.5 w-3.5" />
                            {t.packs.shaderTab}
                          </span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        {resourceShaderTab === "packs" ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => workshopService.openWorkshopWindow(instance.id, "resourcepack")}
                              className="text-xs h-8 bg-brand hover:bg-brand-light text-white font-medium"
                            >
                              <ShoppingBag className="h-3.5 w-3.5 mr-1.5" />
                              {t.packs.openResourceWorkshop}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                instanceService.openInstanceDirectory(
                                  instance.id,
                                  caps.packFolderKind === "texturepacks" ? "texturepacks" : "resourcepacks"
                                )
                              }
                              className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                            >
                              <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                              {t.packs.openFolder(caps.packFolderKind === "texturepacks" ? "texturepacks" : "resourcepacks")}
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              onClick={() => workshopService.openWorkshopWindow(instance.id, "shader")}
                              className="text-xs h-8 bg-brand hover:bg-brand-light text-white font-medium"
                            >
                              <ShoppingBag className="h-3.5 w-3.5 mr-1.5" />
                              {t.packs.openShaderWorkshop}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => instanceService.openInstanceDirectory(instance.id, "shaderpacks")}
                              className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                            >
                              <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                              {t.packs.openShaderFolder}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    <AnimatePresence mode="popLayout" custom={resourceShaderDir}>
                      {resourceShaderTab === "packs" ? (
                        <motion.div
                          key="packs"
                          custom={resourceShaderDir}
                          variants={tabContentVariants}
                          initial="initial"
                          animate="animate"
                          exit="exit"
                          className="space-y-4"
                        >
                          {resourcepacks.length === 0 ? (
                            <FramelessEmptyState
                              icon={Palette}
                              title={t.packs.emptyTitle}
                              description={t.packs.emptyDesc}
                            />
                          ) : (
                            <div className="space-y-1.5">
                              {resourcepacks.map((pack) => (
                                <PackItem key={pack.filename} pack={pack} icon={Palette} />
                              ))}
                            </div>
                          )}
                        </motion.div>
                      ) : (
                        <motion.div
                          key="shaders"
                          custom={resourceShaderDir}
                          variants={tabContentVariants}
                          initial="initial"
                          animate="animate"
                          exit="exit"
                          className="space-y-4"
                        >
                          {shaderpacks.length === 0 ? (
                            <FramelessEmptyState
                              icon={Layers}
                              title={t.packs.emptyShadersTitle}
                              description={t.packs.emptyShadersDesc}
                            />
                          ) : (
                            <div className="space-y-1.5">
                              {shaderpacks.map((pack) => (
                                <PackItem key={pack.filename} pack={pack} icon={Layers} />
                              ))}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </motion.div>
  );
};
