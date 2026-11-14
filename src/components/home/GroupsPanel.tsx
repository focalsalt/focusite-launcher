import React, { useEffect, useState } from "react";
import { Check, Copy, LogOut, Plus, Share2, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { decodeInvite, encodeInvite, normalizeServer } from "@/lib/groupInvite";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { useI18n } from "@/i18n";
import { groupManager, GroupView, useGroups } from "@/services/groupManager";
import { p2pService, P2pSessionDto } from "@/services/p2pService";
import type { MinecraftInstance } from "@/types/navigation";

interface GroupsPanelProps {
  activeInstance: MinecraftInstance | null;
  /** Game port typed in the panel header; null when it is not a valid port. */
  port: number | null;
  sessions: P2pSessionDto[];
}

const PRIMARY = "h-9 gap-1.5 bg-brand px-4 text-xs font-semibold text-white hover:bg-brand-light";
const OUTLINE = "h-7 gap-1 border-white/10 text-xs text-slate-200";
/** Set as VITE_SIGNALING_URL in .env. */
const SIGNALING_SERVER = normalizeServer(import.meta.env.VITE_SIGNALING_URL ?? "");

export const GroupsPanel: React.FC<GroupsPanelProps> = ({ activeInstance, port, sessions }) => {
  const { t } = useI18n();
  const groups = useGroups();
  const [firewallOk, setFirewallOk] = useState<boolean | null>(null);
  const [firewallBusy, setFirewallBusy] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [inviteText, setInviteText] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Tunnels the backend removed (failed or closed) disappear from the group view too.
  useEffect(() => {
    groupManager.reconcile(new Set(sessions.map((s) => s.sessionId)));
  }, [sessions]);

  useEffect(() => {
    groupManager.onError = (message) => toast(t.home.connError(message), "error");
    groupManager.start();
    p2pService.firewallStatus().then(setFirewallOk, () => setFirewallOk(true));
  }, [t]);

  const allowFirewall = async () => {
    setFirewallBusy(true);
    try {
      await p2pService.firewallSetup();
      setFirewallOk(true);
    } catch (e) {
      toast(t.groups.firewallFailed(toUserMessage(e)), "error");
    } finally {
      setFirewallBusy(false);
    }
  };

  const createGroup = () => {
    if (!SIGNALING_SERVER) {
      toast(t.groups.serverMissing, "error");
      return;
    }
    groupManager.create(groupName, SIGNALING_SERVER);
    setGroupName("");
  };

  const joinGroup = () => {
    const info = decodeInvite(inviteText);
    if (!info) {
      toast(t.groups.invalidInvite, "error");
      return;
    }
    if (!groupManager.add(info)) toast(t.groups.alreadyJoined, "error");
    setInviteText("");
  };

  const copyInvite = async (g: GroupView) => {
    try {
      await navigator.clipboard.writeText(encodeInvite(g.info));
      setCopiedId(g.info.id);
      window.setTimeout(() => setCopiedId((c) => (c === g.info.id ? null : c)), 1500);
    } catch (e) {
      toast(toUserMessage(e), "error");
    }
  };

  const share = (g: GroupView) => {
    if (!activeInstance) {
      toast(t.groups.shareNeedsInstance, "error");
      return;
    }
    if (port === null) {
      toast(t.lan.invalidPort, "error");
      return;
    }
    groupManager.startShare(g.info.id, { label: activeInstance.name, port, instanceId: activeInstance.id });
  };

  const sessionPort = (id: string): number | undefined => sessions.find((s) => s.sessionId === id)?.localPort;

  return (
    <div className="space-y-5">
      <section className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
        <h3 className="text-sm font-semibold text-slate-100">{t.groups.guideTitle}</h3>
        <ol className="space-y-1.5 text-xs leading-relaxed text-slate-400">
          {[t.groups.step1, t.groups.step2, t.groups.step3, t.groups.step4].map((text, i) => (
            <li key={i} className="flex gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand/30 text-[10px] font-bold text-brand-light">
                {i + 1}
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </section>

      {firewallOk === false ? (
        <section className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1 space-y-2">
            <h3 className="text-sm font-semibold text-amber-300">{t.groups.firewallTitle}</h3>
            <p className="text-xs leading-relaxed text-amber-200/80">{t.groups.firewallDesc}</p>
            <Button onClick={allowFirewall} disabled={firewallBusy} className={PRIMARY}>
              {t.groups.firewallAllow}
            </Button>
          </div>
        </section>
      ) : (
        firewallOk && (
          <p className="flex items-center gap-1.5 text-xs text-emerald-400">
            <ShieldCheck className="h-4 w-4" />
            {t.groups.firewallOk}
          </p>
        )
      )}

      <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300">{t.groups.groupName}</label>
          <Input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            className="h-9 border-white/10 bg-black/30 text-xs"
          />
        </div>
        <Button onClick={createGroup} className={PRIMARY}>
          <Plus className="h-3.5 w-3.5" />
          {t.groups.create}
        </Button>
        <div className="flex gap-2 border-t border-white/10 pt-3">
          <Input
            value={inviteText}
            onChange={(e) => setInviteText(e.target.value)}
            placeholder={t.groups.invitePlaceholder}
            className="h-9 border-white/10 bg-black/30 font-mono text-xs"
          />
          <Button onClick={joinGroup} disabled={!inviteText.trim()} className={PRIMARY}>
            {t.groups.joinGroup}
          </Button>
        </div>
      </section>

      {groups.length === 0 && <p className="text-xs text-slate-500">{t.groups.noGroups}</p>}

      {groups.map((g) => (
        <section key={g.info.id} className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Users className="h-4 w-4 shrink-0 text-brand-light" />
              <h3 className="truncate text-sm font-semibold text-slate-100">{g.info.name}</h3>
              <Badge
                variant="outline"
                className={`text-[10px] ${g.link === "online" ? "border-emerald-500/40 text-emerald-400" : "border-amber-500/40 text-amber-400"}`}
              >
                {t.groups.link[g.link]}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => copyInvite(g)} className={OUTLINE}>
                {copiedId === g.info.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copiedId === g.info.id ? t.lan.copied : t.groups.copyInvite}
              </Button>
              {g.myShare ? (
                <Button size="sm" variant="outline" onClick={() => groupManager.stopShare(g.info.id)} className={OUTLINE}>
                  <Share2 className="h-3 w-3" />
                  {t.groups.stopShare}
                </Button>
              ) : (
                <Button size="sm" disabled={g.link !== "online"} onClick={() => share(g)} className="h-7 gap-1 bg-brand text-xs text-white hover:bg-brand-light">
                  <Share2 className="h-3 w-3" />
                  {t.groups.shareWorld}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => groupManager.remove(g.info.id)}
                className={`${OUTLINE} text-rose-300`}
              >
                <LogOut className="h-3 w-3" />
                {t.groups.leaveGroup}
              </Button>
            </div>
          </div>

          {g.link === "offline" && <p className="text-[11px] text-amber-300/80">{t.groups.offlineHint}</p>}
          {g.myShare && <p className="text-xs text-emerald-400">{t.groups.sharing(g.myShare.label, g.myShare.port)}</p>}

          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold text-slate-300">{t.groups.members(g.members.length)}</h4>
            {g.members.length === 0 && <p className="text-[11px] text-slate-500">{t.groups.noMembers}</p>}
            {g.members.map((m) => {
              const joinedSession = g.joined[m.id];
              const joinedPort = joinedSession ? sessionPort(joinedSession) : undefined;
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-100">{m.name}</p>
                    <p className="truncate text-[11px] text-slate-400">
                      {joinedPort !== undefined
                        ? t.groups.connected(joinedPort)
                        : m.share
                          ? t.groups.shares(m.share.label, m.share.port)
                          : t.groups.notSharing}
                    </p>
                  </div>
                  {joinedSession ? (
                    <Button size="sm" variant="outline" onClick={() => groupManager.endJoined(g.info.id, m.id)} className={OUTLINE}>
                      {t.groups.leave}
                    </Button>
                  ) : (
                    m.share && (
                      <Button
                        size="sm"
                        disabled={g.pending.includes(m.id)}
                        onClick={() => groupManager.join(g.info.id, m.id)}
                        className="h-7 bg-brand text-xs text-white hover:bg-brand-light"
                      >
                        {g.pending.includes(m.id) ? t.groups.waiting : t.groups.join}
                      </Button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};
