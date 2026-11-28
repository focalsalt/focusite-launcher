import React, { useState, useEffect, useRef, useReducer } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shirt,
  Sparkles,
  Trash2,
  Check,
  RotateCcw,
  Footprints,
  Activity,
  Feather,
  Plus,
  Save,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  Tip,
} from "@/components/ui/tooltip";
import { UserAccount } from "@/types/navigation";
import { OFFICIAL_9_SKINS, OFFICIAL_KNOWN_CAPES } from "@/components/skin/skinCatalog";
import { SkinCardSkeleton, CapeCardSkeleton } from "@/components/skin/SkinSkeletons";
import { Skin3DViewer } from "@/components/skin/Skin3DViewer";
import { SkinThumbnail } from "@/components/skin/SkinThumbnail";
import { skinService, SkinItem } from "@/services/skinService";
import { authService } from "@/services/authService";
import { toUserMessage } from "@/lib/errorMessage";
import { toAssetSrc } from "@/lib/assetUrl";
import { toast } from "@/lib/toast";
import { useI18n } from "@/i18n";
import { SlidingIndicator, useSlidingIndicator } from "@/components/ui/sliding-indicator";
import { cn } from "@/lib/utils";
import { tabReducer } from "@/lib/tabReducer";
import { createSkinPreview, skinPreviewReducer, skinProfileReducer } from "@/lib/skinReducers";

type AnimationMode = "idle" | "walk" | "run";

// 水平分頁轉場慣性索引 (GEMINI.md Invariant)
const SUB_TAB_ORDER = {
  wardrobe: 0,
  capes: 1,
};

interface SkinManagerViewProps {
  activeAccount: UserAccount;
  onGoBack?: () => void;
  onAccountUpdated?: (updated: UserAccount) => void;
  onOpenLoginModal?: () => void;
}

