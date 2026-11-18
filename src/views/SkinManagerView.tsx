import React, { useState, useEffect, useRef } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { UserAccount, UserCape } from "@/types/navigation";
import { Skin3DViewer } from "@/components/skin/Skin3DViewer";
import { SkinThumbnail } from "@/components/skin/SkinThumbnail";
import { skinService, SkinItem } from "@/services/skinService";
import { authService } from "@/services/authService";
import { toUserMessage } from "@/lib/errorMessage";
import { toAssetSrc } from "@/lib/assetUrl";
import { toast } from "@/lib/toast";
import { useI18n } from "@/i18n";
import { SlidingIndicator, useSlidingIndicator } from "@/components/ui/sliding-indicator";

export interface DefaultSkinPreset {
  id: string;
  name: string;
  model: "default" | "slim"; // 寬版 (4px) 或 苗條 (3px)
  texturePath: string; // 本地打包資源路徑
}

// 依據 Minecraft Wiki 官方預設外觀對照表收錄之 9 款角色
export const OFFICIAL_9_SKINS: DefaultSkinPreset[] = [
  {
    id: "steve",
    name: "Steve",
    model: "default",
    texturePath: "/assets/skins/wide/steve.png",
  },
  {
    id: "alex",
    name: "Alex",
    model: "slim",
    texturePath: "/assets/skins/slim/alex.png",
  },
  {
    id: "ari",
    name: "Ari",
    model: "default",
    texturePath: "/assets/skins/wide/ari.png",
  },
  {
    id: "kai",
    name: "Kai",
    model: "default",
    texturePath: "/assets/skins/wide/kai.png",
  },
  {
    id: "noor",
    name: "Noor",
    model: "slim",
    texturePath: "/assets/skins/slim/noor.png",
  },
  {
    id: "sunny",
    name: "Sunny",
    model: "default",
    texturePath: "/assets/skins/wide/sunny.png",
  },
  {
    id: "zuri",
    name: "Zuri",
    model: "default",
    texturePath: "/assets/skins/wide/zuri.png",
  },
  {
    id: "efe",
    name: "Efe",
    model: "slim",
    texturePath: "/assets/skins/slim/efe.png",
  },
  {
    id: "makena",
    name: "Makena",
    model: "slim",
    texturePath: "/assets/skins/slim/makena.png",
  },
];

export interface KnownCapeDef {
  id: string;
  name: string;
  enName: string;
  url: string;
  alias?: string;
  category: "event" | "minecon" | "account" | "special" | "staff";
  status: "unobtainable" | "restricted" | "obtainable";
  releaseYear: string;
}

