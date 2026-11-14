import React, { useEffect, useState } from "react";
import { Globe, Play, Server } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { instanceService, ServerEntry, WorldSummary } from "@/services/instanceService";
import { useI18n } from "@/i18n";

const MAX_ITEMS = 4;

interface RecentQuickPlayProps {
  instanceId: string;
  /** Shown under every row so it is clear which instance the click launches. */
  instanceName: string;
  /** Re-read the lists whenever this flips (e.g. after the game exits). */
  refreshKey: boolean;
  disabled: boolean;
  onPlay: (type: "singleplayer" | "multiplayer", target: string) => void;
}

/** One-click join for the most recently played worlds and the saved servers of the active instance. */
export const RecentQuickPlay: React.FC<RecentQuickPlayProps> = ({ instanceId, instanceName, refreshKey, disabled, onPlay }) => {
  const { t } = useI18n();
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [servers, setServers] = useState<ServerEntry[]>([]);

  useEffect(() => {
    let alive = true;
    instanceService
      .listInstanceWorlds(instanceId)
      .then((w) => alive && setWorlds([...w].sort((a, b) => b.last_played - a.last_played).slice(0, MAX_ITEMS)))
      .catch(() => alive && setWorlds([]));
    instanceService
      .readInstanceServers(instanceId)
      .then((s) => alive && setServers(s.slice(0, MAX_ITEMS)))
      .catch(() => alive && setServers([]));
    return () => {
      alive = false;
    };
  }, [instanceId, refreshKey]);

  const rows = (
    title: string,
    icon: React.ReactNode,
    empty: string,
    items: { key: string; name: string; badge: string; onClick: () => void }[],
  ) => (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100">
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-500">{empty}</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((it) => (
            <motion.div
              key={it.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 36 }}
              className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-xs font-semibold text-slate-100">{it.name}</p>
                  <Badge variant="outline" className="shrink-0 border-white/10 px-1.5 py-0 font-mono text-[10px] text-slate-300">
                    {it.badge}
                  </Badge>
                </div>
                <p className="truncate text-[11px] text-slate-400">{t.home.usedInstance}{instanceName}</p>
              </div>
              <Button
                size="sm"
                onClick={it.onClick}
                disabled={disabled}
                className="h-7 bg-brand px-3 text-xs font-medium text-white hover:bg-brand-light"
              >
                <Play className="mr-1 h-3.5 w-3.5 fill-white" />
                {t.home.joinNow}
              </Button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {rows(
        t.home.recentWorlds,
        <Globe className="h-4 w-4 text-brand-light" />,
        t.home.noWorlds,
        worlds.map((w) => ({
          key: w.folder_name,
          name: w.name || w.folder_name,
          badge: w.last_played > 0 ? new Date(w.last_played).toLocaleString() : t.worlds.unknownTime,
          onClick: () => onPlay("singleplayer", w.folder_name),
        })),
      )}
      {rows(
        t.home.recentServers,
        <Server className="h-4 w-4 text-brand-light" />,
        t.home.noServers,
        servers.map((s) => ({
          key: s.ip,
          name: s.name || s.ip,
          badge: s.ip,
          onClick: () => onPlay("multiplayer", s.ip),
        })),
      )}
    </div>
  );
};
