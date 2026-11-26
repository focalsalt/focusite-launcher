import React, { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { localizeBackendText } from "@/lib/errorMessage";
import {
  AlertTriangle,
  Download,
  CheckCircle2,
  Package,
  Layers,
  ArrowRight,
  HardDrive,
} from "lucide-react";
import { InstallPlan, InstallPlanItem } from "@/services/workshopService";
import { useI18n } from "@/i18n";

interface InstallPlanConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: InstallPlan | null;
  onConfirm: (finalItemsToDownload: InstallPlanItem[]) => Promise<void>;
  isInstalling: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export const InstallPlanConfirmDialog: React.FC<InstallPlanConfirmDialogProps> = ({
  open,
  onOpenChange,
  plan: planProp,
  onConfirm,
  isInstalling,
}) => {
  const { t } = useI18n();
  const [selectedOptionalIds, setSelectedOptionalIds] = useState<Set<string>>(
    () => new Set()
  );
  // Keep the last non-null plan so the exit animation still has content after the parent clears it.
  const lastPlanRef = useRef<InstallPlan | null>(planProp);
  if (planProp) lastPlanRef.current = planProp;
  const plan = lastPlanRef.current;

  if (!plan) return null;

  const toggleOptional = (versionId: string) => {
    const next = new Set(selectedOptionalIds);
    if (next.has(versionId)) {
      next.delete(versionId);
    } else {
      next.add(versionId);
    }
    setSelectedOptionalIds(next);
  };

  const handleConfirm = async () => {
    // 匯總待下載清單：未安裝的核心項目 + 未安裝的必要依賴 + 使用者勾選的未安裝可選依賴
    const items: InstallPlanItem[] = [];

    for (const item of plan.primary_items) {
      if (!item.already_installed) items.push(item);
    }
    for (const dep of plan.required_dependencies) {
      if (!dep.already_installed) items.push(dep);
    }
    for (const opt of plan.optional_dependencies) {
      if (selectedOptionalIds.has(opt.version_id) && !opt.already_installed) {
        items.push(opt);
      }
    }

    await onConfirm(items);
  };

  const calculateTotalDownloadSize = () => {
    let size = 0;
    for (const item of plan.primary_items) {
      if (!item.already_installed) size += item.size;
    }
    for (const dep of plan.required_dependencies) {
      if (!dep.already_installed) size += dep.size;
    }
    for (const opt of plan.optional_dependencies) {
      if (selectedOptionalIds.has(opt.version_id) && !opt.already_installed) {
        size += opt.size;
      }
    }
    return size;
  };

  const totalSize = calculateTotalDownloadSize();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-6 bg-slate-900 border-white/10 text-white rounded-xl shadow-2xl">
        <DialogHeader className="mb-3">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-brand-light" />
            <DialogTitle className="text-lg font-semibold tracking-wide">
              {t.installPlan.title}
            </DialogTitle>
          </div>
          <p className="text-xs text-white/50">
            {t.installPlan.desc}
          </p>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-3 -mr-3 max-h-[50vh]">
          <div className="space-y-4">
            {/* 衝突警告區塊 */}
            {plan.conflict_warnings.length > 0 && (
              <div className="rounded-lg bg-warning-500/10 border border-warning-500/30 p-3 space-y-1">
                <div className="flex items-center gap-2 text-warning-400 text-xs font-semibold">
                  <AlertTriangle className="w-4 h-4" />
                  <span>{t.installPlan.conflicts}</span>
                </div>
                {plan.conflict_warnings.map((w, i) => (
                  <p key={i} className="text-xs text-warning-200/80 leading-relaxed pl-6">
                    • {localizeBackendText(w)}
                  </p>
                ))}
              </div>
            )}

            {/* 主要安裝項目 */}
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-white/60 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-brand-light" />
                {t.installPlan.primaryItems(plan.primary_items.length)}
              </h3>
              <div className="space-y-1.5">
                {plan.primary_items.map((item) => (
                  <div
                    key={item.version_id}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.03] border border-white/5 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-white truncate max-w-xs">
                        {item.name || item.filename}
                      </span>
                      <span className="text-xs text-white/40 font-mono truncate max-w-[150px]">
                        {item.filename}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.already_installed ? (
                        <Badge variant="outline" className="border-success-500/40 text-success-400 text-3xs">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> {t.installPlan.exists}
                        </Badge>
                      ) : (
                        <span className="text-xs font-mono text-white/50">
                          {formatBytes(item.size)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 必要相依項目 */}
            {plan.required_dependencies.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-white/60 uppercase tracking-wider flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5 text-brand-light" />
                  {t.installPlan.requiredDeps(plan.required_dependencies.length)}
                </h3>
                <div className="space-y-1.5">
                  {plan.required_dependencies.map((dep) => (
                    <div
                      key={dep.version_id}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-brand/[0.06] border border-brand/20 text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ArrowRight className="w-3.5 h-3.5 text-brand-light/70 shrink-0" />
                        <span className="text-white/90 truncate font-medium max-w-xs">
                          {dep.name || dep.filename}
                        </span>
                        <span className="text-xs text-white/40 font-mono truncate max-w-[150px]">
                          {dep.filename}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {dep.already_installed ? (
                          <Badge variant="outline" className="border-success-500/40 text-success-400 text-3xs">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> {t.installPlan.existsNoDownload}
                          </Badge>
                        ) : (
                          <span className="text-xs font-mono text-success-300/80">
                            {formatBytes(dep.size)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 可選推薦相依項目 */}
            {plan.optional_dependencies.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-white/60 uppercase tracking-wider flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-purple-400" />
                  {t.installPlan.optionalDeps}
                </h3>
                <div className="space-y-1.5">
                  {plan.optional_dependencies.map((opt) => {
                    const isChecked = selectedOptionalIds.has(opt.version_id);
                    return (
                      <div
                        key={opt.version_id}
                        onClick={() => !opt.already_installed && toggleOptional(opt.version_id)}
                        className={`flex items-center justify-between p-2.5 rounded-lg border text-sm cursor-pointer transition-colors ${
                          opt.already_installed
                            ? "bg-white/[0.02] border-white/5 opacity-60 cursor-default"
                            : isChecked
                            ? "bg-purple-500/10 border-purple-500/30"
                            : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Checkbox
                            checked={opt.already_installed || isChecked}
                            disabled={opt.already_installed}
                            onCheckedChange={() => toggleOptional(opt.version_id)}
                          />
                          <span className="text-white/90 truncate max-w-xs font-medium">
                            {opt.name || opt.filename}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {opt.already_installed ? (
                            <Badge variant="outline" className="border-success-500/40 text-success-400 text-3xs">
                              {t.workshop.installed}
                            </Badge>
                          ) : (
                            <span className="text-xs font-mono text-purple-300/80">
                              {formatBytes(opt.size)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-white/60">
            <span>{t.installPlan.estimatedSize}</span>
            <span className="font-mono font-semibold text-brand-light">
              {formatBytes(totalSize)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isInstalling}
              className="border-white/10 hover:bg-white/5"
            >
              {t.common.cancel}
            </Button>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={isInstalling}
              className="bg-brand hover:bg-brand-light text-white font-medium"
            >
              {isInstalling ? t.workshop.installing : t.installPlan.confirmDownload}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
