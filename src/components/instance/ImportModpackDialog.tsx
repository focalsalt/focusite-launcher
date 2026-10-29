import React, { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FolderDown,
  RefreshCw,
  ExternalLink,
  FolderOpen,
  CheckCircle2,
  AlertTriangle,
  FileArchive,
} from "lucide-react";
import { modpackService, MissingModItem, ModpackImportResult } from "@/services/modpackService";
import { instanceService } from "@/services/instanceService";

interface ImportModpackDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (instanceId: string) => void;
}

export const ImportModpackDialog: React.FC<ImportModpackDialogProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const [packFilePath, setPackFilePath] = useState<string>("");
  const [customName, setCustomName] = useState<string>("");
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 待補齊狀態
  const [importResult, setImportResult] = useState<ModpackImportResult | null>(null);
  const [missingMods, setMissingMods] = useState<MissingModItem[]>([]);
  const [isRescanning, setIsRescanning] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // In web environment, file.name is accessible; if Tauri path is injected via drag/drop or input:
    // With web input, file doesn't have absolute path in sandboxed browser, but in Tauri drag/drop or typing path:
    const path = (file as unknown as { path?: string }).path || file.name;
    setPackFilePath(path);
    if (!customName) {
      const baseName = file.name.replace(/\.(mrpack|zip)$/i, "");
      setCustomName(baseName);
    }
    setErrorMsg(null);
  };

  const handleStartImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!packFilePath.trim()) {
      setErrorMsg("請輸入或選取模組包檔案路徑 (.mrpack 或 .zip)");
      return;
    }

    setIsImporting(true);
    setErrorMsg(null);
    try {
      const res = await modpackService.importModpack(
        packFilePath.trim(),
        customName.trim() || undefined
      );

      setImportResult(res);
      setMissingMods(res.missingMods);

      if (res.isCompleted) {
        setIsImporting(false);
        onClose();
        onImportSuccess(res.instanceId);
      } else {
        // CurseForge missing mods mode
        setIsImporting(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setIsImporting(false);
    }
  };

  const handleOpenAllPages = async () => {
    const urls = missingMods.map((m) => m.webUrl).filter(Boolean);
    if (urls.length > 0) {
      await modpackService.openExternalUrls(urls);
    }
  };

  const handleOpenModsFolder = async () => {
    if (!importResult) return;
    await instanceService.openInstanceDirectory(importResult.instanceId, "mods");
  };

  const handleRescan = async () => {
    if (!importResult) return;
    setIsRescanning(true);
    try {
      const remaining = await modpackService.rescanMissingMods(
        importResult.instanceId,
        missingMods
      );
      setMissingMods(remaining);
    } catch (err) {
      console.error("Rescan failed:", err);
    } finally {
      setIsRescanning(false);
    }
  };

  const handleFinish = () => {
    if (!importResult || missingMods.length > 0) return;
    onClose();
    onImportSuccess(importResult.instanceId);
  };

  const resetAll = () => {
    setPackFilePath("");
    setCustomName("");
    setErrorMsg(null);
    setImportResult(null);
    setMissingMods([]);
    onClose();
  };

  // 待補齊清單 Modal 視圖
  if (importResult && !importResult.isCompleted) {
    const isReady = missingMods.length === 0;

    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && resetAll()}>
        <DialogContent onClose={resetAll} className="max-w-2xl border-white/10 bg-slate-950/95 text-slate-100 backdrop-blur-xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
              <DialogTitle className="text-base font-bold text-white">
                待補齊 CurseForge 受保護模組清單
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-400 leading-relaxed pt-1">
              模組作者設定禁止由未授權第三方自動下載，或尚未在設定頁配置官方 CurseForge API Key。
              請將下載的 .jar 檔案放入實例 mods 資料夾後點擊「重新掃描」。
            </DialogDescription>
          </DialogHeader>

          {/* 狀態資訊橫幅 */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/5 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">實例名稱：</span>
              <span className="font-semibold text-white">{importResult.instanceName}</span>
              <Badge variant="outline" className="text-[10px] font-mono border-white/10">
                {importResult.loader} {importResult.version}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">剩餘缺失項目：</span>
              <Badge
                variant={isReady ? "success" : "outline"}
                className={`text-[10px] font-mono font-bold ${
                  !isReady ? "border-amber-500/50 text-amber-400 bg-amber-500/10" : ""
                }`}
              >
                {missingMods.length} 項
              </Badge>
            </div>
          </div>

          {/* 條列缺失項目（嚴格不放單項按鈕） */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-300">缺失模組清單：</span>
            <div className="h-64 rounded-xl border border-white/10 bg-black/30 overflow-hidden">
              <ScrollArea className="h-full w-full" viewportClassName="p-3">
                {missingMods.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center space-y-2">
                    <CheckCircle2 className="h-8 w-8 text-[#52A43A]" />
                    <p className="text-sm font-semibold text-white">所有缺失模組已全數補齊！</p>
                    <p className="text-xs text-slate-400">點擊下方按鈕以完成實例建立。</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {missingMods.map((mod, idx) => (
                      <div
                        key={`${mod.projectId}-${mod.fileId}`}
                        className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-200">
                              {idx + 1}. {mod.name}
                            </span>
                            <Badge variant="outline" className="text-[9px] font-mono text-slate-400">
                              ID: {mod.projectId}
                            </Badge>
                          </div>
                          <p className="text-[11px] font-mono text-slate-400">
                            目標檔名：{mod.fileName}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400 bg-amber-950/20">
                          待手動放入
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>

          {/* 底部按鈕區：嚴格合約提供「一鍵開啟全部頁面」、「開啟實例 mods 資料夾」與「重新掃描」，「完成建立實例」按鈕強制保持禁用 */}
          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleOpenAllPages}
                disabled={isReady}
                className="gap-1.5 text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
              >
                <ExternalLink className="h-3.5 w-3.5 text-[#52A43A]" />
                一鍵開啟全部頁面
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleOpenModsFolder}
                className="gap-1.5 text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
              >
                <FolderOpen className="h-3.5 w-3.5 text-[#52A43A]" />
                開啟實例 mods 資料夾
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRescan}
                disabled={isRescanning}
                className="gap-1.5 text-xs h-8 border-white/10"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRescanning ? "animate-spin text-[#52A43A]" : ""}`} />
                重新掃描
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!isReady}
                onClick={handleFinish}
                className="bg-[#3C8527] hover:bg-[#52A43A] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold h-8 px-4"
              >
                完成建立實例
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // 原始導入選擇檔案視圖
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && resetAll()}>
      <DialogContent onClose={resetAll} className="max-w-md border-white/10 bg-slate-950/95 text-slate-100 backdrop-blur-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <FolderDown className="h-5 w-5 text-[#52A43A]" />
            <DialogTitle className="text-base font-bold text-white">
              導入模組包 (Import Modpack)
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-slate-400 pt-1">
            支援 Modrinth (.mrpack) 與 CurseForge (.zip) 格式。將自動解析依賴 Loader、設定 overrides 並補齊模組。
          </DialogDescription>
        </DialogHeader>

        {errorMsg && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-400">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleStartImport} className="space-y-4 pt-1">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChosen}
            accept=".mrpack,.zip"
            className="hidden"
          />

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">
              模組包檔案路徑 (.mrpack / .zip) *
            </label>
            <div className="flex items-center gap-2">
              <Input
                value={packFilePath}
                onChange={(e) => setPackFilePath(e.target.value)}
                placeholder="例如：C:\Downloads\BetterMC.mrpack"
                className="bg-black/30 border-white/10 text-xs font-mono h-9 flex-1"
                required
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs h-9 border-white/10 bg-white/5 hover:bg-white/10 shrink-0"
              >
                瀏覽...
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">
              自訂實例名稱 (可選)
            </label>
            <Input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="留空將採用模組包原始名稱"
              className="bg-black/30 border-white/10 text-xs h-9"
            />
          </div>

          <div className="rounded-xl border border-white/5 bg-black/20 p-3 text-[11px] text-slate-400 space-y-1 leading-relaxed">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
              <FileArchive className="h-3.5 w-3.5 text-[#52A43A]" />
              <span>自動格式辨識引擎</span>
            </div>
            <p>
              • <strong className="text-slate-200">.mrpack</strong>：由 Modrinth 官方 CDN 透過 SHA-1 與 CAS 快取直接補齊。
            </p>
            <p>
              • <strong className="text-slate-200">.zip</strong>：若未設置 CurseForge Key 或受作者版權限制，將啟動缺失導引彈窗。
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetAll}
              className="text-xs"
            >
              取消
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isImporting}
              className="bg-[#3C8527] hover:bg-[#52A43A] text-white text-xs font-semibold h-8 px-4"
            >
              {isImporting ? (
                <span className="flex items-center gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  正在導入與解壓...
                </span>
              ) : (
                "開始導入"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
