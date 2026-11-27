import { slideVariants } from "@/lib/motion";
import { Skeleton } from "@/components/ui/skeleton";
import React from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CircleHelp, Monitor, MonitorSmartphone, Server } from "lucide-react";
import type { ModSideInfo } from "@/services/instanceService";
import type { PackFileInfo } from "@/types/navigation";
import { useI18n } from "@/i18n";
import { formatMcRange } from "@/lib/mcVersionRange";

export function FramelessEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center space-y-3 select-none">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-brand-light shadow-inner">
        <Icon className="h-6 w-6" />
      </div>
      <div className="space-y-1 max-w-sm">
        <p className="text-sm font-semibold text-slate-200">{title}</p>
        <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
      </div>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

// Horizontal spring slide variants shared by every instance sub-tab.
export const tabContentVariants = slideVariants("x", 16);

export function PackItem({
  pack,
  icon: Icon,
  action,
}: {
  pack: PackFileInfo;
  icon: React.ComponentType<{ className?: string }>;
  /** Optional trailing control (e.g. a delete button). */
  action?: React.ReactNode;
}) {
  const { t, language } = useI18n();
  const effectiveBytes = pack.sizeBytes ?? pack.size ?? 0;
  const sizeMb = (effectiveBytes / (1024 * 1024)).toFixed(2);
  const sizeStr =
    effectiveBytes > 1024 * 1024 ? `${sizeMb} MB` : `${(effectiveBytes / 1024).toFixed(1)} KB`;
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] p-3 text-xs">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 border border-white/10 text-brand-light">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-200">{pack.filename}</span>
            <Badge variant="outline" className="text-3xs py-0 px-1.5 border-white/10 text-slate-300">
              {sizeStr}
            </Badge>
          </div>
          {pack.description && (
            <p className="text-2xs text-slate-400 mt-0.5 line-clamp-1">{pack.description}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-2xs text-slate-400 font-mono">
          {pack.modified ? new Date(pack.modified * 1000).toLocaleDateString(language) : t.shared.localPackage}
        </span>
        {action}
      </div>
    </div>
  );
}

const SIDE_ICONS = { client: Monitor, server: Server, both: MonitorSmartphone, unknown: CircleHelp };

export const ModItem = React.memo(function ModItem({
  name,
  enabled,
  onToggle,
  info,
}: {
  /** File name; identifies the mod and is shown while it has no declared name. */
  name: string;
  enabled: boolean;
  /** Pass a stable function, or the row re-renders with its list. */
  onToggle: (name: string, checked: boolean) => void;
  /** Omitted while it is still being read, and for lists that do not read it. Pass a stable object. */
  info?: ModSideInfo;
}) {
  const { t } = useI18n();
  const side = info?.side;
  const SideIcon = side && SIDE_ICONS[side];
  const sideHint = info?.source ? t.mods.sideSources[info.source] : t.mods.sideUnknownHint;
  const title = info?.name ?? name;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3 text-xs">
      <div className="min-w-0 break-all">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-200" title={name}>{title}</span>
          {info?.version && (
            <Badge variant="outline" className="text-3xs py-0 px-1.5 border-white/10 text-slate-300">
              {t.mods.versionBadge(info.version)}
            </Badge>
          )}
        </div>
        {info?.mcVersion && (
          <p className="mt-0.5 text-2xs text-slate-400">
            Minecraft {formatMcRange(info.mcVersion, t.mods.mcRange)}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {side && SideIcon && (
          <Badge
            variant="outline"
            title={sideHint}
            className={cn(
              "gap-1 text-3xs py-0 px-1.5 border-white/10 text-slate-300",
              side === "unknown" && "border-dashed text-slate-400",
            )}
          >
            <SideIcon className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">{t.mods.sideLabel}</span>
            {t.mods.sideNames[side]}
            <span className="sr-only"> ({sideHint})</span>
          </Badge>
        )}
        <span className="text-2xs text-slate-400 font-medium">
          {enabled ? t.common.enabled : t.common.disabled}
        </span>
        <Switch aria-label={title} checked={enabled} onCheckedChange={(checked) => onToggle(name, checked)} />
      </div>
    </div>
  );
});


/** Placeholder rows shown while an instance's files are being listed. */
export function TabSkeleton({ ref }: { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="space-y-3" aria-busy="true">
      <Skeleton className="h-6 w-40" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-white/5 bg-black/20 p-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Heading row of a settings-tab section. */
export const SectionHeading: React.FC<{ icon: React.ReactNode; title: string; description?: string }> = ({
  icon,
  title,
  description,
}) => (
  <div className="space-y-1">
    <div className="flex items-center gap-2">
      {icon}
      <h3 className="text-sm font-bold text-white">{title}</h3>
    </div>
    {description && <p className="text-xs text-slate-400">{description}</p>}
  </div>
);
