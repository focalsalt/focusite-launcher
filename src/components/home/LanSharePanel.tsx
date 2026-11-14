import React, { useCallback, useEffect, useState } from "react";
import { Activity, Check, ClipboardPaste, Copy, Link2, Radio, Users, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { p2pService, P2pHandshakeResult, P2pSessionDto } from "@/services/p2pService";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { useI18n } from "@/i18n";
import { GroupsPanel } from "@/components/home/GroupsPanel";
import type { MinecraftInstance } from "@/types/navigation";

interface LanSharePanelProps {
  activeInstance: MinecraftInstance | null;
  /** Account name used as the default nickname. */
  accountName?: string | null;
}

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const parsePort = (value: string): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
};

const Section: React.FC<{ icon: React.ReactNode; title: string; steps: string; children: React.ReactNode }> = ({
  icon,
  title,
  steps,
  children,
}) => (
  <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-brand-light/30 bg-brand/20 text-brand-light">
        {icon}
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        <p className="text-xs leading-relaxed text-slate-400">{steps}</p>
      </div>
    </div>
    {children}
  </section>
);

const CODE_BOX =
  "h-24 w-full resize-none rounded-lg border border-white/10 bg-black/30 p-2 font-mono text-[11px] text-slate-200 outline-none focus:border-brand-light/50";
const PRIMARY = "h-9 gap-1.5 bg-brand px-4 text-xs font-semibold text-white hover:bg-brand-light";

/**
 * Local network broadcast (UDP 4445) plus a WebRTC tunnel for friends on other networks.
 * The tunnel is set up by swapping an invite code and a reply code by hand, so no server is involved.
 */
