import React from "react";
import { motion } from "motion/react";
import { AlertTriangle, Clock, Download, ExternalLink, Heart, Loader2, Package, Scale, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Markdown } from "@/components/ui/Markdown";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type {
  WorkshopProjectDetail,
  WorkshopProjectSummary,
  WorkshopVersionItem,
} from "@/services/workshopService";
import { openExternal } from "@/lib/openExternal";
import { formatCategory } from "@/lib/plainMarkdown";
import { useI18n } from "@/i18n";
import { Tip } from "@/components/ui/tooltip";

const DETAIL_WIDTH = 440;

interface ProjectDetailPanelProps {
  project: WorkshopProjectSummary;
  /** Modrinth URL segment: mod | resourcepack | shader | modpack */
  projectType: string;
  detail: WorkshopProjectDetail | null;
  versions: WorkshopVersionItem[];
  versionId: string;
  /** Warn when the chosen version does not list this game version. */
  warnGameVersion?: string;
  onVersionChange: (id: string) => void;
  isLoading: boolean;
  onClose: () => void;
  /** Primary action (add to list / import) rendered under the version picker. */
  action: React.ReactNode;
}

/** Collapsible project page: summary, version dropdown, meta and markdown body. */
export const ProjectDetailPanel: React.FC<ProjectDetailPanelProps> = ({
  project,
  projectType,
  detail,
  versions,
  versionId,
  warnGameVersion,
  onVersionChange,
  isLoading,
  onClose,
  action,
}) => {
  const { t, language } = useI18n();
  const current = versions.find((v) => v.id === versionId);
  const typeLabel = (v: WorkshopVersionItem["version_type"]) =>
    v === "release" ? t.workshopWin.verRelease : v === "beta" ? t.workshopWin.verBeta : t.workshopWin.verAlpha;

  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: DETAIL_WIDTH, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 40, mass: 0.8 }}
      className="shrink-0 overflow-hidden border-l border-white/10 bg-slate-950/60"
    >
      <div className="flex h-full flex-col" style={{ width: DETAIL_WIDTH }}>
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-4">
          <span className="truncate text-xs font-bold text-slate-200">{project.title}</span>
          <div className="flex items-center gap-1">
            <Tip label={t.workshopWin.openInBrowser}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={t.workshopWin.openInBrowser}
                onClick={() => void openExternal(`https://modrinth.com/${projectType}/${project.slug}`)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </Tip>
            <Tip label={t.workshopWin.closeDetail}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={t.workshopWin.closeDetail}
                onClick={onClose}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </Tip>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1" viewportClassName="space-y-4 p-4">
          <div className="flex items-start gap-3">
            {project.icon_url ? (
              <img
                src={project.icon_url}
                alt=""
                className="h-16 w-16 shrink-0 rounded-xl border border-white/10 bg-white/5 object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/40">
                <Package className="h-7 w-7" />
              </div>
            )}
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white">{project.title}</h3>
              <p className="text-xs text-slate-400">{t.workshopWin.byAuthor(project.author)}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">{project.description}</p>
            </div>
          </div>

          <div role="group" aria-labelledby="detail-version" className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <span id="detail-version" className="text-xs font-semibold text-slate-300">{t.workshopWin.selectVersion}</span>
            {isLoading && versions.length === 0 ? (
              <div className="flex h-8 items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-light" />
                {t.workshopWin.detailLoading}
              </div>
            ) : versions.length === 0 ? (
              <div className="flex h-8 items-center rounded-xl border border-white/10 bg-black/20 px-3 text-xs italic text-slate-400">
                {t.workshopWin.noCompatVersions}
              </div>
            ) : (
              <Select value={versionId} onValueChange={onVersionChange}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder={t.workshopWin.versionPlaceholder}>
                    <span className="truncate">{current?.version_number}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {versions.map((v) => (
                    <SelectItem
                      key={v.id}
                      value={v.id}
                      extraRight={
                        <span className="font-mono text-3xs text-slate-400">{typeLabel(v.version_type)}</span>
                      }
                    >
                      {v.version_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {current && (
              <p className="truncate font-mono text-3xs text-slate-400">
                {current.game_versions.slice(-4).join(", ")}
                {current.loaders.length > 0 && ` · ${current.loaders.join(", ")}`}
              </p>
            )}
            {current && warnGameVersion && !current.game_versions.includes(warnGameVersion) && (
              <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t.workshopWin.versionMismatch(warnGameVersion)}
              </p>
            )}
            {action}
          </div>

          {detail && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-2 gap-2 text-2xs text-slate-400"
            >
              <span className="flex items-center gap-1.5">
                <Download className="h-3.5 w-3.5" />
                {detail.downloads.toLocaleString(language)}
              </span>
              <span className="flex items-center gap-1.5">
                <Heart className="h-3.5 w-3.5" />
                {detail.follows.toLocaleString(language)}
              </span>
              <span className="flex items-center gap-1.5">
                <Scale className="h-3.5 w-3.5" />
                {detail.license || "—"}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {new Date(detail.updated).toLocaleDateString(language)}
              </span>
              <div className="col-span-2 flex flex-wrap gap-1.5 pt-1">
                {detail.categories.map((c) => (
                  <Badge key={c} variant="outline" className="border-white/10 px-1.5 py-0 text-3xs font-normal">
                    {formatCategory(c)}
                  </Badge>
                ))}
              </div>
            </motion.div>
          )}

          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold text-slate-300">{t.workshopWin.detailAbout}</h4>
            {!detail ? (
              <div className="flex items-center gap-2 py-4 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-light" />
                {t.workshopWin.detailLoading}
              </div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Markdown>{detail.body || detail.description}</Markdown>
              </motion.div>
            )}
          </div>
        </ScrollArea>
      </div>
    </motion.aside>
  );
};
