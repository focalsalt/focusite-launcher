import React, { useState, useEffect, useRef, useMemo } from "react";
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
  CheckCircle2,
  RefreshCw,
  Lock,
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

export interface DefaultSkinPreset {
  id: string;
  name: string;
  model: "default" | "slim"; // 寬版 (4px) 或 苗條 (3px)
  desc: string;
  texturePath: string; // 本地打包資源路徑
}

// 依據 Minecraft Wiki 官方預設外觀對照表收錄之 9 款角色
export const OFFICIAL_9_SKINS: DefaultSkinPreset[] = [
  {
    id: "steve",
    name: "Steve (史蒂夫)",
    model: "default",
    desc: "預設角色",
    texturePath: "/assets/skins/wide/steve.png",
  },
  {
    id: "alex",
    name: "Alex",
    model: "slim",
    desc: "預設角色",
    texturePath: "/assets/skins/slim/alex.png",
  },
  {
    id: "ari",
    name: "Ari",
    model: "default",
    desc: "預設角色",
    texturePath: "/assets/skins/wide/ari.png",
  },
  {
    id: "kai",
    name: "Kai",
    model: "default",
    desc: "預設角色",
    texturePath: "/assets/skins/wide/kai.png",
  },
  {
    id: "noor",
    name: "Noor",
    model: "slim",
    desc: "預設角色",
    texturePath: "/assets/skins/slim/noor.png",
  },
  {
    id: "sunny",
    name: "Sunny",
    model: "default",
    desc: "預設角色",
    texturePath: "/assets/skins/wide/sunny.png",
  },
  {
    id: "zuri",
    name: "Zuri",
    model: "default",
    desc: "預設角色",
    texturePath: "/assets/skins/wide/zuri.png",
  },
  {
    id: "efe",
    name: "Efe",
    model: "slim",
    desc: "預設角色",
    texturePath: "/assets/skins/slim/efe.png",
  },
  {
    id: "makena",
    name: "Makena",
    model: "slim",
    desc: "預設角色",
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
  description: string;
  obtainDetails: string;
}

// 依據 Minecraft Wiki 披風專題完整收錄之 21 款官方正統披風（全數經 Mojang 官方 CDN 探測返回 HTTP 200 OK）
export const OFFICIAL_KNOWN_CAPES: KnownCapeDef[] = [
  {
    id: "15th-anniversary",
    name: "15 週年紀念披風",
    enName: "15th Anniversary Cape",
    url: "https://textures.minecraft.net/texture/cd9d82ab17fd92022dbd4a86cde4c382a7540e117fae7b9a2853658505a80625",
    alias: "15th Anniversary",
    category: "event",
    status: "unobtainable",
    releaseYear: "2024",
    description: "Minecraft 15 週年慶典紀念披風，具備標誌性深綠苦力怕面容紋理。",
    obtainDetails: "2024 年 5 月於 Minecraft 官方網站慶典活動期間限時免費領取。現活動已完全截止，無法再次獲取。",
  },
  {
    id: "twitch-purple-heart",
    name: "Twitch 紫心披風",
    enName: "Purple Heart Cape",
    url: "https://textures.minecraft.net/texture/cb40a92e32b57fd732a00fc325e7afb00a7ca74936ad50d8e860152e482cfbde",
    alias: "Purple Heart",
    category: "event",
    status: "unobtainable",
    releaseYear: "2024",
    description: "15 週年 Twitch 直播活動掉寶限定披風，背面飾有經典紫心發光圖騰。",
    obtainDetails: "於 Twitch 觀看指定 Minecraft 合作直播頻道達 15 分鐘獲得啟用碼。兌換代碼已全數過期失效，現已絕版。",
  },
  {
    id: "tiktok-follower",
    name: "TikTok 追隨者披風",
    enName: "Follower's Cape",
    url: "https://textures.minecraft.net/texture/569b7f2a1d00d26f30efe3f9ab9ac817b1e6d35f4f3cfb0324ef2d328223d350",
    alias: "Follower's Cape",
    category: "event",
    status: "unobtainable",
    releaseYear: "2024",
    description: "15 週年 TikTok 社群連動披風，由青色與櫻紅交錯呈現現代潮流感。",
    obtainDetails: "於 TikTok 直播期間觀看 Minecraft 直播並發送指定互動留言獲取兌換代碼。2024 年 6 月代碼失效後已不可再獲取。",
  },
  {
    id: "mcc-15th",
    name: "MCC 15 週年慶典披風",
    enName: "MCC 15th Anniversary Cape",
    url: "https://textures.minecraft.net/texture/fe8a02dfe9e390e44ff33d69feef9d3943f76d3901015bbd50f0b67722d288bd",
    alias: "MCC 15th",
    category: "event",
    status: "unobtainable",
    releaseYear: "2024",
    description: "Minecraft 與 MC Championship 官方跨界合作之競技活動披風。",
    obtainDetails: "於 2024 年 7 月進入官方限定 MCC 活動伺服器，完成 15 項挑戰任務後於基岩與 Java 雙端同步領取。現活動伺服器已關閉絕版。",
  },
  {
    id: "experience-villager",
    name: "Minecraft 體驗巡展披風",
    enName: "Minecraft Experience: Villager Rescue Cape",
    url: "https://textures.minecraft.net/texture/7658c5025c77cfac7574aab3af94a46a8886e3b7722a895255fbf22ab8652434",
    alias: "Experience",
    category: "event",
    status: "restricted",
    releaseYear: "2024",
    description: "全球線下實體沉浸式巡迴展《Villager Rescue》官方門票限定披風。",
    obtainDetails: "僅限購票親臨美國達拉斯等實體展覽現場並完成現場互動體驗之玩家獲得。一般線上玩家管道無法獲取。",
  },
  {
    id: "founders",
    name: "創始人金色苦力怕披風",
    enName: "Founder's Cape",
    url: "https://textures.minecraft.net/texture/99aba02ef05ec6aa4d42db8ee43796d6cd50e4b2954ab29f0caeb85f96bf52a1",
    alias: "Founder's Cape",
    category: "event",
    status: "unobtainable",
    releaseYear: "2019",
    description: "MINECON Live 2019 發布的角色建立器第一款官方歷史披風。",
    obtainDetails: "於 2019 年秋季在官方市集中限時免費領取。活動結束後已永久下架不再供應。",
  },
  {
    id: "cherry-blossom",
    name: "櫻花披風",
    enName: "Cherry Blossom Cape",
    url: "https://textures.minecraft.net/texture/724b1d9bf597b1ebff9546059c25f4625b16ae605bf6adcc4a54c9c1b3f5e55",
    alias: "Cherry Blossom",
    category: "event",
    status: "unobtainable",
    releaseYear: "2023",
    description: "Minecraft Live 2023 生物投票紀念披風，柔和粉白櫻花瓣點綴。",
    obtainDetails: "頒發給參與 2023 年 10 月 Minecraft Live 官方伺服器生物投票（犰狳獲勝）之所有玩家。投票截止後已絕版。",
  },
  {
    id: "vanilla",
    name: "原版雙版本整合披風",
    enName: "Vanilla Cape",
    url: "https://textures.minecraft.net/texture/f9a76537647989f9a0b6d001e320dac591c359e9e61a31f4ce11c88f207f0ad4",
    alias: "Vanilla",
    category: "account",
    status: "unobtainable",
    releaseYear: "2022",
    description: "致敬在微軟推出雙端同捆之前，同時購入 Java 與基岩版之資深元老玩家。",
    obtainDetails: "於 2022 年 6 月 6 日整合販售前，同 Microsoft 帳號下同時擁有兩版遊戲之玩家免費發放。已於 2022 年底截止。",
  },
  {
    id: "migrator",
    name: "遷移者披風",
    enName: "Migrator Cape",
    url: "https://textures.minecraft.net/texture/2340c0e03dd66c11d16dd1b9cb023a6044f7153b161093da08b029471e141953",
    alias: "Migrator",
    category: "account",
    status: "unobtainable",
    releaseYear: "2020",
    description: "自願將舊版 Mojang 帳號自願轉移遷移至微軟帳號之官方紀念獎勵。",
    obtainDetails: "官方帳號遷移專案於 2023 年 12 月 18 日全面終止，未遷移之舊帳號已失效。此披風已成為不可再得之歷史遺產。",
  },
  {
    id: "pan",
    name: "煎鍋披風 (Pancake)",
    enName: "Pan Cape",
    url: "https://textures.minecraft.net/texture/8f120319222ba397266be33fed89a24911d9f0a0d4c1c1f7a7d3298ec5bb9",
    alias: "Pan",
    category: "account",
    status: "unobtainable",
    releaseYear: "2019",
    description: "參與 Minecraft 基岩版早期 Beta 測試之紀念披風，背面繪有煎鍋與鬆餅。",
    obtainDetails: "授予在 Android 及 Windows 10 上參與早期 Beta 測試計畫之測試玩家。測試結束後已不可獲取。",
  },
  {
    id: "minecon-2016",
    name: "MINECON 2016 幽靈披風",
    enName: "MINECON 2016 Cape",
    url: "https://textures.minecraft.net/texture/e7dfea16dc83c97df01a12fabbd1216359c0cd0ea42f9999b6e97c584963e980",
    alias: "Minecon 2016",
    category: "minecon",
    status: "unobtainable",
    releaseYear: "2016",
    description: "加州安那翰會議中心 MINECON 2016 現場參會者紀念披風，飾有終界使者面容。",
    obtainDetails: "需於 2016 年 9 月親臨加州現場參會驗票取得，全球登記總量約 1 萬枚，官方不可再獲取。",
  },
  {
    id: "minecon-2015",
    name: "MINECON 2015 鐵傀儡披風",
    enName: "MINECON 2015 Cape",
    url: "https://textures.minecraft.net/texture/b0cc08840700447322d953a02b965f1d65a13a603bf64b17c803c21446fe1635",
    alias: "Minecon 2015",
    category: "minecon",
    status: "unobtainable",
    releaseYear: "2015",
    description: "英國倫敦 ExCeL 展覽中心 MINECON 2015 參會者紀念披風，紋理取自鐵傀儡容顏。",
    obtainDetails: "僅限倫敦實體入場券持有者依註冊信件代碼兌換，為極具代表性的歐洲盛會紀念，已永久絕版。",
  },
  {
    id: "minecon-2013",
    name: "MINECON 2013 綠活塞披風",
    enName: "MINECON 2013 Cape",
    url: "https://textures.minecraft.net/texture/153b1a0dfcbae953cdeb6f2c2bf6bf79943239b1372780da44bcbb29273131da",
    alias: "Minecon 2013",
    category: "minecon",
    status: "unobtainable",
    releaseYear: "2013",
    description: "美國佛羅里達州奧蘭多 MINECON 2013 現場參會者披風，圖騰為經典活塞機構。",
    obtainDetails: "限奧蘭治縣會議中心參會者兌換，存世登記數量約 6,000 枚，為高價值收藏品，已永久絕版。",
  },
  {
    id: "minecon-2012",
    name: "MINECON 2012 黃金鎬披風",
    enName: "MINECON 2012 Cape",
    url: "https://textures.minecraft.net/texture/a2e8d97ec79100e90a75d369d1b3ba81273c4f82bc1b737e934eed4a854be1b6",
    alias: "Minecon 2012",
    category: "minecon",
    status: "unobtainable",
    releaseYear: "2012",
    description: "法國巴黎歐洲迪士尼樂園 MINECON 2012 參會限定披風，飾有深藍夜空與黃金十字鎬。",
    obtainDetails: "4,500 名巴黎現場出席者專屬。作為 Minecraft 早期在歐洲舉行的大型年會紀念，已永久絕版。",
  },
  {
    id: "minecon-2011",
    name: "MINECON 2011 經典紅苦力怕披風",
    enName: "MINECON 2011 Cape",
    url: "https://textures.minecraft.net/texture/953cac8b779fe41383e675ee2b86071a71658f2180f56fbce8aa315ea70e2ed6",
    alias: "Minecon 2011",
    category: "minecon",
    status: "unobtainable",
    releaseYear: "2011",
    description: "首屆美國拉斯維加斯 MINECON 2011 創始披風，深紅織錦襯托經典黑色苦力怕臉面孔。",
    obtainDetails: "慶祝 Minecraft 1.0 正式版發表，僅發放給萬麗酒店首屆現場與會者。為遊戲史上最珍稀的披風之一，已絕版。",
  },
  {
    id: "mojang-studios",
    name: "Mojang Studios 現代員工披風",
    enName: "Mojang Studios Cape",
    url: "https://textures.minecraft.net/texture/9e507afc56359978a3eb3e32367042b853cddd0995d17d0da995662913fb00f7",
    alias: "Mojang Studios",
    category: "staff",
    status: "restricted",
    releaseYear: "2021",
    description: "2021 年 Mojang 品牌全面重塑後，向全體在職雇員核發之現代紅標員工披風。",
    obtainDetails: "僅限在職之 Mojang Studios 官方員工及官方直屬開發者擁有。一般公開玩家無法獲取。",
  },
  {
    id: "mojang-classic",
    name: "Mojang 經典紅底員工披風",
    enName: "Mojang Classic Cape",
    url: "https://textures.minecraft.net/texture/8f120319222a9f4a104e2f5cb97b2cda93199a2ee9e1585cb8d09d6f687cb761",
    alias: "Mojang Classic",
    category: "staff",
    status: "restricted",
    releaseYear: "2010",
    description: "Notch 與 Mojang 創始核心團隊於 2010 年創辦初期配戴之經典紅色烙印披風。",
    obtainDetails: "早期 Mojang 核心雇員專屬。現已替換為 Studios 現代版本，非官方團隊人員不可獲取。",
  },
  {
    id: "realms-mapmaker",
    name: "Realms 官方地圖創作者披風",
    enName: "Realms Mapmaker Cape",
    url: "https://textures.minecraft.net/texture/17912790ff164b93196f08ba71d0e62129304776d0f347334f8a6eae509f8a56",
    alias: "Realms Mapmaker",
    category: "special",
    status: "restricted",
    releaseYear: "2016",
    description: "由 Mojang 頒發給在 Minecraft Realms 官方平台發布高品質自訂地圖之卓越地圖創作者。",
    obtainDetails: "需於 Realms 地圖發布計畫中通過審查並累積達標之創作者積分方能申請核發。非公開發放項目。",
  },
  {
    id: "translator",
    name: "Crowdin 官方翻譯志工披風",
    enName: "Translator Cape",
    url: "https://textures.minecraft.net/texture/1bf91499701404e21bd46b0191d63239a4ef76ebde88d27e4d430ac211df681e",
    alias: "Translator",
    category: "special",
    status: "unobtainable",
    releaseYear: "2015",
    description: "Mojang 曾授予在 Crowdin 官方多國語言本地化專案中貢獻卓著之社群翻譯志工。",
    obtainDetails: "該翻譯獎勵計畫已於 2015 年完全停止發放，現已成為絕版社群紀念披風。",
  },
  {
    id: "turtle",
    name: "海龜倡議者特製披風",
    enName: "Turtle Cape",
    url: "https://textures.minecraft.net/texture/5048ea61566353397247d2b7d946034de926b997d5e66c86483dfb1e031aee95",
    alias: "Turtle",
    category: "special",
    status: "unobtainable",
    releaseYear: "2018",
    description: "Mojang 特別為在 Reddit 上提出海龜概念並推動海洋更新之玩家 billyK_ 專屬訂製。",
    obtainDetails: "全球僅極少數個別特定貢獻者擁有，為官方對社群原創創意的崇高致敬，不可常規獲取。",
  },
  {
    id: "cobalt",
    name: "Cobalt 錦標賽冠軍披風",
    enName: "Cobalt Cape",
    url: "https://textures.minecraft.net/texture/ca35c56efe71ed290385f4ab5346a1826b546a54d519e6a3ff01efa01acce81",
    alias: "Cobalt",
    category: "special",
    status: "unobtainable",
    releaseYear: "2016",
    description: "授予由 Oxeye Game Studio 研發、Mojang 發行之 Cobalt 官方社群錦標賽獲勝選手。",
    obtainDetails: "於 2016 年 2 月官方錦標賽結束後向優勝隊伍頒發。賽事已落幕，已永久絕版。",
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
  const [autoRotate, setAutoRotate] = useState<boolean>(false);

  // 使用者正版帳號持有的真實披風
  const [accountCapes, setAccountCapes] = useState<UserCape[]>(activeAccount.capes || []);
  const [hasValidToken, setHasValidToken] = useState<boolean>(activeAccount.hasValidToken ?? true);
  const [isRefreshingCapes, setIsRefreshingCapes] = useState<boolean>(false);
  const [isLoadingSkins, setIsLoadingSkins] = useState<boolean>(true);

  // 保存中與保存成功反饋
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [savedNotice, setSavedNotice] = useState<boolean>(false);

  // 本機皮膚庫狀態 (%APPDATA%/focusite_launcher/skins/)
  const [localSkins, setLocalSkins] = useState<SkinItem[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 輔助函式：提取貼圖 Hash 供比對持有狀態
  const getTextureHash = (url: string) => {
    const parts = url.split("/");
    return parts[parts.length - 1].replace(/\.png$/, "").toLowerCase();
  };

  const isCapeInAccount = (capeUrl: string, capeName?: string) => {
    if (!capeUrl) return false;
    const hash = getTextureHash(capeUrl);
    return accountCapes.some((ac) => {
      if (getTextureHash(ac.url) === hash) return true;
      if (ac.alias && capeName && ac.alias.toLowerCase() === capeName.toLowerCase()) return true;
      return false;
    });
  };

  // 篩選未持有的官方披風清單（依 Wiki 完整收錄）
  const unownedKnownCapes = useMemo(() => {
    return OFFICIAL_KNOWN_CAPES.filter(
      (kc) => !isCapeInAccount(kc.url, kc.alias || kc.name)
    );
  }, [accountCapes]);

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
      await authService.updateAccountSkin(
        activeAccount.id,
        previewSkinUrl,
        previewCapeUrl
      );

      // 更新基準值，使 isDirty 歸零
      setInitialSkinUrl(previewSkinUrl);
      setInitialCapeUrl(previewCapeUrl);

      activeAccount.skinUrl = previewSkinUrl;
      activeAccount.capeUrl = previewCapeUrl;

      if (onAccountUpdated) {
        onAccountUpdated({
          ...activeAccount,
          skinUrl: previewSkinUrl,
          capeUrl: previewCapeUrl,
          capes: accountCapes,
        });
      }

      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2000);
    } catch (err) {
      console.error("Failed to save skin:", err);
    } finally {
      setIsSaving(false);
    }
  };

  // 處理自訂皮膚上傳
  const handleUploadSkin = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".png")) {
      alert("請選擇標準 Minecraft 皮膚 .png 檔案");
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
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // 刪除本機皮膚
  const handleDeleteSkin = async (filename: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await skinService.deleteLocalSkin(filename);
      setLocalSkins((prev) => prev.filter((s) => s.filename !== filename));
    } catch (err) {
      console.error("Failed to delete skin:", err);
    }
  };

  // 動作模式純肢體選項 (旋轉已抽離為獨立 Switch 控制)
  const animButtons: { id: AnimationMode; label: string; icon: React.ReactNode }[] = [
    { id: "idle", label: "靜止", icon: null },
    { id: "walk", label: "行走", icon: <Footprints className="h-3 w-3" /> },
    { id: "run", label: "跑步", icon: <Activity className="h-3 w-3" /> },
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
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-[#3C8527] to-[#2E6B1D] text-white shadow-md shadow-[#3C8527]/25 border border-white/15">
              <Shirt className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-white">
                外觀與披風管理 (Skins & Capes)
              </h1>
              <p className="text-[11px] text-slate-400">
                玩家 <span className="font-semibold text-[#52A43A]">{activeAccount.username}</span> 的外觀皮膚自訂中心，支援即時 3D 模型渲染與全量官方披風圖鑑。
              </p>
            </div>
          </div>

          {savedNotice && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-medium animate-in fade-in duration-200">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>外觀設定已成功保存至微軟雲端</span>
            </div>
          )}
        </div>

        {/* 左右雙欄式主體 (左側固定 3D 自適應縮放，右側為 Scroll Area) */}
        <div className="flex flex-1 overflow-hidden p-6 gap-6 min-h-0">
          {/* 左側欄 (固定寬度 310px，純 Flex 佈局，高度緊貼視窗永不溢出) */}
          <div className="flex flex-col gap-3 shrink-0 w-[310px] h-full min-h-0 overflow-hidden justify-between">
            {/* 3D 玩家模型視圖主卡片 (自適應彈性高度，佔滿垂直剩餘空間) */}
            <div className="relative flex flex-col items-center justify-between flex-1 min-h-[220px] w-full rounded-2xl border border-white/10 bg-gradient-to-b from-white/5 to-black/40 p-3 backdrop-blur-md shadow-xl overflow-hidden">
              <div className="flex items-center justify-between w-full shrink-0 mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="flex h-2 w-2 rounded-full bg-[#52A43A] animate-pulse" />
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
                  按住滑鼠左鍵拖曳旋轉・滾輪縮放視角
                </p>

                {/* 如有更改，浮現重設與保存按鈕 */}
                <AnimatePresence>
                  {isDirty && (
                    <motion.div
                      initial={{ opacity: 0, y: 6, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.96 }}
                      transition={{ duration: 0.16 }}
                      className="flex items-center gap-2 w-full pt-1.5 border-t border-white/10"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleReset}
                        disabled={isSaving}
                        className="flex-1 text-xs h-7.5 rounded-lg border-white/15 bg-white/5 hover:bg-white/10 text-slate-300"
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        重設
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex-1 text-xs h-7.5 rounded-lg bg-[#3C8527] hover:bg-[#469C2D] text-white font-semibold shadow-md shadow-[#3C8527]/30"
                      >
                        <Save className="h-3 w-3 mr-1" />
                        {isSaving ? "保存中..." : "保存變更"}
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* 3D 動作模式與視角運鏡控制面板 (緊湊佈局，shrink-0 確保永不遭擠壓) */}
            <div className="w-full space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-2.5 text-xs shrink-0">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-300">
                  動作模式 (Animation)
                </label>
                <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 border border-white/10">
                  {animButtons.map((btn) => {
                    const isActive = animation === btn.id;
                    return (
                      <button
                        key={btn.id}
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
                        {isActive && (
                          <motion.div
                            layoutId="skin-anim-indicator"
                            className="absolute inset-0 rounded-lg bg-[#3C8527] shadow-sm shadow-[#3C8527]/30"
                            transition={{
                              type: "spring",
                              stiffness: 450,
                              damping: 35,
                            }}
                          />
                        )}
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
                      自動旋轉視角
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
                      鞘翅 (Elytra) 模式
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
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleTabChange("wardrobe")}
                  className={`relative flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold transition-colors ${
                    activeTab === "wardrobe"
                      ? "text-[#52A43A]"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Shirt className="h-4 w-4" />
                  <span>皮膚櫃 ({localSkins.length + OFFICIAL_9_SKINS.length})</span>
                  {activeTab === "wardrobe" && (
                    <motion.div
                      layoutId="skin-tab-indicator"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#52A43A] shadow-[0_0_8px_rgba(82,164,58,0.8)]"
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 35,
                      }}
                    />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleTabChange("capes")}
                  className={`relative flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold transition-colors ${
                    activeTab === "capes"
                      ? "text-[#52A43A]"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Sparkles className="h-4 w-4" />
                  <span>披風櫃 ({accountCapes.length})</span>
                  {activeTab === "capes" && (
                    <motion.div
                      layoutId="skin-tab-indicator"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#52A43A] shadow-[0_0_8px_rgba(82,164,58,0.8)]"
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 35,
                      }}
                    />
                  )}
                </button>
              </div>

              {activeTab === "capes" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefreshCapes}
                  disabled={isRefreshingCapes}
                  className="h-8 px-2.5 text-xs text-slate-400 hover:text-white border border-white/10 hover:bg-white/5 rounded-lg mb-1"
                  title="重新整理微軟正版披風資產"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 mr-1.5 ${isRefreshingCapes ? "animate-spin text-[#52A43A]" : ""}`}
                  />
                  <span>{isRefreshingCapes ? "同步中..." : "重新整理"}</span>
                </Button>
              )}
            </div>

            {/* 右側滾動區域：柔和漸層遮罩，杜絕硬邊切割 */}
            <ScrollArea
              className="flex-1 min-h-0 [mask-image:linear-gradient(to_bottom,transparent,black_14px,black_calc(100%-14px),transparent)]"
              viewportClassName="py-4 pr-3"
            >
              <AnimatePresence custom={tabDirection} mode="wait">
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
                          自訂本機皮膚 (儲存於 %APPDATA%/skins/)
                        </h2>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {localSkins.length} 個檔案
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                        {/* 上傳卡片 */}
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          className="flex flex-col items-center justify-center p-4 rounded-xl border border-dashed border-white/15 bg-white/[0.02] hover:bg-white/[0.05] hover:border-[#52A43A]/50 transition-all cursor-pointer text-center space-y-1.5 group min-h-[120px]"
                        >
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-slate-400 group-hover:text-[#52A43A] group-hover:bg-[#3C8527]/20 transition-colors">
                            <Plus className="h-4 w-4" />
                          </div>
                          <span className="text-xs font-bold text-slate-200">
                            {isUploading ? "上傳中..." : "上傳新皮膚"}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            點選或拖曳 .png
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
                                    ? "border-[#52A43A] bg-[#3C8527]/15 shadow-md shadow-[#3C8527]/15"
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
                                      自訂皮膚
                                    </p>
                                    <p className="text-[10px] text-slate-500 mt-1">
                                      {Math.max(1, Math.round(skin.bytes.length / 1024))} KB
                                    </p>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={(e) => handleDeleteSkin(skin.filename, e)}
                                    className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors self-start"
                                    title="從皮膚櫃刪除"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>

                                <div className="flex items-center justify-between text-[10px] pt-2 border-t border-white/5">
                                  <Badge
                                    variant="outline"
                                    className={`text-[9px] py-0 px-1.5 ${
                                      isSelected
                                        ? "border-[#52A43A] text-[#52A43A]"
                                        : "border-white/10 text-slate-400"
                                    }`}
                                  >
                                    {isSelected ? "預覽中" : "可切換"}
                                  </Badge>
                                  {isSelected && (
                                    <Check className="h-3.5 w-3.5 text-[#52A43A]" />
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
                          官方預設角色外觀 (9 款)
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
                                  ? "border-[#52A43A] bg-[#3C8527]/15 shadow-md shadow-[#3C8527]/15"
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
                                    alt={defSkin.name}
                                  />
                                </div>

                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-bold text-white">
                                    {defSkin.name}
                                  </p>
                                  <p className="truncate text-[10px] text-slate-400 mt-0.5">
                                    {defSkin.desc}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center justify-between text-[10px] pt-2 border-t border-white/5">
                                <Badge
                                  variant="outline"
                                  className={`text-[9px] py-0 px-1.5 ${
                                    isSelected
                                      ? "border-[#52A43A] text-[#52A43A]"
                                      : "border-white/10 text-slate-400"
                                  }`}
                                >
                                  {isSelected ? "預覽中" : defSkin.model.toUpperCase()}
                                </Badge>
                                {isSelected && (
                                  <Check className="h-3.5 w-3.5 text-[#52A43A]" />
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
                          已持有官方披風 (微軟正版授權共 {accountCapes.length} 件)
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
                                ? "border-[#52A43A] bg-[#3C8527]/15 shadow-md shadow-[#3C8527]/15"
                                : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-black/40 border border-white/10 flex items-center justify-center">
                                <SkinThumbnail
                                  skinUrl={previewSkinUrl}
                                  model={previewModel}
                                  rotationY={Math.PI}
                                  alt="不裝備披風"
                                />
                              </div>

                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-bold text-white">
                                  不裝備披風
                                </p>
                                <p className="text-[10px] text-slate-400 mt-0.5">
                                  卸除背部披風與鞘翅
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-[10px] pt-2 border-t border-white/5">
                              <span className="text-[9px] text-slate-500 font-mono">
                                UNEQUIPPED
                              </span>
                              {!previewCapeUrl && (
                                <Check className="h-3.5 w-3.5 text-[#52A43A]" />
                              )}
                            </div>
                          </div>

                          {/* 正版微軟帳號持有的真實披風清單 (全量接入 Shadcn UI Tooltip) */}
                          {accountCapes.map((cape) => {
                            const isSelected = previewCapeUrl === cape.url;
                            const capeName = cape.alias || `官方披風 (${cape.id.slice(0, 8)})`;
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
                                        ? "border-[#52A43A] bg-[#3C8527]/15 shadow-md shadow-[#3C8527]/15"
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
                                          狀態：{cape.state === "ACTIVE" ? "Mojang 預設裝備" : "正版授權持有"}
                                        </p>
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between text-[10px] pt-2 border-t border-white/5">
                                      <span className="text-[9px] text-[#52A43A] font-mono font-semibold">
                                        OFFICIAL OWNED
                                      </span>
                                      {isSelected && (
                                        <Check className="h-3.5 w-3.5 text-[#52A43A]" />
                                      )}
                                    </div>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <div className="space-y-1.5">
                                    <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1">
                                      <span className="font-bold text-white text-xs">
                                        {matchedKnown ? matchedKnown.name : capeName}
                                      </span>
                                      {matchedKnown && (
                                        <span className="text-[10px] text-slate-400 font-mono">
                                          {matchedKnown.releaseYear}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-slate-300">
                                      {matchedKnown
                                        ? matchedKnown.obtainDetails
                                        : "此披風由您登入的微軟正版帳號官方授權持有，點擊可立即裝備並同步至雲端。"}
                                    </p>
                                    <div className="flex items-center gap-1.5 pt-1 text-[10px] text-[#52A43A] font-medium">
                                      <Check className="h-3 w-3" />
                                      <span>微軟雲端正版資產認證</span>
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
                                    微軟授權憑證需要更新（查無 Token 或憑證已過期）
                                  </p>
                                  <p className="text-[11px] text-slate-400 max-w-md mx-auto leading-relaxed">
                                    本機未快取微軟安全憑證，系統已自動從公開伺服器載入您的皮膚與 Slim 模型。若要同步您在官方持有的完整披風資產，請點擊下方按鈕進行快速授權登入。
                                  </p>
                                  {onOpenLoginModal && (
                                    <div className="pt-2">
                                      <Button
                                        type="button"
                                        onClick={onOpenLoginModal}
                                        className="h-8 px-4 text-xs bg-[#3C8527] hover:bg-[#469C2D] text-white font-semibold rounded-lg shadow-md shadow-[#3C8527]/30"
                                      >
                                        立即登入微軟以同步披風
                                      </Button>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <>
                                  <p className="text-xs font-bold text-slate-300">
                                    此帳號目前尚未持有任何官方披風
                                  </p>
                                  <p className="text-[11px] text-slate-500 max-w-md mx-auto leading-relaxed">
                                    微軟 Mojang 伺服器回傳此帳號未持有官方披風。當您在官網獲得或兌換官方披風後，點擊右上角「重新整理」即可自動同步。
                                  </p>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 第二區：未持有官方圖鑑 (全量 21 款歷史披風對照展示，重新整理時暫時隱藏直到同步完成) */}
                    {!isRefreshingCapes && (
                      <div className="space-y-3 pt-4 border-t border-white/10">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Lock className="h-3.5 w-3.5 text-amber-400/80" />
                            <h2 className="text-xs font-bold text-slate-300">
                              未持有官方圖鑑 (未解鎖 {unownedKnownCapes.length} 款)
                            </h2>
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono">
                            MINECRAFT WIKI CATALOG
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          依據 Minecraft Wiki 官方披風專題完整收錄之歷代大典、MINECON、社群貢獻與員工限定披風。卡片為圖鑑展示模式，懸停可檢視完整活動典故與獲取歷史。
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                          {unownedKnownCapes.map((kc) => {
                            const isUnobtainable = kc.status === "unobtainable";
                            const isRestricted = kc.status === "restricted";

                            return (
                              <Tooltip key={kc.id}>
                                <TooltipTrigger asChild>
                                  <div
                                    className="group relative flex flex-col justify-between p-3.5 rounded-xl border border-white/5 bg-white/[0.015] hover:bg-white/[0.035] opacity-85 hover:opacity-100 transition-all cursor-default select-none min-h-[120px] w-full"
                                  >
                                    <div className="flex items-center gap-3">
                                      {/* 單例快照縮圖 */}
                                      <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-black/40 border border-white/10 flex items-center justify-center">
                                        <SkinThumbnail
                                          skinUrl={previewSkinUrl}
                                          capeUrl={kc.url}
                                          model={previewModel}
                                          backEquipment={backEquipment}
                                          rotationY={Math.PI}
                                          alt={kc.name}
                                        />
                                        <div className="absolute top-1 right-1 p-0.5 rounded bg-black/60 text-slate-400 border border-white/10">
                                          <Lock className="h-2.5 w-2.5" />
                                        </div>
                                      </div>

                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                          <p className="truncate text-xs font-bold text-slate-200 group-hover:text-white">
                                            {kc.name}
                                          </p>
                                        </div>
                                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                                          {kc.releaseYear}・{kc.enName}
                                        </p>
                                        <p className="text-[10px] text-slate-400 mt-1 line-clamp-2">
                                          {kc.description}
                                        </p>
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between text-[10px] pt-2 border-t border-white/5">
                                      <Badge
                                        variant="outline"
                                        className={`text-[9px] py-0 px-1.5 font-mono ${
                                          isUnobtainable
                                            ? "border-rose-500/30 text-rose-400/90 bg-rose-500/5"
                                            : isRestricted
                                            ? "border-indigo-500/30 text-indigo-400/90 bg-indigo-500/5"
                                            : "border-white/10 text-slate-400 bg-white/5"
                                        }`}
                                      >
                                        {isUnobtainable
                                          ? "已絕版 (UNOBTAINABLE)"
                                          : isRestricted
                                          ? "特殊專屬 (RESTRICTED)"
                                          : "未持有 (LOCKED)"}
                                      </Badge>
                                      <span className="text-[9px] text-slate-500 font-mono">
                                        CATALOG ONLY
                                      </span>
                                    </div>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <div className="space-y-1.5">
                                    <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1">
                                      <div>
                                        <div className="font-bold text-white text-xs">{kc.name}</div>
                                        <div className="text-[10px] text-slate-400 font-mono">{kc.enName}</div>
                                      </div>
                                      <Badge
                                        variant="outline"
                                        className="text-[9px] py-0 px-1.5 border-white/15 text-slate-300 font-mono"
                                      >
                                        {kc.releaseYear}
                                      </Badge>
                                    </div>

                                    <div className="text-[11px] text-slate-300 leading-relaxed">
                                      {kc.obtainDetails}
                                    </div>

                                    <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[10px]">
                                      <span className="text-slate-500">官方獲取狀態</span>
                                      <span
                                        className={`font-semibold ${
                                          isUnobtainable
                                            ? "text-rose-400"
                                            : isRestricted
                                            ? "text-indigo-400"
                                            : "text-slate-400"
                                        }`}
                                      >
                                        {isUnobtainable
                                          ? "已截止・現已不可獲取"
                                          : isRestricted
                                          ? "特定內部資格限定"
                                          : "暫未持有"}
                                      </span>
                                    </div>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </div>
                      </div>
                    )}
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
