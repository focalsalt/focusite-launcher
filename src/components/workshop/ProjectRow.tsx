import React from "react";
import { motion } from "motion/react";
import { Check, Download, Heart, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { WorkshopProjectSummary } from "@/services/workshopService";
import { formatCategory } from "@/lib/plainMarkdown";

interface ProjectRowProps {
  project: WorkshopProjectSummary;
  active: boolean;
  /** Shows a check mark when the project is in the install list. */
  checked?: boolean;
  /** Pass a stable function, or the row re-renders with its list. */
  onSelect: (project: WorkshopProjectSummary) => void;
}

const compact = (n: number) =>
  new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** One Modrinth search hit; shared by the workshop window and the modpack import dialog. */
export const ProjectRow = React.memo(({ project, active, checked, onSelect }: ProjectRowProps) => (
  <motion.button
    type="button"
    onClick={() => onSelect(project)}
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    whileTap={{ scale: 0.985 }}
    transition={{ type: "spring", stiffness: 500, damping: 36 }}
    className={cn(
      "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
      active
        ? "border-brand-light/60 bg-brand/10"
        : "border-white/5 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.05]",
    )}
  >
    {project.icon_url ? (
      <img
        src={project.icon_url}
        alt=""
        loading="lazy"
        className="h-14 w-14 shrink-0 rounded-xl border border-white/10 bg-white/5 object-cover"
      />
    ) : (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/40">
        <Package className="h-6 w-6" />
      </div>
    )}
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline gap-2">
        <h4 className="truncate text-sm font-semibold text-slate-100">{project.title}</h4>
        <span className="shrink-0 text-2xs text-slate-500">by {project.author}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">{project.description}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {project.categories.slice(0, 3).map((c) => (
          <Badge key={c} variant="outline" className="border-white/10 px-1.5 py-0 text-3xs font-normal text-slate-400">
            {formatCategory(c)}
          </Badge>
        ))}
      </div>
    </div>
    <div className="flex shrink-0 flex-col items-end gap-1 text-2xs text-slate-500">
      <span className="flex items-center gap-1">
        <Download className="h-3 w-3" />
        {compact(project.downloads)}
      </span>
      <span className="flex items-center gap-1">
        <Heart className="h-3 w-3" />
        {compact(project.follows)}
      </span>
      {checked && <Check className="mt-1 h-4 w-4 text-brand-light" />}
    </div>
  </motion.button>
));
