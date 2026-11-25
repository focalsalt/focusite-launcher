import React, { useMemo } from "react";
import { RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkshopCategory, WorkshopSearchFilters } from "@/services/workshopService";
import { formatCategory } from "@/lib/plainMarkdown";
import { useI18n } from "@/i18n";

export type Sort = NonNullable<WorkshopSearchFilters["sort"]>;
export type Env = NonNullable<WorkshopSearchFilters["environment"]>;

/** Select cannot hold an empty value, so "any" travels as this sentinel. */
const ANY = "__any__";

interface FilterSidebarProps {
  sort: Sort;
  onSort: (s: Sort) => void;
  /** Empty string means "any version". */
  gameVersion: string;
  onGameVersion: (v: string) => void;
  mcVersions: string[];
  /** Environment filter is shown only when a handler is given (mods). */
  env?: Env | null;
  onEnv?: (e: Env | null) => void;
  categories: WorkshopCategory[];
  picked: Set<string>;
  onToggleCategory: (name: string) => void;
  onReset: () => void;
  hasActive: boolean;
  className?: string;
}

/** Modrinth-style filter column shared by the workshop and the modpack importer. */
export const FilterSidebar: React.FC<FilterSidebarProps> = ({
  sort,
  onSort,
  gameVersion,
  onGameVersion,
  mcVersions,
  env,
  onEnv,
  categories,
  picked,
  onToggleCategory,
  onReset,
  hasActive,
  className,
}) => {
  const { t } = useI18n();

  const sortOptions: [Sort, string][] = [
    ["relevance", t.workshopWin.sortRelevance],
    ["downloads", t.workshopWin.sortDownloads],
    ["follows", t.workshopWin.sortFollows],
    ["newest", t.workshopWin.sortNewest],
    ["updated", t.workshopWin.sortUpdated],
  ];
  const envOptions: [Env | null, string][] = [
    [null, t.workshopWin.envAny],
    ["client", t.workshopWin.envClient],
    ["server", t.workshopWin.envServer],
  ];

  const grouped = useMemo(() => {
    const groups = new Map<string, WorkshopCategory[]>();
    categories.forEach((c) => groups.set(c.header, [...(groups.get(c.header) ?? []), c]));
    return [...groups.entries()];
  }, [categories]);

  return (
    <aside className={`flex w-60 shrink-0 flex-col border-r border-white/10 bg-slate-950/60 ${className ?? ""}`}>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <span className="text-xs font-bold text-slate-200">{t.workshopWin.filtersTitle}</span>
        {hasActive && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            whileTap={{ scale: 0.94 }}
            onClick={onReset}
            className="flex items-center gap-1 text-2xs text-slate-400 hover:text-white"
          >
            <RotateCcw className="h-3 w-3" />
            {t.workshopWin.clearFilters}
          </motion.button>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="space-y-5 p-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300">{t.workshopWin.sortLabel}</label>
          <Select value={sort} onValueChange={(v) => onSort(v as Sort)}>
            <SelectTrigger className="h-8">
              <SelectValue>{sortOptions.find(([v]) => v === sort)?.[1]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map(([v, label]) => (
                <SelectItem key={v} value={v}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300">{t.workshopWin.mcVersionLabel}</label>
          <Select value={gameVersion || ANY} onValueChange={(v) => onGameVersion(v === ANY ? "" : v)}>
            <SelectTrigger className="h-8">
              <SelectValue>{gameVersion || t.workshopWin.envAny}</SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value={ANY}>{t.workshopWin.envAny}</SelectItem>
              {mcVersions.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {onEnv && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">{t.workshopWin.envLabel}</label>
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-black/30 p-1">
              {envOptions.map(([v, label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => onEnv(v)}
                  className={`rounded-lg px-1 py-1.5 text-2xs font-semibold transition-colors ${
                    env === v ? "bg-brand text-white" : "text-slate-400 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {grouped.map(([header, items]) => (
          <div key={header} className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">
              {header === "categories" ? t.workshopWin.categoriesLabel : formatCategory(header)}
            </label>
            <div className="space-y-1">
              {items.map((c) => (
                <label
                  key={c.name}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-0.5 text-xs text-slate-400 hover:text-slate-100"
                >
                  <Checkbox checked={picked.has(c.name)} onCheckedChange={() => onToggleCategory(c.name)} />
                  <span>{formatCategory(c.name)}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </ScrollArea>
    </aside>
  );
};