// 依據 Minecraft Wiki 披風專題完整收錄之 21 款官方正統披風（全數經 Mojang 官方 CDN 探測返回 HTTP 200 OK）
export const OFFICIAL_KNOWN_CAPES: KnownCapeDef[] = [
  {
    id: "15th-anniversary",
    name: "15th Anniversary Cape",
    enName: "15th Anniversary Cape",
    url: "https://textures.minecraft.net/texture/cd9d82ab17fd92022dbd4a86cde4c382a7540e117fae7b9a2853658505a80625",
    alias: "15th Anniversary",
    category: "event",
    status: "unobtainable",
    releaseYear: "2024",
  },
  {
    id: "twitch-purple-heart",
    name: "Purple Heart Cape",
    enName: "Purple Heart Cape",
    url: "https://textures.minecraft.net/texture/cb40a92e32b57fd732a00fc325e7afb00a7ca74936ad50d8e860152e482cfbde",
    alias: "Purple Heart",
    category: "event",
    status: "unobtainable",
    releaseYear: "2024",
  },
  {
    id: "tiktok-follower",
    name: "Follower's Cape",
    enName: "Follower's Cape",
    url: "https://textures.minecraft.net/texture/569b7f2a1d00d26f30efe3f9ab9ac817b1e6d35f4f3cfb0324ef2d328223d350",
    alias: "Follower's Cape",
    category: "event",
    status: "unobtainable",
    releaseYear: "2024",
  },
  {
    id: "mcc-15th",
    name: "MCC 15th Anniversary Cape",
    enName: "MCC 15th Anniversary Cape",
    url: "https://textures.minecraft.net/texture/fe8a02dfe9e390e44ff33d69feef9d3943f76d3901015bbd50f0b67722d288bd",
    alias: "MCC 15th",
    category: "event",
    status: "unobtainable",
    releaseYear: "2024",
  },
  {
    id: "experience-villager",
    name: "Minecraft Experience: Villager Rescue Cape",
    enName: "Minecraft Experience: Villager Rescue Cape",
    url: "https://textures.minecraft.net/texture/7658c5025c77cfac7574aab3af94a46a8886e3b7722a895255fbf22ab8652434",
    alias: "Experience",
    category: "event",
    status: "restricted",
    releaseYear: "2024",
  },
  {
    id: "founders",
    name: "Founder's Cape",
    enName: "Founder's Cape",
    url: "https://textures.minecraft.net/texture/99aba02ef05ec6aa4d42db8ee43796d6cd50e4b2954ab29f0caeb85f96bf52a1",
    alias: "Founder's Cape",
    category: "event",
    status: "unobtainable",
    releaseYear: "2019",
  },
  {
    id: "cherry-blossom",
    name: "Cherry Blossom Cape",
    enName: "Cherry Blossom Cape",
    url: "https://textures.minecraft.net/texture/724b1d9bf597b1ebff9546059c25f4625b16ae605bf6adcc4a54c9c1b3f5e55",
    alias: "Cherry Blossom",
    category: "event",
    status: "unobtainable",
    releaseYear: "2023",
  },
  {
    id: "vanilla",
    name: "Vanilla Cape",
    enName: "Vanilla Cape",
    url: "https://textures.minecraft.net/texture/f9a76537647989f9a0b6d001e320dac591c359e9e61a31f4ce11c88f207f0ad4",
    alias: "Vanilla",
    category: "account",
    status: "unobtainable",
    releaseYear: "2022",
  },
  {
    id: "migrator",
    name: "Migrator Cape",
    enName: "Migrator Cape",
    url: "https://textures.minecraft.net/texture/2340c0e03dd66c11d16dd1b9cb023a6044f7153b161093da08b029471e141953",
    alias: "Migrator",
    category: "account",
    status: "unobtainable",
    releaseYear: "2020",
  },
  {
    id: "pan",
    name: "Pan Cape",
    enName: "Pan Cape",
    url: "https://textures.minecraft.net/texture/8f120319222ba397266be33fed89a24911d9f0a0d4c1c1f7a7d3298ec5bb9",
    alias: "Pan",
    category: "account",
    status: "unobtainable",
    releaseYear: "2019",
  },
  {
    id: "minecon-2016",
    name: "MINECON 2016 Cape",
    enName: "MINECON 2016 Cape",
    url: "https://textures.minecraft.net/texture/e7dfea16dc83c97df01a12fabbd1216359c0cd0ea42f9999b6e97c584963e980",
    alias: "Minecon 2016",
    category: "minecon",
    status: "unobtainable",
    releaseYear: "2016",
  },
  {
    id: "minecon-2015",
    name: "MINECON 2015 Cape",
    enName: "MINECON 2015 Cape",
    url: "https://textures.minecraft.net/texture/b0cc08840700447322d953a02b965f1d65a13a603bf64b17c803c21446fe1635",
    alias: "Minecon 2015",
    category: "minecon",
    status: "unobtainable",
    releaseYear: "2015",
  },
  {
    id: "minecon-2013",
    name: "MINECON 2013 Cape",
    enName: "MINECON 2013 Cape",
    url: "https://textures.minecraft.net/texture/153b1a0dfcbae953cdeb6f2c2bf6bf79943239b1372780da44bcbb29273131da",
    alias: "Minecon 2013",
    category: "minecon",
    status: "unobtainable",
    releaseYear: "2013",
  },
  {
    id: "minecon-2012",
    name: "MINECON 2012 Cape",
    enName: "MINECON 2012 Cape",
    url: "https://textures.minecraft.net/texture/a2e8d97ec79100e90a75d369d1b3ba81273c4f82bc1b737e934eed4a854be1b6",
    alias: "Minecon 2012",
    category: "minecon",
    status: "unobtainable",
    releaseYear: "2012",
  },
  {
    id: "minecon-2011",
    name: "MINECON 2011 Cape",
    enName: "MINECON 2011 Cape",
    url: "https://textures.minecraft.net/texture/953cac8b779fe41383e675ee2b86071a71658f2180f56fbce8aa315ea70e2ed6",
    alias: "Minecon 2011",
    category: "minecon",
    status: "unobtainable",
    releaseYear: "2011",
  },
  {
    id: "mojang-studios",
    name: "Mojang Studios Cape",
    enName: "Mojang Studios Cape",
    url: "https://textures.minecraft.net/texture/9e507afc56359978a3eb3e32367042b853cddd0995d17d0da995662913fb00f7",
    alias: "Mojang Studios",
    category: "staff",
    status: "restricted",
    releaseYear: "2021",
  },
  {
    id: "mojang-classic",
    name: "Mojang Classic Cape",
    enName: "Mojang Classic Cape",
    url: "https://textures.minecraft.net/texture/8f120319222a9f4a104e2f5cb97b2cda93199a2ee9e1585cb8d09d6f687cb761",
    alias: "Mojang Classic",
    category: "staff",
    status: "restricted",
    releaseYear: "2010",
  },
  {
    id: "realms-mapmaker",
    name: "Realms Mapmaker Cape",
    enName: "Realms Mapmaker Cape",
    url: "https://textures.minecraft.net/texture/17912790ff164b93196f08ba71d0e62129304776d0f347334f8a6eae509f8a56",
    alias: "Realms Mapmaker",
    category: "special",
    status: "restricted",
    releaseYear: "2016",
  },
  {
    id: "translator",
    name: "Translator Cape",
    enName: "Translator Cape",
    url: "https://textures.minecraft.net/texture/1bf91499701404e21bd46b0191d63239a4ef76ebde88d27e4d430ac211df681e",
    alias: "Translator",
    category: "special",
    status: "unobtainable",
    releaseYear: "2015",
  },
  {
    id: "turtle",
    name: "Turtle Cape",
    enName: "Turtle Cape",
    url: "https://textures.minecraft.net/texture/5048ea61566353397247d2b7d946034de926b997d5e66c86483dfb1e031aee95",
    alias: "Turtle",
    category: "special",
    status: "unobtainable",
    releaseYear: "2018",
  },
  {
    id: "cobalt",
    name: "Cobalt Cape",
    enName: "Cobalt Cape",
    url: "https://textures.minecraft.net/texture/ca35c56efe71ed290385f4ab5346a1826b546a54d519e6a3ff01efa01acce81",
    alias: "Cobalt",
    category: "special",
    status: "unobtainable",
    releaseYear: "2016",
  },
];

