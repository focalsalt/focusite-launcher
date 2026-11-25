import { useState } from "react";
import { useI18n } from "@/i18n";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { workshopService, InstallPlan, InstallPlanItem } from "@/services/workshopService";

/** Resolves the dependencies of the selected projects, then installs the confirmed plan. */
export function useInstallPlan(
  instanceId: string,
  projectType: "mod" | "resourcepack" | "shader",
  selected: Map<string, { versionId: string }>,
  onInstalled: () => void
) {
  const { t } = useI18n();
  const [planDialogOpen, setPlanDialogOpen] = useState<boolean>(false);
  const [installPlan, setInstallPlan] = useState<InstallPlan | null>(null);
  const [isResolvingPlan, setIsResolvingPlan] = useState<boolean>(false);
  const [isInstalling, setIsInstalling] = useState<boolean>(false);

  const openPlanDialog = async () => {
    if (selected.size === 0 || !instanceId) return;
    setIsResolvingPlan(true);
    try {
      const pairs: [string, string][] = [...selected.entries()].map(([pid, e]) => [pid, e.versionId]);
      setInstallPlan(await workshopService.resolveInstallPlan(instanceId, pairs));
      setPlanDialogOpen(true);
    } catch (err) {
      toast(t.errors.resolveFailed(toUserMessage(err)), "error");
    } finally {
      setIsResolvingPlan(false);
    }
  };

  const executeInstall = async (finalItems: InstallPlanItem[]) => {
    if (!instanceId) return;
    setIsInstalling(true);
    try {
      const count = await workshopService.executeInstallPlan(instanceId, projectType, finalItems);
      setPlanDialogOpen(false);
      onInstalled();
      toast(t.workshopWin.installedCount(count), "success");
    } catch (err) {
      toast(t.errors.installFailed(toUserMessage(err)), "error");
    } finally {
      setIsInstalling(false);
    }
  };

  return {
    planDialogOpen,
    setPlanDialogOpen,
    installPlan,
    isResolvingPlan,
    isInstalling,
    openPlanDialog,
    executeInstall,
  };
}
