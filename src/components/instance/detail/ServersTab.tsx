import React, { useState } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Activity, FolderOpen, Play, Plus, Server, Trash2 } from "lucide-react";
import { instanceService } from "@/services/instanceService";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { MinecraftInstance } from "@/types/navigation";
import type { ServerEntry, ServerPingResult } from "@/services/instanceService";
import { FramelessEmptyState, tabContentVariants } from "./shared";
import { useI18n } from "@/i18n";
import { Tip } from "@/components/ui/tooltip";
import { localizeBackendText } from "@/lib/errorMessage";

/** servers.dat stores the icon as bare base64, while a ping returns a full data URI. Falls back to a placeholder if it can't be decoded. */
const ServerIcon: React.FC<{ icon?: string; alt: string }> = ({ icon, alt }) => {
  const [failed, setFailed] = useState(false);
  if (!icon || failed) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10 border border-brand/20 text-brand-light shrink-0">
        <Server className="h-5 w-5" />
      </div>
    );
  }
  return (
    <img
      src={icon.startsWith("data:") ? icon : `data:image/png;base64,${icon}`}
      alt={alt}
      onError={() => setFailed(true)}
      className="h-10 w-10 rounded-lg object-cover bg-black/40 border border-white/10 shrink-0"
    />
  );
};

interface ServersTabProps {
  instance: MinecraftInstance;
  servers: ServerEntry[];
  setServers: (servers: ServerEntry[]) => void;
  onLaunch: (id: string, quickPlayType?: "singleplayer" | "multiplayer", quickPlayTarget?: string) => void;
  isLaunching: boolean;
  isRunning: boolean;
  tabDirection: number;
  ref?: React.Ref<HTMLDivElement>;
}