type AnimationMode = "idle" | "walk" | "run";

// 水平分頁轉場慣性索引 (GEMINI.md Invariant)
const SUB_TAB_ORDER: Record<string, number> = {
  wardrobe: 0,
  capes: 1,
};

// 骨架屏載入佔位元件
const SkinCardSkeleton: React.FC = () => (
  <div className="flex flex-col justify-between p-3 rounded-xl border border-white/5 bg-white/[0.02] min-h-[120px] space-y-2">
    <div className="flex items-center gap-3">
      <Skeleton className="h-20 w-16 shrink-0 rounded-lg bg-white/5" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-24 rounded bg-white/5" />
        <Skeleton className="h-2.5 w-16 rounded bg-white/5" />
        <Skeleton className="h-2 w-12 rounded bg-white/5" />
      </div>
    </div>
    <div className="pt-2 border-t border-white/5 flex justify-between items-center">
      <Skeleton className="h-3 w-12 rounded bg-white/5" />
    </div>
  </div>
);

const CapeCardSkeleton: React.FC = () => (
  <div className="flex flex-col justify-between p-3.5 rounded-xl border border-white/5 bg-white/[0.02] min-h-[120px] space-y-2">
    <div className="flex items-center gap-3">
      <Skeleton className="h-20 w-16 shrink-0 rounded-lg bg-white/5" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-28 rounded bg-white/5" />
        <Skeleton className="h-2.5 w-20 rounded bg-white/5" />
      </div>
    </div>
    <div className="pt-2 border-t border-white/5 flex justify-between items-center">
      <Skeleton className="h-3 w-16 rounded bg-white/5" />
    </div>
  </div>
);

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
  const [activeTab, setActiveTab] = useState<"wardrobe" | "capes">("wardrobe");
  const [tabDirection, setTabDirection] = useState<number>(0);

  // 基準原始狀態
  const [initialSkinUrl, setInitialSkinUrl] = useState<string>(
    activeAccount.skinUrl || OFFICIAL_9_SKINS[0].texturePath
  );
  const [initialCapeUrl, setInitialCapeUrl] = useState<string>(
    activeAccount.capeUrl || ""
  );
  const [backEquipment, setBackEquipment] = useState<"cape" | "elytra">("cape");

  // 即時 3D 預覽狀態
  const [previewSkinUrl, setPreviewSkinUrl] = useState<string>(initialSkinUrl);
  const [previewCapeUrl, setPreviewCapeUrl] = useState<string>(initialCapeUrl);
  const [previewModel, setPreviewModel] = useState<"default" | "slim" | "auto-detect">(
    activeAccount.skinModel || "auto-detect"
  );
  const [animation, setAnimation] = useState<AnimationMode>("idle");
  const animPill = useSlidingIndicator(animation);
  const tabLine = useSlidingIndicator(activeTab);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);

  // 使用者正版帳號持有的真實披風
  const [accountCapes, setAccountCapes] = useState<UserCape[]>(activeAccount.capes || []);
  const [hasValidToken, setHasValidToken] = useState<boolean>(activeAccount.hasValidToken ?? true);
  const [isRefreshingCapes, setIsRefreshingCapes] = useState<boolean>(false);
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
    if (target === activeTab) return;
    const currentIdx = SUB_TAB_ORDER[activeTab] ?? 0;
    const targetIdx = SUB_TAB_ORDER[target] ?? 0;
    setTabDirection(targetIdx > currentIdx ? 1 : -1);
    setActiveTab(target);
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
        if (isMounted && refreshed) {
          if (refreshed.skinModel) {
            setPreviewModel(refreshed.skinModel);
          }
          if (refreshed.capes) {
            setAccountCapes(refreshed.capes);
          }
          if (refreshed.hasValidToken !== undefined) {
            setHasValidToken(refreshed.hasValidToken);
          }
          if (onAccountUpdated) {
            onAccountUpdated(refreshed);
          }
        }
      });
    }

    return () => {
      isMounted = false;
    };
  }, [activeAccount.id]);

  // 重設回原始帳號外觀
  const handleReset = () => {
    setPreviewSkinUrl(initialSkinUrl);
    setPreviewCapeUrl(initialCapeUrl);
    setPreviewModel(activeAccount.skinModel || "auto-detect");
  };

  // 手動更新微軟正版披風資產
  const handleRefreshCapes = async () => {
    if (!activeAccount.id || activeAccount.id === "guest") return;
    try {
      setIsRefreshingCapes(true);
      const refreshed = await authService.refreshProfile(activeAccount.id);
      if (refreshed) {
        if (refreshed.skinModel) {
          setPreviewModel(refreshed.skinModel);
        }
        if (refreshed.capes) {
          setAccountCapes(refreshed.capes);
        }
        if (refreshed.hasValidToken !== undefined) {
          setHasValidToken(refreshed.hasValidToken);
        }
        if (onAccountUpdated) {
          onAccountUpdated(refreshed);
        }
      }
    } catch (err) {
      console.warn("Refresh capes failed:", err);
    } finally {
      setIsRefreshingCapes(false);
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
      setInitialSkinUrl(previewSkinUrl);
      setInitialCapeUrl(previewCapeUrl);

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
        setPreviewSkinUrl(created.blobUrl);
        setPreviewModel("auto-detect");
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
      x: dir * 32,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: -dir * 32,
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
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-brand to-brand-dark text-white shadow-md shadow-brand/25 border border-white/15">
              <Shirt className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-white">
                {t.skin.title}
              </h1>
              <p className="text-[11px] text-slate-400">
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
            <div className="relative flex flex-col items-center justify-between flex-1 min-h-[220px] w-full rounded-2xl border border-white/10 bg-gradient-to-b from-white/5 to-black/40 p-3 backdrop-blur-md shadow-xl overflow-hidden">
              <div className="flex items-center justify-between w-full shrink-0 mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="flex h-2 w-2 rounded-full bg-brand-light animate-pulse" />
                  <span className="text-[10px] font-mono font-medium text-slate-400">
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
                <p className="text-[10px] text-slate-500 text-center pb-1">
                  {t.skin.dragHint}
                </p>

                {/* Reserve the row's height permanently and only fade it, so showing the buttons
                    never resizes the 3D viewer above (that resize caused the flicker). */}
                <div
                  className={`flex h-10 items-center gap-2 w-full border-t border-white/10 pt-1.5 transition-opacity duration-150 ${
                    isDirty ? "opacity-100" : "pointer-events-none opacity-0"
                  }`}
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
                        className="flex-1 text-xs h-7.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-semibold shadow-md shadow-brand/30"
                      >
                        <Save className="h-3 w-3 mr-1" />
                        {isSaving ? t.skin.saving : t.skin.saveChanges}
                      </Button>
                </div>
              </div>
            </div>

            {/* 3D 動作模式與視角運鏡控制面板 (緊湊佈局，shrink-0 確保永不遭擠壓) */}
            <div className="w-full space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-2.5 text-xs shrink-0">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-300">
                  {t.skin.animationMode}
                </label>
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
                        className={`relative flex-1 py-1 text-xs font-semibold transition-colors duration-150 ${
                          isActive ? "text-white" : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        <span className="relative z-10 flex items-center justify-center gap-1 text-[11px]">
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
                    <span className="text-[11px] font-semibold text-slate-300">
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
                    <span className="text-[11px] font-semibold text-slate-300">
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
                  className={`relative flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold transition-colors ${
                    activeTab === "wardrobe"
                      ? "text-brand-light"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Shirt className="h-4 w-4" />
                  <span>{t.skin.tabSkins(localSkins.length + OFFICIAL_9_SKINS.length)}</span>
                </button>

                <button
                  ref={tabLine.register("capes")}
                  type="button"
                  onClick={() => handleTabChange("capes")}
                  className={`relative flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold transition-colors ${
                    activeTab === "capes"
                      ? "text-brand-light"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Sparkles className="h-4 w-4" />
                  <span>{t.skin.tabCapes(accountCapes.length)}</span>
                </button>
              </div>

              {activeTab === "capes" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefreshCapes}
                  disabled={isRefreshingCapes}
                  className="h-8 px-2.5 text-xs text-slate-400 hover:text-white border border-white/10 hover:bg-white/5 rounded-lg mb-1"
                  title={t.skin.refreshCapesAttr}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 mr-1.5 ${isRefreshingCapes ? "animate-spin text-brand-light" : ""}`}
                  />
                  <span>{isRefreshingCapes ? t.skin.syncing : t.skin.refresh}</span>
                </Button>
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
                        <span className="text-[10px] text-slate-500 font-mono">
                          {t.skin.fileCount(localSkins.length)}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                        {/* 上傳卡片 */}
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setIsDragOver(true);
                          }}
                          onDragLeave={() => setIsDragOver(false)}
                          onDrop={handleDropSkin}
                          className={`flex flex-col items-center justify-center p-4 rounded-xl border border-dashed transition-all cursor-pointer text-center space-y-1.5 group min-h-[120px] ${
                            isDragOver
                              ? "border-brand-light bg-brand/15"
                              : "border-white/15 bg-white/[0.02] hover:bg-white/[0.05] hover:border-brand-light/50"
                          }`}
                        >
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-slate-400 group-hover:text-brand-light group-hover:bg-brand/20 transition-colors">
                            <Plus className="h-4 w-4" />
                          </div>
                          <span className="text-xs font-bold text-slate-200">
                            {isUploading ? t.skin.uploading : t.skin.uploadNew}
                          </span>
                          <span className="text-[10px] text-slate-500">
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
                                    setPreviewSkinUrl(skin.blobUrl);
                                    setPreviewModel("auto-detect");
                                  }
                                }}
                                className={`group relative flex flex-col justify-between p-3 rounded-xl border transition-all cursor-pointer min-h-[120px] ${
                                  isSelected
                                    ? "border-brand-light bg-brand/15 shadow-md shadow-brand/15"
                                    : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                                }`}
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
                                    <p className="truncate text-[10px] text-slate-400 font-mono mt-0.5">
                                      {t.skin.customSkin}
                                    </p>
                                    <p className="text-[10px] text-slate-500 mt-1">
                                      {Math.max(1, Math.round(skin.bytes.length / 1024))} KB
                                    </p>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={(e) => handleDeleteSkin(skin.filename, e)}
                                    className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors self-start"
                                    title={t.skin.deleteFromLocker}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>

                                <div className="flex items-center justify-between text-[10px] pt-2 border-t border-white/5">
                                  <Badge
                                    variant="outline"
                                    className={`text-[9px] py-0 px-1.5 ${
                                      isSelected
                                        ? "border-brand-light text-brand-light"
                                        : "border-white/10 text-slate-400"
                                    }`}
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
                        <span className="text-[10px] text-slate-500 font-mono">
                          Minecraft Official Presets
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                        {OFFICIAL_9_SKINS.map((defSkin) => {
                          const isSelected = previewSkinUrl === defSkin.texturePath;
                          return (
                            <div
                              key={defSkin.id}
                              onClick={() => {
                                setPreviewSkinUrl(defSkin.texturePath);
                                setPreviewModel(defSkin.model);
                              }}
                              className={`group relative flex flex-col justify-between p-3 rounded-xl border transition-all cursor-pointer min-h-[120px] ${
                                isSelected
                                  ? "border-brand-light bg-brand/15 shadow-md shadow-brand/15"
                                  : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                              }`}
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
                                  <p className="truncate text-[10px] text-slate-400 mt-0.5">
                                    {t.skin.defaultCharacter}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center justify-between text-[10px] pt-2 border-t border-white/5">
                                <Badge
                                  variant="outline"
                                  className={`text-[9px] py-0 px-1.5 ${
                                    isSelected
                                      ? "border-brand-light text-brand-light"
                                      : "border-white/10 text-slate-400"
                                  }`}
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
                        <span className="text-[10px] text-slate-500 font-mono">
                          OWNED ASSETS
                        </span>
                      </div>

                      {isRefreshingCapes ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                          <CapeCardSkeleton />
                          <CapeCardSkeleton />
                          <CapeCardSkeleton />
                          <CapeCardSkeleton />
                          <CapeCardSkeleton />
                          <CapeCardSkeleton />
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                          {/* 不裝備披風選項 */}
                          <div
                            onClick={() => setPreviewCapeUrl("")}
                            className={`group relative flex flex-col justify-between p-3.5 rounded-xl border transition-all cursor-pointer min-h-[120px] ${
                              !previewCapeUrl
                                ? "border-brand-light bg-brand/15 shadow-md shadow-brand/15"
                                : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                            }`}
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
                                <p className="text-[10px] text-slate-400 mt-0.5">
                                  {t.skin.noCapeDesc}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-[10px] pt-2 border-t border-white/5">
                              <span className="text-[9px] text-slate-500 font-mono">
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
                              <Tooltip key={cape.id}>
                                <TooltipTrigger asChild>
                                  <div
                                    onClick={() => setPreviewCapeUrl(cape.url)}
                                    className={`group relative flex flex-col justify-between p-3.5 rounded-xl border transition-all cursor-pointer min-h-[120px] w-full ${
                                      isSelected
                                        ? "border-brand-light bg-brand/15 shadow-md shadow-brand/15"
                                        : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                                    }`}
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
                                        <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">
                                          {t.skin.statusLabel}{cape.state === "ACTIVE" ? t.skin.mojangDefault : t.skin.ownedOfficial}
                                        </p>
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between text-[10px] pt-2 border-t border-white/5">
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
                                        <span className="text-[10px] text-slate-400 font-mono">
                                          {matchedKnown.releaseYear}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-slate-300">
                                      {matchedKnown
                                        ? capeText(matchedKnown.id).obtain
                                        : t.skin.ownedDesc}
                                    </p>
                                    <div className="flex items-center gap-1.5 pt-1 text-[10px] text-brand-light font-medium">
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
                              <Sparkles className="h-7 w-7 text-slate-500 mx-auto" />
                              {!hasValidToken ? (
                                <>
                                  <p className="text-xs font-bold text-amber-400">
                                    {t.skin.tokenExpired}
                                  </p>
                                  <p className="text-[11px] text-slate-400 max-w-md mx-auto leading-relaxed">
                                    {t.skin.tokenMissingDesc}
                                  </p>
                                  {onOpenLoginModal && (
                                    <div className="pt-2">
                                      <Button
                                        type="button"
                                        onClick={onOpenLoginModal}
                                        className="h-8 px-4 text-xs bg-brand hover:bg-brand-hover text-white font-semibold rounded-lg shadow-md shadow-brand/30"
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
                                  <p className="text-[11px] text-slate-500 max-w-md mx-auto leading-relaxed">
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
