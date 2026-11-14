import { useEffect, useState } from "react";
import {
  workshopService,
  WorkshopProjectDetail,
  WorkshopVersionItem,
} from "@/services/workshopService";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { useI18n } from "@/i18n";

/**
 * Loads a project's page and version list. The default pick is `preferredVersionId` when still
 * listed, otherwise the newest release (or the newest version of any type).
 */
export function useProjectDetail(
  projectId: string | undefined,
  gameVersion?: string,
  loader?: string,
  preferredVersionId?: string,
  /** Keep only versions that satisfy this predicate (e.g. modpacks need a .mrpack). */
  accept?: (v: WorkshopVersionItem) => boolean,
  /** Prefer versions that list this game version when picking the default. */
  compatVersion?: string,
) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<WorkshopProjectDetail | null>(null);
  const [versions, setVersions] = useState<WorkshopVersionItem[]>([]);
  const [versionId, setVersionId] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // A different project must not show the previous one's page while loading.
  useEffect(() => {
    setDetail(null);
    setVersions([]);
    setVersionId("");
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setIsLoading(true);
    // Settled separately: a failed project page must not hide a good version list, and vice versa.
    Promise.allSettled([
      workshopService.getProject(projectId),
      workshopService.listVersions(projectId, gameVersion || undefined, loader),
    ])
      .then(([page, list]) => {
        if (!alive) return;
        if (page.status === "fulfilled") setDetail(page.value);
        else toast(t.workshopWin.detailFailed(toUserMessage(page.reason)), "error");

        if (list.status === "fulfilled") {
          const v = accept ? list.value.filter(accept) : list.value;
          setVersions(v);
          const newest = (items: WorkshopVersionItem[]) =>
            items.find((x) => x.version_type === "release") ?? items[0];
          const fitting = compatVersion ? v.filter((x) => x.game_versions.includes(compatVersion)) : [];
          setVersionId(
            (preferredVersionId && v.find((x) => x.id === preferredVersionId)?.id) ||
              newest(fitting)?.id ||
              newest(v)?.id ||
              "",
          );
        } else {
          toast(t.workshopWin.versionsFailed(toUserMessage(list.reason)), "error");
        }
      })
      .finally(() => alive && setIsLoading(false));
    return () => {
      alive = false;
    };
    // preferredVersionId / accept only seed the initial pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, gameVersion, loader]);

  return { detail, versions, versionId, setVersionId, isLoading };
}
