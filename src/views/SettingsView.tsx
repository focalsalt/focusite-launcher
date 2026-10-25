import React, { useState } from "react";
import { motion } from "motion/react";
import {
  DownloadCloud,
  Coffee,
  Volume2,
  ShieldCheck,
  Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

export const SettingsView: React.FC = () => {
  const [downloadMirror, setDownloadMirror] = useState<string>("official_first");
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      className="space-y-6 max-w-4xl pb-10"
    >
      {/* 1. 下載管線與鏡像設定 */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <div className="flex items-center gap-2">
            <DownloadCloud className="h-4 w-4 text-[#52A43A]" />
            <CardTitle className="text-base">下載引擎與鏡像加速源</CardTitle>
          </div>
          <CardDescription className="text-xs">
            採用 Tokio 多執行緒分塊並發下載引擎與串流 SHA-1 即時校驗。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-300">下載源優先策略</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label
                onClick={() => setDownloadMirror("official_first")}
                className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-all ${
                  downloadMirror === "official_first"
                    ? "border-[#52A43A]/50 bg-[#3C8527]/15"
                    : "border-white/10 bg-black/20 hover:bg-white/5"
                }`}
              >
                <input
                  type="radio"
                  name="mirror"
                  checked={downloadMirror === "official_first"}
                  onChange={() => setDownloadMirror("official_first")}
                  className="mt-0.5 accent-[#3C8527]"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-100">Mojang 官方直連優先 (推薦)</span>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    連線逾時 3 秒自動平滑轉移至 BMCLAPI 鏡像節點。
                  </p>
                </div>
              </label>

              <label
                onClick={() => setDownloadMirror("bmclapi")}
                className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-all ${
                  downloadMirror === "bmclapi"
                    ? "border-[#52A43A]/50 bg-[#3C8527]/15"
                    : "border-white/10 bg-black/20 hover:bg-white/5"
                }`}
              >
                <input
                  type="radio"
                  name="mirror"
                  checked={downloadMirror === "bmclapi"}
                  onChange={() => setDownloadMirror("bmclapi")}
                  className="mt-0.5 accent-[#3C8527]"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-100">BMCLAPI 鏡像專線</span>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    針對特定網路環境最佳化的高速下載中繼源。
                  </p>
                </div>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. Java 執行階段預設 */}
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

      {/* 3. 音效與動態微動態 (PCL 風格) */}
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
            {/* Shadcn Switch 元件 */}
            <Switch
              checked={soundEnabled}
              onCheckedChange={setSoundEnabled}
            />
          </div>
        </CardContent>
      </Card>

      {/* 4. 啟動器版本資訊與開源 Clean-Room 聲明 */}
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
