import React, { useEffect, useState } from "react";
import { Globe, Play, Server } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { instanceService } from "@/services/instanceService";
import { MinecraftInstance } from "@/types/navigation";
import { useI18n } from "@/i18n";

const MAX_ITEMS = 100;

type PlayType = "singleplayer" | "multiplayer";

interface Item {
  key: string;
  instanceId: string;
  instanceName: string;
  name: string;
  badge: string;
  /** Sort key: world last-played time, or the instance's last-played time for servers. */
  playedAt: number;
  target: string;
}

interface RecentQuickPlayProps {
  instances: MinecraftInstance[];
  /** Re-read the lists whenever this changes (e.g. after a game exits). */
  refreshKey: string;
  isBusy: (instanceId: string) => boolean;
  onPlay: (instanceId: string, type: PlayType, target: string) => void;
}

/** One-click join for the most recently played worlds and saved servers across all instances. */
export const RecentQuickPlay: React.FC<RecentQuickPlayProps> = ({ instances, refreshKey, isBusy, onPlay }) => {
  const { t } = useI18n();
  const [worlds, setWorlds] = useState<Item[]>([]);
  const [servers, setServers] = useState<Item[]>([]);

  const idsKey = instances.filter((i) => !i.needsSetup).map((i) => i.id).join(",");

  useEffect(() => {
    let alive = true;
    const usable = instances.filter((i) => !i.needsSetup);

    Promise.all(
      usable.map(async (inst) => {
        const [w, s] = await Promise.all([
          instanceService.listInstanceWorlds(inst.id).catch(() => []),
          instanceService.readInstanceServers(inst.id).catch(() => []),
        ]);
        const base = { instanceId: inst.id, instanceName: inst.name };
        const worldItems: Item[] = w.map((x) => ({
          ...base,
          key: `${inst.id}/${x.folder_name}`,
          name: x.name || x.folder_name,
          badge: x.last_played > 0 ? new Date(x.last_played).toLocaleString() : t.worlds.unknownTime,
          playedAt: x.last_played,
          target: x.folder_name,
        }));
        const serverItems: Item[] = s.map((x) => ({
          ...base,
          key: `${inst.id}/${x.ip}`,
          name: x.name || x.ip,
          badge: x.ip,
          playedAt: inst.lastPlayedAt ?? 0,
          target: x.ip,
        }));
        return { worldItems, serverItems };
      }),
    ).then((all) => {
      if (!alive) return;
      const top = (items: Item[]) => items.sort((a, b) => b.playedAt - a.playedAt).slice(0, MAX_ITEMS);
      setWorlds(top(all.flatMap((r) => r.worldItems)));
      setServers(top(all.flatMap((r) => r.serverItems)));
    });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, refreshKey]);

  const rows = (title: string, icon: React.ReactNode, empty: string, items: Item[], type: PlayType) => (
    <div className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex shrink-0 items-center gap-2 text-sm font-semibold text-slate-100">
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-500">{empty}</p>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
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
                <p className="truncate text-[11px] text-slate-400">{t.home.usedInstance}{it.instanceName}</p>
              </div>
              <Button
                size="sm"
                onClick={() => onPlay(it.instanceId, type, it.target)}
                disabled={isBusy(it.instanceId)}
                className="h-7 bg-brand px-3 text-xs font-medium text-white hover:bg-brand-light"
              >
                <Play className="mr-1 h-3.5 w-3.5 fill-white" />
                {t.home.joinNow}
              </Button>
            </motion.div>
          ))}
        </div>
        </ScrollArea>
      )}
    </div>
  );

  return (
    <div className="grid h-full grid-cols-1 grid-rows-[repeat(2,minmax(0,1fr))] gap-5 md:grid-cols-2 md:grid-rows-[minmax(0,1fr)]">
      {rows(t.home.recentWorlds, <Globe className="h-4 w-4 text-brand-light" />, t.home.noWorlds, worlds, "singleplayer")}
      {rows(t.home.recentServers, <Server className="h-4 w-4 text-brand-light" />, t.home.noServers, servers, "multiplayer")}
    </div>
  );
};