export const ServersTab: React.FC<ServersTabProps> = ({ instance, servers, setServers, onLaunch, isLaunching, isRunning, tabDirection, ref }: ServersTabProps) => {
  const { t } = useI18n();
  const [pingResults, setPingResults] = useState<Record<string, ServerPingResult | null>>({});
  const [isPinging, setIsPinging] = useState<Record<string, boolean>>({});
  const [isAddServerOpen, setIsAddServerOpen] = useState<boolean>(false);
  const [newServerName, setNewServerName] = useState<string>("");
  const [newServerIp, setNewServerIp] = useState<string>("");

  return (
    <>
              <motion.div
                key="servers"
                custom={tabDirection}
                ref={ref}
                variants={tabContentVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-4"
              >
                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                  <div>
                    <h2 className="text-sm font-bold text-white">{t.servers.title(servers.length)}</h2>
                    <p className="text-xs text-slate-400">
                      {t.servers.desc}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        setNewServerName("");
                        setNewServerIp("");
                        setIsAddServerOpen(true);
                      }}
                      className="bg-brand hover:bg-brand-light text-white text-xs h-8 font-medium"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      {t.servers.add}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => instanceService.openInstanceDirectory(instance.id, "minecraft")}
                      className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                    >
                      <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                      {t.servers.openGameDir}
                    </Button>
                  </div>
                </div>

                {servers.length === 0 ? (
                  <FramelessEmptyState
                    icon={Server}
                    title={t.servers.emptyTitle}
                    description={t.servers.emptyDesc}
                  />
                ) : (
                  <div className="space-y-2">
                    {servers.map((server, idx) => {
                      const ping = pingResults[server.ip];
                      const pinging = isPinging[server.ip];

                      const handlePing = async () => {
                        setIsPinging((prev) => ({ ...prev, [server.ip]: true }));
                        try {
                          const parts = server.ip.split(":");
                          const host = parts[0];
                          const port = parts.length > 1 ? parseInt(parts[1], 10) : 25565;
                          const res = await instanceService.pingServer(host, isNaN(port) ? undefined : port);
                          setPingResults((prev) => ({ ...prev, [server.ip]: res }));
                        } catch (_) {
                          setPingResults((prev) => ({ ...prev, [server.ip]: null }));
                        } finally {
                          setIsPinging((prev) => ({ ...prev, [server.ip]: false }));
                        }
                      };

                      return (
                        <div
                          key={`${server.ip}-${idx}`}
                          className="flex items-center justify-between p-3 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-all"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <ServerIcon
                              key={server.icon_base64 || ping?.favicon_base64}
                              icon={server.icon_base64 || ping?.favicon_base64}
                              alt={server.name}
                            />

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="font-semibold text-white text-sm truncate">
                                  {server.name}
                                </h4>
                                <span className="font-mono text-xs text-white/50">{server.ip}</span>
                              </div>
                              <p className="text-xs text-white/40 truncate mt-0.5">
                                {ping ? (
                                  <span className="text-white/70">{localizeBackendText(ping.motd)}</span>
                                ) : (
                                  t.servers.notPinged
                                )}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            {ping && (
                              <div className="flex items-center gap-2 text-right text-xs">
                                <span className="text-white/40 font-mono">
                                  {ping.online_players}/{ping.max_players}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={`text-2xs font-mono ${
                                    ping.latency_ms < 80
                                      ? "border-emerald-500/40 text-emerald-400"
                                      : ping.latency_ms < 180
                                      ? "border-amber-500/40 text-amber-400"
                                      : "border-red-500/40 text-red-400"
                                  }`}
                                >
                                  {ping.latency_ms} ms
                                </Badge>
                              </div>
                            )}

                            <Tip label={t.servers.pingAttr}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={handlePing}
                                disabled={pinging}
                                className="h-8 border-white/10 text-xs text-white/70 hover:text-white"
                              >
                                <Activity className={`w-3.5 h-3.5 mr-1 ${pinging ? "animate-spin" : ""}`} />
                                Ping
                              </Button>
                            </Tip>

                            <Button
                              size="sm"
                              onClick={() => onLaunch(instance.id, "multiplayer", server.ip)}
                              disabled={isLaunching || isRunning}
                              className="bg-brand hover:bg-brand-light text-white font-medium h-8 text-xs px-3 shadow-sm shadow-brand/30"
                            >
                              <Play className="w-3.5 h-3.5 mr-1 fill-white" />
                              {t.servers.quickPlay}
                            </Button>

                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                const next = servers.filter((_, i) => i !== idx);
                                setServers(next);
                                await instanceService.saveInstanceServers(instance.id, next);
                              }}
                              aria-label={t.servers.removeAttr}
                              className="h-8 px-2 text-white/40 hover:text-red-400"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
        {/* 新增伺服器對話框 */}
        <Dialog open={isAddServerOpen} onOpenChange={setIsAddServerOpen}>
          <DialogContent className="max-w-md bg-slate-900 border-white/10 text-white">
            <DialogHeader>
              <DialogTitle className="text-sm font-bold flex items-center gap-2">
                <Server className="w-4 h-4 text-brand-light" />
                {t.servers.addDialogTitle}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-xs">
              <div>
                <label htmlFor="server-name" className="text-white/60 mb-1 block">{t.servers.nameLabel}</label>
                <Input id="server-name"
                  value={newServerName}
                  onChange={(e) => setNewServerName(e.target.value)}
                  placeholder={t.servers.namePlaceholder}
                  className="bg-white/5 border-white/10 text-xs"
                />
              </div>
              <div>
                <label htmlFor="server-address" className="text-white/60 mb-1 block">{t.servers.addressLabel}</label>
                <Input id="server-address"
                  value={newServerIp}
                  onChange={(e) => setNewServerIp(e.target.value)}
                  placeholder={t.servers.addressPlaceholder}
                  className="bg-white/5 border-white/10 text-xs font-mono"
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsAddServerOpen(false)} className="border-white/10 text-xs">
                {t.common.cancel}
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  if (!newServerName.trim() || !newServerIp.trim()) return;
                  const newEntry: ServerEntry = {
                    name: newServerName.trim(),
                    ip: newServerIp.trim(),
                    icon_base64: undefined,
                  };
                  const next = [...servers, newEntry];
                  setServers(next);
                  await instanceService.saveInstanceServers(instance.id, next);
                  setIsAddServerOpen(false);
                }}
                className="bg-brand hover:bg-brand-light text-white text-xs"
              >
                {t.servers.addToList}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </>
  );
};