export const LanSharePanel: React.FC<LanSharePanelProps> = ({ activeInstance, accountName }) => {
  const { t } = useI18n();
  const [alias, setAlias] = useState<string>(() => localStorage.getItem("focusite_p2p_alias") || accountName || "");
  const [port, setPort] = useState<string>("25565");
  const [sessions, setSessions] = useState<P2pSessionDto[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [checks, setChecks] = useState<Record<string, { loading: boolean; res?: P2pHandshakeResult }>>({});
  const [copied, setCopied] = useState<string | null>(null);

  // Host tunnel
  const [inviteSession, setInviteSession] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string>("");
  const [answerInput, setAnswerInput] = useState<string>("");

  // Guest tunnel
  const [offerInput, setOfferInput] = useState<string>("");
  const [replyCode, setReplyCode] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      setSessions(await p2pService.listSessions());
    } catch (e) {
      console.error("Failed to list sessions:", e);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Live status, latency and traffic come from the running tunnel.
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const handleAlias = (value: string) => {
    setAlias(value);
    localStorage.setItem("focusite_p2p_alias", value);
  };

  /** Shared checks for every action that needs a nickname and a game port. */
  const readHostInput = (): { alias: string; port: number } | null => {
    if (!alias.trim()) {
      toast(t.home.aliasRequired, "error");
      return null;
    }
    const portNumber = parsePort(port);
    if (portNumber === null) {
      toast(t.lan.invalidPort, "error");
      return null;
    }
    return { alias: alias.trim(), port: portNumber };
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (e) {
      toast(t.home.connError(toUserMessage(e)), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleBroadcast = () => {
    if (!activeInstance) {
      toast(t.home.needInstance, "error");
      return;
    }
    const input = readHostInput();
    if (!input) return;
    void run(async () => {
      await p2pService.startHost(activeInstance.id, input.port, input.alias);
    });
  };

  const handleCreateInvite = () => {
    const input = readHostInput();
    if (!input) return;
    void run(async () => {
      if (inviteSession) await p2pService.stopSession(inviteSession).catch(() => undefined);
      const res = await p2pService.createOffer(activeInstance?.id ?? null, input.port, input.alias);
      setInviteSession(res.session.sessionId);
      setInviteCode(res.code);
      setAnswerInput("");
    });
  };

  const handleConnect = () => {
    if (!inviteSession || !answerInput.trim()) return;
    void run(async () => {
      await p2pService.applyAnswer(inviteSession, answerInput.trim());
    });
  };

  const handleJoin = () => {
    if (!offerInput.trim()) return;
    void run(async () => {
      const res = await p2pService.joinWithOffer(offerInput.trim());
      setReplyCode(res.code);
    });
  };

  const handleStop = async (sessionId: string) => {
    try {
      await p2pService.stopSession(sessionId);
      if (sessionId === inviteSession) {
        setInviteSession(null);
        setInviteCode("");
      }
      await refresh();
    } catch (e) {
      toast(t.errors.closeRoomFailed(toUserMessage(e)), "error");
    }
  };

  /** Real check: connects to the session's local port and reads the game's server status. */
  const handleCheck = async (sessionId: string) => {
    setChecks((prev) => ({ ...prev, [sessionId]: { loading: true } }));
    try {
      const res = await p2pService.verifyHandshake(sessionId);
      setChecks((prev) => ({ ...prev, [sessionId]: { loading: false, res } }));
    } catch (e) {
      setChecks((prev) => ({
        ...prev,
        [sessionId]: {
          loading: false,
          res: { sessionId, success: false, latencyMs: 0, motd: toUserMessage(e), serverVersion: t.home.error },
        },
      }));
    }
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch (e) {
      toast(toUserMessage(e), "error");
    }
  };

  const paste = async (set: (v: string) => void) => {
    try {
      set(await navigator.clipboard.readText());
    } catch (e) {
      toast(toUserMessage(e), "error");
    }
  };

  const copyButton = (id: string, text: string) => (
    <Button
      size="sm"
      variant="outline"
      onClick={() => copy(id, text)}
      className="h-7 gap-1 border-white/10 text-xs text-slate-200"
    >
      {copied === id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied === id ? t.lan.copied : t.lan.copy}
    </Button>
  );

  const pasteButton = (set: (v: string) => void) => (
    <Button
      size="sm"
      variant="outline"
      onClick={() => paste(set)}
      className="h-7 gap-1 border-white/10 text-xs text-slate-200"
    >
      <ClipboardPaste className="h-3 w-3" />
      {t.lan.paste}
    </Button>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-sm font-semibold text-slate-100">{t.lan.title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{t.lan.desc}</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">{t.lan.nickname}</label>
            <Input
              value={alias}
              onChange={(e) => handleAlias(e.target.value)}
              className="h-9 border-white/10 bg-black/30 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">{t.lan.port}</label>
            <Input
              inputMode="numeric"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
              className="h-9 border-white/10 bg-black/30 font-mono text-xs"
            />
          </div>
        </div>
      </div>

      <GroupsPanel activeInstance={activeInstance} port={parsePort(port)} sessions={sessions} />

      <details className="space-y-5 rounded-2xl border border-white/10 bg-white/[0.02] p-4 [&>*+*]:mt-5">
        <summary className="cursor-pointer text-xs font-semibold text-slate-300">{t.lan.manualTitle}</summary>
      <Section icon={<Wifi className="h-4 w-4" />} title={t.lan.lanTitle} steps={t.lan.lanSteps}>
        <Button onClick={handleBroadcast} disabled={busy} className={PRIMARY}>
          <Radio className="h-3.5 w-3.5" />
          {t.lan.start}
        </Button>
      </Section>

      <Section icon={<Users className="h-4 w-4" />} title={t.lan.hostTitle} steps={t.lan.hostSteps}>
        <Button onClick={handleCreateInvite} disabled={busy} className={PRIMARY}>
          <Link2 className="h-3.5 w-3.5" />
          {t.lan.createInvite}
        </Button>
        {inviteCode && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">{t.lan.inviteCode}</label>
                {copyButton("invite", inviteCode)}
              </div>
              <textarea readOnly value={inviteCode} className={CODE_BOX} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">{t.lan.answerCode}</label>
                {pasteButton(setAnswerInput)}
              </div>
              <textarea value={answerInput} onChange={(e) => setAnswerInput(e.target.value)} className={CODE_BOX} />
            </div>
            <Button onClick={handleConnect} disabled={busy || !answerInput.trim()} className={PRIMARY}>
              {t.lan.connect}
            </Button>
          </div>
        )}
      </Section>

      <Section icon={<Link2 className="h-4 w-4" />} title={t.lan.joinTitle} steps={t.lan.joinSteps}>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-300">{t.lan.offerPlaceholder}</label>
            {pasteButton(setOfferInput)}
          </div>
          <textarea value={offerInput} onChange={(e) => setOfferInput(e.target.value)} className={CODE_BOX} />
        </div>
        <Button onClick={handleJoin} disabled={busy || !offerInput.trim()} className={PRIMARY}>
          {t.lan.join}
        </Button>
        {replyCode && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">{t.lan.replyCode}</label>
              {copyButton("reply", replyCode)}
            </div>
            <textarea readOnly value={replyCode} className={CODE_BOX} />
          </div>
        )}
      </Section>

      </details>

      {sessions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-300">{t.lan.sessions}</h3>
          {sessions.map((s) => {
            const check = checks[s.sessionId];
            return (
              <div key={s.sessionId} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-xs font-semibold text-slate-100">
                      {s.alias} · {t.lan.status[s.status] ?? s.status}
                    </p>
                    <p className="truncate font-mono text-[11px] text-slate-400">
                      {s.role === "client" ? t.lan.address(s.localPort) : `:${s.localPort}`}
                    </p>
                    {s.status === "connected" && (
                      <p className="text-[11px] text-slate-400">
                        {t.lan.latency(s.latencyMs)} · {t.lan.traffic(formatBytes(s.bytesSent), formatBytes(s.bytesReceived))}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCheck(s.sessionId)}
                      disabled={check?.loading}
                      className="h-7 gap-1 border-white/10 text-xs text-slate-200"
                    >
                      <Activity className={`h-3 w-3 ${check?.loading ? "animate-spin" : ""}`} />
                      {t.lan.check}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleStop(s.sessionId)}
                      className="h-7 bg-rose-600/80 text-xs text-white hover:bg-rose-600"
                    >
                      {t.lan.stop}
                    </Button>
                  </div>
                </div>
                {check?.res && (
                  <p className={`text-[11px] ${check.res.success ? "text-emerald-400" : "text-rose-400"}`}>
                    {check.res.success ? t.lan.checkOk(check.res.latencyMs) : t.lan.checkFail(check.res.motd)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