export const SkinManagerView: React.FC<SkinManagerViewProps> = ({
  activeAccount,
  onAccountUpdated,
  onOpenLoginModal,
}) => {
  const { t } = useI18n();
  const capeText = (id: string) =>
    (t.capes as Record<string, { name: string; description: string; obtain: string }>)[id] ?? {
      name: id,
      description: "",
      obtain: "",
    };
  const [{ tab: activeTab, direction: tabDirection }, dispatchTab] = useReducer(tabReducer<"wardrobe" | "capes">, {
    tab: "wardrobe",
    direction: 0,
  });

  const [backEquipment, setBackEquipment] = useState<"cape" | "elytra">("cape");

  // Saved baseline and live 3D preview
  const [preview, dispatchPreview] = useReducer(skinPreviewReducer, null, () =>
    createSkinPreview(
      activeAccount.skinUrl || OFFICIAL_9_SKINS[0].texturePath,
      activeAccount.capeUrl || "",
      activeAccount.skinModel || "auto-detect",
    ),
  );
  const {
    initialSkinUrl,
    initialCapeUrl,
    skinUrl: previewSkinUrl,
    capeUrl: previewCapeUrl,
    model: previewModel,
  } = preview;
  const [animation, setAnimation] = useState<AnimationMode>("idle");
  const animPill = useSlidingIndicator(animation);
  const tabLine = useSlidingIndicator(activeTab);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);

  // 使用者正版帳號持有的真實披風
  const [{ capes: accountCapes, hasValidToken, isRefreshing: isRefreshingCapes }, dispatchProfile] = useReducer(
    skinProfileReducer,
    null,
    () => ({
      capes: activeAccount.capes || [],
      hasValidToken: activeAccount.hasValidToken ?? true,
      isRefreshing: false,
    }),
  );
  const [isLoadingSkins, setIsLoadingSkins] = useState<boolean>(true);

  // 保存中與保存成功反饋
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // 本機皮膚庫狀態 (%APPDATA%/focusite_launcher/skins/)
  const [localSkins, setLocalSkins] = useState<SkinItem[]>([]);
  // Each listed skin holds a blob URL: release them all when the page closes.
  const localSkinsRef = useRef(localSkins);
  localSkinsRef.current = localSkins;
  useEffect(
    () => () => localSkinsRef.current.forEach((s) => s.blobUrl && URL.revokeObjectURL(s.blobUrl)),
    [],
  );
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const setUploadError = (msg: string) => toast(msg, "error");

  // 輔助函式：提取貼圖 Hash 供比對持有狀態
  const getTextureHash = (url: string) => {
    const parts = url.split("/");
    return parts[parts.length - 1].replace(/\.png$/, "").toLowerCase();
  };

  // 判斷是否相對於目前已保存之帳號設定有變更（解耦視圖切換）
  const isDirty =
    previewSkinUrl !== initialSkinUrl || previewCapeUrl !== initialCapeUrl;

  // 處理 Tab 切換並依空間軸線計算慣性向量
  const handleTabChange = (target: "wardrobe" | "capes") => {
    dispatchTab({ to: target, order: SUB_TAB_ORDER });
  };

  const applyRefreshedProfile = (refreshed: UserAccount) => {
    if (refreshed.skinModel) dispatchPreview({ type: "model", model: refreshed.skinModel });
    dispatchProfile({ type: "refreshed", account: refreshed });
    onAccountUpdated?.(refreshed);
  };

  // 載入本機已存皮膚清單與即時同步帳號披風
  useEffect(() => {
    let isMounted = true;
    setIsLoadingSkins(true);
    skinService
      .listLocalSkins()
      .then((list) => {
        if (isMounted) {
          setLocalSkins(list);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingSkins(false);
        }
      });

    if (activeAccount.id && activeAccount.id !== "guest") {
      authService.refreshProfile(activeAccount.id).then((refreshed) => {
        if (isMounted && refreshed) applyRefreshedProfile(refreshed);
      });
    }

    return () => {
      isMounted = false;
    };
  }, [activeAccount.id]);

  // 重設回原始帳號外觀
  const handleReset = () => {
    dispatchPreview({ type: "reset", model: activeAccount.skinModel || "auto-detect" });
  };

  // 手動更新微軟正版披風資產
  const handleRefreshCapes = async () => {
    if (!activeAccount.id || activeAccount.id === "guest") return;
    try {
      dispatchProfile({ type: "refreshStarted" });
      const refreshed = await authService.refreshProfile(activeAccount.id);
      if (refreshed) applyRefreshedProfile(refreshed);
    } catch (err) {
      console.warn("Refresh capes failed:", err);
    } finally {
      dispatchProfile({ type: "refreshFinished" });
    }
  };

  // 保存設定至帳號檔案與微軟伺服器
  const handleSave = async () => {
    try {
      setIsSaving(true);
      // A blob: URL of a local skin dies with this page; store the skin file's own URL instead.
      const savedSkinUrl = previewSkinUrl?.startsWith("blob:")
        ? toAssetSrc(localSkins.find((s) => s.blobUrl === previewSkinUrl)?.path) ?? previewSkinUrl
        : previewSkinUrl;
      await authService.updateAccountSkin(
        activeAccount.id,
        savedSkinUrl,
        previewCapeUrl
      );

      // 更新基準值，使 isDirty 歸零
      dispatchPreview({ type: "saved", skinUrl: previewSkinUrl, capeUrl: previewCapeUrl });

      activeAccount.skinUrl = savedSkinUrl;
      activeAccount.capeUrl = previewCapeUrl;

      if (onAccountUpdated) {
        onAccountUpdated({
          ...activeAccount,
          skinUrl: savedSkinUrl,
          capeUrl: previewCapeUrl,
          capes: accountCapes,
        });
      }

      toast(t.skin.savedNotice, "success");
    } catch (err) {
      console.error("Failed to save skin:", err);
      toast(t.errors.saveSkinFailed(toUserMessage(err)), "error");
    } finally {
      setIsSaving(false);
    }
  };

  // Shared by the file picker and drag-and-drop.
  const processSkinFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".png")) {
      setUploadError(t.skin.uploadNotPng);
      return;
    }

    try {
      setIsUploading(true);
      const name = file.name.replace(/\.[^/.]+$/, "");
      const created = await skinService.saveLocalSkin(name, file);
      setLocalSkins((prev) => [created, ...prev]);
      if (created.blobUrl) {
        dispatchPreview({ type: "selectSkin", url: created.blobUrl, model: "auto-detect" });
      }
    } catch (err) {
      console.error("Failed to upload skin:", err);
      setUploadError(t.skin.uploadFailed);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleUploadSkin = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processSkinFile(file);
  };

  const handleDropSkin = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await processSkinFile(file);
  };

  // 刪除本機皮膚
  const handleDeleteSkin = async (filename: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await skinService.deleteLocalSkin(filename);
      setLocalSkins((prev) => {
        const gone = prev.find((s) => s.filename === filename);
        if (gone?.blobUrl && gone.blobUrl !== previewSkinUrl) URL.revokeObjectURL(gone.blobUrl);
        return prev.filter((s) => s.filename !== filename);
      });
    } catch (err) {
      console.error("Failed to delete skin:", err);
      toast(t.errors.deleteSkinFailed(toUserMessage(err)), "error");
    }
  };

  // 動作模式純肢體選項 (旋轉已抽離為獨立 Switch 控制)
  const animButtons: { id: AnimationMode; label: string; icon: React.ReactNode }[] = [
    { id: "idle", label: t.skin.animIdle, icon: null },
    { id: "walk", label: t.skin.animWalk, icon: <Footprints className="h-3 w-3" /> },
    { id: "run", label: t.skin.animRun, icon: <Activity className="h-3 w-3" /> },
  ];

  // 水平分頁轉場 Variants 與輕量彈簧設定 (GEMINI.md Invariant)
  const tabVariants = {
    enter: (dir: number) => ({
      x: dir * 16,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: -dir * 16,
      opacity: 0,
    }),
  };

  const tabTransition = {
    type: "spring" as const,
    stiffness: 450,
    damping: 35,
    mass: 0.8,
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col w-full h-full select-none overflow-hidden">
        {/* 隱藏的皮膚檔案選擇器 */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleUploadSkin}
          accept="image/png"
          className="hidden"
        />

        {/* 頂部標題列 */}
        <div className="flex items-center justify-between border-b border-white/10 px-8 py-3.5 bg-slate-950/60 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-brand to-brand-dark text-on-solid shadow-md shadow-brand/25 border border-white/15">
              <Shirt className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-white">
                {t.skin.title}
              </h1>
              <p className="text-2xs text-slate-400">
                {t.skin.centerDescBefore}<span className="font-semibold text-brand-light">{activeAccount.username}</span>{t.skin.centerDescAfter}
              </p>
            </div>
          </div>

        </div>

        {/* 左右雙欄式主體 (左側固定 3D 自適應縮放，右側為 Scroll Area) */}
        <div className="flex flex-1 overflow-hidden p-6 gap-6 min-h-0">
          {/* 左側欄 (固定寬度 310px，純 Flex 佈局，高度緊貼視窗永不溢出) */}
          <div className="flex flex-col gap-3 shrink-0 w-[310px] h-full min-h-0 overflow-hidden justify-between">
            {/* 3D 玩家模型視圖主卡片 (自適應彈性高度，佔滿垂直剩餘空間) */}
            <div className="relative flex flex-col items-center justify-between flex-1 min-h-[220px] w-full rounded-2xl border border-white/10 bg-gradient-to-b from-white/5 to-scrim/40 p-3 backdrop-blur-md shadow-xl overflow-hidden">
              <div className="flex items-center justify-between w-full shrink-0 mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="flex h-2 w-2 rounded-full bg-brand-light animate-pulse" />
                  <span className="text-3xs font-mono font-medium text-slate-300">
                    3D LIVE PREVIEW
                  </span>
                </div>
              </div>

              {/* 3D Viewer Canvas 容器 (自適應長寬比動態調整，杜絕擠壓視窗底部) */}
              <div className="relative flex-1 w-full min-h-0 flex items-center justify-center overflow-hidden">
                <Skin3DViewer
                  skinUrl={previewSkinUrl}
                  capeUrl={previewCapeUrl}
                  modelVariant={previewModel}
                  backEquipment={backEquipment}
                  animation={animation}
                  autoRotate={autoRotate}
                  responsive={true}
                  className="w-full h-full"
                />
              </div>

              {/* 底部拖曳說明與保存/重設操作列 (固定高度，不造成卡片外擴) */}
              <div className="w-full shrink-0 mt-1">
                <p className="text-3xs text-slate-300 text-center pb-1">
                  {t.skin.dragHint}
                </p>

                {/* Reserve the row's height permanently and only fade it, so showing the buttons
                    never resizes the 3D viewer above (that resize caused the flicker). */}
                <div
                  className={cn(
                    "flex h-10 items-center gap-2 w-full border-t border-white/10 pt-1.5 transition-opacity duration-150",
                    isDirty ? "opacity-100" : "pointer-events-none opacity-0",
                  )}
                  aria-hidden={!isDirty}
                >
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleReset}
                        disabled={isSaving || !isDirty}
                        tabIndex={isDirty ? 0 : -1}
                        className="flex-1 text-xs h-7.5 rounded-lg border-white/15 bg-white/5 hover:bg-white/10 text-slate-300"
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        {t.skin.reset}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={isSaving || !isDirty}
                        tabIndex={isDirty ? 0 : -1}
                        className="flex-1 text-xs h-7.5 rounded-lg bg-brand hover:bg-brand-hover text-on-solid font-semibold shadow-md shadow-brand/30"
                      >
                        <Save className="h-3 w-3 mr-1" />
                        {isSaving ? t.skin.saving : t.skin.saveChanges}
                      </Button>
                </div>
              </div>
            </div>

            {/* 3D 動作模式與視角運鏡控制面板 (緊湊佈局，shrink-0 確保永不遭擠壓) */}
            <div className="w-full space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-2.5 text-xs shrink-0">
              <div role="group" aria-labelledby="skin-animation" className="space-y-1">
                <span id="skin-animation" className="text-2xs font-bold text-slate-300">
                  {t.skin.animationMode}
                </span>
                <div className="relative flex items-center gap-1 rounded-xl bg-white/5 p-1 border border-white/10">
                  <SlidingIndicator box={animPill.box} className="top-1 bottom-1 rounded-lg bg-brand shadow-sm shadow-brand/30" />
                  {animButtons.map((btn) => {
                    const isActive = animation === btn.id;
                    return (
                      <button
                        key={btn.id}
                        ref={animPill.register(btn.id)}
                        type="button"
                        onClick={() => setAnimation(btn.id)}
                        className={cn(
                          "relative flex-1 py-1 text-xs font-semibold transition-colors duration-150",
                          isActive ? "text-on-solid" : "text-slate-400 hover:text-slate-200",
                        )}
                      >
                        <span className="relative z-10 flex items-center justify-center gap-1 text-2xs">
                          {btn.icon}
                          {btn.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 開關列：獨立自動旋轉與鞘翅切換 */}
              <div className="space-y-1.5 pt-1.5 border-t border-white/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <RotateCcw className="h-3.5 w-3.5 text-slate-300" />
                    <span className="text-2xs font-semibold text-slate-300">
                      {t.skin.autoRotate}
                    </span>
                  </div>
                  <Switch
                    checked={autoRotate}
                    onCheckedChange={setAutoRotate}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Feather className="h-3.5 w-3.5 text-slate-300" />
                    <span className="text-2xs font-semibold text-slate-300">
                      {t.skin.elytraMode}
                    </span>
                  </div>
                  <Switch
                    checked={backEquipment === "elytra"}
                    onCheckedChange={(checked) =>
                      setBackEquipment(checked ? "elytra" : "cape")
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 右側欄 (頂部 Tab 固定，下方為 Scroll Area，帶柔和邊界) */}
          <div className="flex flex-1 flex-col min-w-0 h-full overflow-hidden">
            {/* 右側頂部固定 Tab 列 (精確對齊實例詳情頁之底部綠色滑動光線指示器) */}
            <div className="flex items-center justify-between border-b border-white/10 shrink-0">
              <div className="relative flex items-center gap-1">
                <SlidingIndicator box={tabLine.box} className="bottom-0 h-0.5 bg-brand-light shadow-[0_0_8px_color-mix(in_srgb,var(--fc-highlight)_80%,transparent)]" />
                <button
                  ref={tabLine.register("wardrobe")}
                  type="button"
                  onClick={() => handleTabChange("wardrobe")}
                  className={cn(
                    "relative flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold transition-colors",
                    activeTab === "wardrobe" ? "text-brand-light" : "text-slate-400 hover:text-slate-200",
                  )}
                >
                  <Shirt className="h-4 w-4" />
                  <span>{t.skin.tabSkins(localSkins.length + OFFICIAL_9_SKINS.length)}</span>
                </button>

                <button
                  ref={tabLine.register("capes")}
                  type="button"
                  onClick={() => handleTabChange("capes")}
                  className={cn(
                    "relative flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold transition-colors",
                    activeTab === "capes" ? "text-brand-light" : "text-slate-400 hover:text-slate-200",
                  )}
                >
                  <Sparkles className="h-4 w-4" />
                  <span>{t.skin.tabCapes(accountCapes.length)}</span>
                </button>
              </div>

              {activeTab === "capes" && (
                <Tip label={t.skin.refreshCapesAttr}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefreshCapes}
                    disabled={isRefreshingCapes}
                    className="h-8 px-2.5 text-xs text-slate-400 hover:text-white border border-white/10 hover:bg-white/5 rounded-lg mb-1"
                  >
                    <RefreshCw
                      className={cn("h-3.5 w-3.5 mr-1.5", isRefreshingCapes && "animate-spin text-brand-light")}
                    />
                    <span>{isRefreshingCapes ? t.skin.syncing : t.skin.refresh}</span>
                  </Button>
                </Tip>
              )}
            </div>

            {/* 右側滾動區域：柔和漸層遮罩，杜絕硬邊切割 */}
            <ScrollArea
              className="flex-1 min-h-0 [mask-image:linear-gradient(to_bottom,transparent,black_14px,black_calc(100%-14px),transparent)]"
              viewportClassName="py-4 pr-3"
            >
              <AnimatePresence custom={tabDirection} mode="popLayout">
                {activeTab === "wardrobe" ? (
                  <motion.div
                    key="wardrobe"
                    custom={tabDirection}
                    variants={tabVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={tabTransition}
                    className="space-y-6"
                  >
                    {/* 第一區：自訂本機皮膚 (%APPDATA%/focusite_launcher/skins/) */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xs font-bold text-slate-200">
                          {t.skin.localSkinsTitle}
                        </h2>
                        <span className="text-3xs text-slate-400 font-mono">
                          {t.skin.fileCount(localSkins.length)}
                        </span>
                      </div>

                      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(230px,calc((100%-1.75rem)/3)),1fr))] gap-3.5">
                        {/* 上傳卡片 */}
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setIsDragOver(true);
                          }}
                          onDragLeave={() => setIsDragOver(false)}
                          onDrop={handleDropSkin}
                          className={cn(
                            "flex flex-col items-center justify-center p-4 rounded-xl border border-dashed transition-all cursor-pointer text-center space-y-1.5 group min-h-[120px]",
                            isDragOver ? "border-brand-light bg-brand/15" : "border-white/15 bg-white/[0.02] hover:bg-white/[0.05] hover:border-brand-light/50",
                          )}
                        >
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-slate-400 group-hover:text-brand-light group-hover:bg-brand/20 transition-colors">
                            <Plus className="h-4 w-4" />
                          </div>
                          <span className="text-xs font-bold text-slate-200">
                            {isUploading ? t.skin.uploading : t.skin.uploadNew}
                          </span>
                          <span className="text-3xs text-slate-400">
                            {t.skin.uploadHint}
                          </span>
                          
                        </div>

                        {/* 本機皮膚骨架屏或實例清單 */}
                        {isLoadingSkins ? (
                          <>
                            <SkinCardSkeleton />
                            <SkinCardSkeleton />
                          </>
                        ) : (
                          localSkins.map((skin) => {
                            const isSelected = previewSkinUrl === skin.blobUrl;
                            return (
                              <div
                                key={skin.id}
                                onClick={() => {
                                  if (skin.blobUrl) {
                                    dispatchPreview({ type: "selectSkin", url: skin.blobUrl, model: "auto-detect" });
                                  }
                                }}
                                className={cn(
                                  "group relative flex flex-col justify-between p-3 rounded-xl border transition-all cursor-pointer min-h-[120px]",
                                  isSelected ? "border-brand-light bg-brand/15 shadow-md shadow-brand/15" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]",
                                )}
                              >
                                <div className="flex items-center gap-3">
                                  {/* 單例快照縮圖 (零額外 WebGL 上下文) */}
                                  <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-black/40 border border-white/10 flex items-center justify-center">
                                    <SkinThumbnail
                                      skinUrl={skin.blobUrl}
                                      model="default"
                                      rotationY={0.35}
                                      alt={skin.name}
                                    />
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-bold text-white">
                                      {skin.name}
                                    </p>
                                    <p className="truncate text-3xs text-slate-400 font-mono mt-0.5">
                                      {t.skin.customSkin}
                                    </p>
                                    <p className="text-3xs text-slate-400 mt-1">
                                      {Math.max(1, Math.round(skin.bytes.length / 1024))} KB
                                    </p>
                                  </div>

                                  <Tip label={t.skin.deleteFromLocker} className="self-start">
                                    <button
                                      type="button"
                                      onClick={(e) => handleDeleteSkin(skin.filename, e)}
                                      className="p-1 rounded text-slate-400 hover:text-danger-400 hover:bg-danger-500/10 transition-colors self-start"
                                      aria-label={t.skin.deleteFromLocker}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </Tip>
                                </div>

                                <div className="flex items-center justify-between text-3xs pt-2 border-t border-white/5">
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-[9px] py-0 px-1.5",
                                      isSelected ? "border-brand-light text-brand-light" : "border-white/10 text-slate-400",
                                    )}
                                  >
                                    {isSelected ? t.skin.previewing : t.skin.switchable}
                                  </Badge>
                                  {isSelected && (
                                    <Check className="h-3.5 w-3.5 text-brand-light" />
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* 第二區：官方 9 款經典角色預設皮膚 (Wiki 模型對照規範) */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xs font-bold text-slate-200">
                          {t.skin.defaultSkinsTitle}
                        </h2>
                        <span className="text-3xs text-slate-400 font-mono">
                          Minecraft Official Presets
                        </span>
                      </div>

                      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(230px,calc((100%-1.75rem)/3)),1fr))] gap-3.5">
                        {OFFICIAL_9_SKINS.map((defSkin) => {
                          const isSelected = previewSkinUrl === defSkin.texturePath;
                          return (
                            <div
                              key={defSkin.id}
                              onClick={() => {
                                dispatchPreview({ type: "selectSkin", url: defSkin.texturePath, model: defSkin.model });
                              }}
                              className={cn(
                                "group relative flex flex-col justify-between p-3 rounded-xl border transition-all cursor-pointer min-h-[120px]",
                                isSelected ? "border-brand-light bg-brand/15 shadow-md shadow-brand/15" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]",
                              )}
                            >
                              <div className="flex items-center gap-3">
                                {/* 單例快照縮圖 (零額外 WebGL 上下文) */}
                                <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-black/40 border border-white/10 flex items-center justify-center">
                                  <SkinThumbnail
                                    skinUrl={defSkin.texturePath}
                                    model={defSkin.model}
                                    rotationY={0.35}
                                    alt={defSkin.id === "steve" ? t.skin.steveName : defSkin.name}
                                  />
                                </div>

                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-bold text-white">
                                    {defSkin.id === "steve" ? t.skin.steveName : defSkin.name}
                                  </p>
                                  <p className="truncate text-3xs text-slate-400 mt-0.5">
                                    {t.skin.defaultCharacter}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center justify-between text-3xs pt-2 border-t border-white/5">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[9px] py-0 px-1.5",
                                    isSelected ? "border-brand-light text-brand-light" : "border-white/10 text-slate-400",
                                  )}
                                >
                                  {isSelected ? t.skin.previewing : (defSkin.model === "slim" ? t.skin.slim : t.skin.wide)}
                                </Badge>
                                {isSelected && (
                                  <Check className="h-3.5 w-3.5 text-brand-light" />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="capes"
                    custom={tabDirection}
                    variants={tabVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={tabTransition}
                    className="space-y-6"
                  >
                    {/* 第一區：已持有官方披風 (微軟帳號授權清單，點選可裝備) */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xs font-bold text-slate-200">
                          {t.skin.ownedCapesTitle(accountCapes.length)}
                        </h2>
                        <span className="text-3xs text-slate-400 font-mono">
                          OWNED ASSETS
                        </span>
                      </div>

                      {isRefreshingCapes ? (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(230px,calc((100%-1.75rem)/3)),1fr))] gap-3.5">
                          <CapeCardSkeleton />
                          <CapeCardSkeleton />
                          <CapeCardSkeleton />
                          <CapeCardSkeleton />
                          <CapeCardSkeleton />
                          <CapeCardSkeleton />
                        </div>
                      ) : (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(230px,calc((100%-1.75rem)/3)),1fr))] gap-3.5">
                          {/* 不裝備披風選項 */}
                          <div
                            onClick={() => dispatchPreview({ type: "selectCape", url: "" })}
                            className={cn(
                              "group relative flex flex-col justify-between p-3.5 rounded-xl border transition-all cursor-pointer min-h-[120px]",
                              !previewCapeUrl ? "border-brand-light bg-brand/15 shadow-md shadow-brand/15" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]",
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-black/40 border border-white/10 flex items-center justify-center">
                                <SkinThumbnail
                                  skinUrl={previewSkinUrl}
                                  model={previewModel}
                                  rotationY={Math.PI}
                                  alt={t.skin.noCape}
                                />
                              </div>

                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-bold text-white">
                                  {t.skin.noCape}
                                </p>
                                <p className="text-3xs text-slate-400 mt-0.5">
                                  {t.skin.noCapeDesc}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-3xs pt-2 border-t border-white/5">
                              <span className="text-[9px] text-slate-400 font-mono">
                                UNEQUIPPED
                              </span>
                              {!previewCapeUrl && (
                                <Check className="h-3.5 w-3.5 text-brand-light" />
                              )}
                            </div>
                          </div>

                          {/* 正版微軟帳號持有的真實披風清單 (全量接入 Shadcn UI Tooltip) */}
                          {accountCapes.map((cape) => {
                            const isSelected = previewCapeUrl === cape.url;
                            const capeName = cape.alias || t.skin.officialCape(cape.id.slice(0, 8));
                            const matchedKnown = OFFICIAL_KNOWN_CAPES.find(
                              (k) =>
                                getTextureHash(k.url) === getTextureHash(cape.url) ||
                                (cape.alias && k.alias && k.alias.toLowerCase() === cape.alias.toLowerCase())
                            );

                            return (
                              <Tooltip key={cape.id} className="flex w-full min-w-0">
                                <TooltipTrigger asChild className="flex w-full min-w-0">
                                  <div
                                    onClick={() => dispatchPreview({ type: "selectCape", url: cape.url })}
                                    className={cn(
                                      "group relative flex flex-col justify-between p-3.5 rounded-xl border transition-all cursor-pointer min-h-[120px] w-full",
                                      isSelected ? "border-brand-light bg-brand/15 shadow-md shadow-brand/15" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]",
                                    )}
                                  >
                                    <div className="flex items-center gap-3">
                                      {/* 單例快照縮圖 */}
                                      <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-black/40 border border-white/10 flex items-center justify-center">
                                        <SkinThumbnail
                                          skinUrl={previewSkinUrl}
                                          capeUrl={cape.url}
                                          model={previewModel}
                                          backEquipment={backEquipment}
                                          rotationY={Math.PI}
                                          alt={capeName}
                                        />
                                      </div>

                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-xs font-bold text-white">
                                          {capeName}
                                        </p>
                                        <p className="text-3xs text-slate-400 mt-0.5 line-clamp-2">
                                          {t.skin.statusLabel}{cape.state === "ACTIVE" ? t.skin.mojangDefault : t.skin.ownedOfficial}
                                        </p>
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between text-3xs pt-2 border-t border-white/5">
                                      <span className="text-[9px] text-brand-light font-mono font-semibold">
                                        OFFICIAL OWNED
                                      </span>
                                      {isSelected && (
                                        <Check className="h-3.5 w-3.5 text-brand-light" />
                                      )}
                                    </div>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <div className="space-y-1.5">
                                    <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1">
                                      <span className="font-bold text-white text-xs">
                                        {matchedKnown ? capeText(matchedKnown.id).name : capeName}
                                      </span>
                                      {matchedKnown && (
                                        <span className="text-3xs text-slate-400 font-mono">
                                          {matchedKnown.releaseYear}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-2xs text-slate-300">
                                      {matchedKnown
                                        ? capeText(matchedKnown.id).obtain
                                        : t.skin.ownedDesc}
                                    </p>
                                    <div className="flex items-center gap-1.5 pt-1 text-3xs text-brand-light font-medium">
                                      <Check className="h-3 w-3" />
                                      <span>{t.skin.cloudAssets}</span>
                                    </div>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}

                          {/* 當微軟帳號未持有任何官方披風時的直觀提示 */}
                          {accountCapes.length === 0 && (
                            <div className="col-span-full rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center space-y-3 mt-2">
                              <Sparkles className="h-7 w-7 text-slate-400 mx-auto" />
                              {!hasValidToken ? (
                                <>
                                  <p className="text-xs font-bold text-warning-400">
                                    {t.skin.tokenExpired}
                                  </p>
                                  <p className="text-2xs text-slate-400 max-w-md mx-auto leading-relaxed">
                                    {t.skin.tokenMissingDesc}
                                  </p>
                                  {onOpenLoginModal && (
                                    <div className="pt-2">
                                      <Button
                                        type="button"
                                        onClick={onOpenLoginModal}
                                        className="h-8 px-4 text-xs bg-brand hover:bg-brand-hover text-on-solid font-semibold rounded-lg shadow-md shadow-brand/30"
                                      >
                                        {t.skin.signInToSync}
                                      </Button>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <>
                                  <p className="text-xs font-bold text-slate-300">
                                    {t.skin.noCapesTitle}
                                  </p>
                                  <p className="text-2xs text-slate-400 max-w-md mx-auto leading-relaxed">
                                    {t.skin.noCapesDesc}
                                  </p>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </ScrollArea>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};
