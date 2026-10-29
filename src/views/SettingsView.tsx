import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import {
  DownloadCloud,
  Coffee,
  Volume2,
  ShieldCheck,
  Info,
  Key,
  AlertTriangle,
  Eye,
  EyeOff,
  Check,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { settingsService } from "@/services/settingsService";

export const SettingsView: React.FC = () => {
  const [enableBmclapi, setEnableBmclapi] = useState<boolean>(false);
  const [curseforgeApiKey, setCurseforgeApiKey] = useState<string>("");
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [isApiKeySaved, setIsApiKeySaved] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    settingsService
      .getSettings()
      .then((cfg) => {
        setEnableBmclapi(cfg.enableBmclapiMirror);
        setCurseforgeApiKey(cfg.curseforgeApiKey || "");
        setSoundEnabled(cfg.soundEnabled);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load settings:", err);
        setIsLoading(false);
      });
  }, []);

  const handleToggleBmclapi = async (checked: boolean) => {
    setEnableBmclapi(checked);
    try {
      await settingsService.updateSettings({ enableBmclapiMirror: checked });
    } catch (err) {
      console.error("Failed to update mirror setting:", err);
    }
  };

  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await settingsService.updateSettings({ curseforgeApiKey: curseforgeApiKey.trim() || null });
      setIsApiKeySaved(true);
      setTimeout(() => setIsApiKeySaved(false), 2000);
    } catch (err) {
      console.error("Failed to save CurseForge API Key:", err);
    }
  };

  const handleToggleSound = async (checked: boolean) => {
    setSoundEnabled(checked);
    try {
      await settingsService.updateSettings({ soundEnabled: checked });
    } catch (err) {
      console.error("Failed to update sound setting:", err);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      className="space-y-6 max-w-4xl pb-10 select-none"
    >
      {/* 1. 隱私優先下載管線與第三方鏡像加速 */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <div className="flex items-center gap-2">
            <DownloadCloud className="h-4 w-4 text-[#52A43A]" />
            <CardTitle className="text-base">下載引擎與隱私優先合約</CardTitle>
          </div>
          <CardDescription className="text-xs">
            核心採用 Tokio 多執行緒分塊並發下載引擎與串流 SHA-1 即時校驗，預設純官方直連。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-black/20 border border-white/5">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-xs text-slate-100">
                  第三方鏡像加速 (BMCLAPI)
                </span>
                <Badge
                  variant={enableBmclapi ? "outline" : "success"}
                  className={`text-[10px] py-0 px-2 ${enableBmclapi ? "border-amber-500/50 text-amber-400 bg-amber-500/10" : ""}`}
                >
                  {enableBmclapi ? "已啟用第三方鏡像" : "官方直連 (隱私優先)"}
                </Badge>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed max-w-xl">
                啟用後將遊戲核心、函式庫與資源下載轉發至 BMCLAPI 開源中繼節點以加速下載。
              </p>
              {enableBmclapi && (
                <div className="flex items-center gap-1.5 text-[11px] text-amber-400/90 pt-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    提醒：此選項會將下載流量轉發至第三方伺服器，可能面臨檔案快取延遲或流量記錄風險。
                  </span>
                </div>
              )}
            </div>
            <Switch
              checked={enableBmclapi}
              onCheckedChange={handleToggleBmclapi}
              disabled={isLoading}
            />
          </div>
        </CardContent>
      </Card>

      {/* 2. 外部整合 (CurseForge API Key) */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-[#52A43A]" />
            <CardTitle className="text-base">外部整合 (External Integrations)</CardTitle>
          </div>
          <CardDescription className="text-xs">
            設定第三方平台 API 金鑰以自動化下載模組包中受保護的模組檔案。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSaveApiKey} className="space-y-2">
            <label className="text-xs font-semibold text-slate-300">
              CurseForge API Key (用於自動補齊受保護模組)
            </label>
            <div className="flex items-center gap-2 max-w-xl">
              <div className="relative flex-1">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={curseforgeApiKey}
                  onChange={(e) => setCurseforgeApiKey(e.target.value)}
                  placeholder="輸入 CurseForge Eternal API Key ($2a$10$...)"
                  className="pr-10 bg-black/30 border-white/10 text-xs font-mono h-9"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {showApiKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <Button
                type="submit"
                size="sm"
                className="bg-[#3C8527] hover:bg-[#52A43A] text-white text-xs font-semibold h-9 px-4"
              >
                {isApiKeySaved ? (
                  <span className="flex items-center gap-1">
                    <Check className="h-3.5 w-3.5" /> 已儲存
                  </span>
                ) : (
                  "儲存金鑰"
                )}
              </Button>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
              若未配置金鑰，當導入包含禁止第三方分發之模組包時，啟動器將彈出清單導引瀏覽器開啟下載頁面手動補齊。金鑰將安全持久化保存於本機 settings.json。
            </p>
          </form>
        </CardContent>
      </Card>

      {/* 3. Java 執行階段預設 */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Coffee className="h-4 w-4 text-amber-400" />
            <CardTitle className="text-base">Java 預設執行環境</CardTitle>
          </div>
          <CardDescription className="text-xs">
            由 Mojang 官方 Manifest 依遊戲版本（Java 8 / 17 / 21）自動指派或下載。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-xs p-3 rounded-xl bg-black/20 border border-white/5">
            <span className="text-slate-300">Java 自動匹配機制</span>
            <Badge variant="success">已啟用自動探測</Badge>
          </div>
        </CardContent>
      </Card>

      {/* 4. 音效與動態微動態 */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-[#52A43A]" />
            <CardTitle className="text-base">音效與動態回饋</CardTitle>
          </div>
          <CardDescription className="text-xs">
            提供可自訂之低延遲 Web Audio 點擊音效與流暢物理彈簧動畫。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-xs p-3 rounded-xl bg-black/20 border border-white/5">
            <div>
              <span className="font-medium text-slate-200">按鈕操作音效回饋</span>
              <p className="text-[11px] text-muted-foreground">點擊按鈕與啟動成功時播放提示音效</p>
            </div>
            <Switch
              checked={soundEnabled}
              onCheckedChange={handleToggleSound}
            />
          </div>
        </CardContent>
      </Card>

      {/* 5. 啟動器版本資訊與開源 Clean-Room 聲明 */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <CardTitle className="text-base">授權協議與版本資訊</CardTitle>
            </div>
            <Badge variant="success" className="font-mono">
              v26.1.0
            </Badge>
          </div>
          <CardDescription className="text-xs leading-relaxed text-slate-400 pt-1">
            Focusite Launcher 依據官方開放規格由 Rust 獨立編寫乾淨室 (Clean-Room) 核心，採 MIT / Apache-2.0 雙授權，無 GPL 傳染風險。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-xs text-slate-400 pt-1">
            <Info className="h-3.5 w-3.5 text-[#52A43A]" />
            <span>目前運行版本：<strong className="text-slate-200 font-mono">Focusite 26.1.0</strong> (Production Release)</span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};
