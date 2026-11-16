import React, { useState, useEffect, useRef } from "react";
import {
  Terminal,
  Square,
  Copy,
  Trash2,
  Search,
  ArrowDownCircle,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Sparkles,
  Lightbulb,
  X,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import {
  instanceService,
  InstanceLogEvent,
  InstanceStatusEvent,
} from "@/services/instanceService";
import {
  diagnosticService,
  DiagnosticResult,
} from "@/services/diagnosticService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WindowBar } from "@/components/layout/WindowBar";
import { useI18n } from "@/i18n";
import { toast } from "@/lib/toast";
import { Toaster } from "@/components/ui/Toaster";
import { SlidingIndicator, useSlidingIndicator } from "@/components/ui/sliding-indicator";

export const LogWindow: React.FC = () => {
  const { t } = useI18n();
  const [logs, setLogs] = useState<InstanceLogEvent[]>([]);
  const [status, setStatus] = useState<string>("ready");
  const [activePid, setActivePid] = useState<number | null>(null);
  const [activeInstanceId, setActiveInstanceId] = useState<string>(() => {
    try {
      const hash = window.location.hash;
      const qIndex = hash.indexOf("?");
      if (qIndex !== -1) {
        const params = new URLSearchParams(hash.substring(qIndex));
        const id = params.get("instanceId");
        if (id) return id;
      }
      const searchParams = new URLSearchParams(window.location.search);
      const searchId = searchParams.get("instanceId");
      if (searchId) return searchId;
    } catch (_) {}
    return "";
  });
  const [exitCode, setExitCode] = useState<number | null>(null);

  const [filterText, setFilterText] = useState<string>("");
  const [streamFilter, setStreamFilter] = useState<string>("all");
  const pill = useSlidingIndicator(streamFilter);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  const [diagnosticResult, setDiagnosticResult] = useState<DiagnosticResult | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState<boolean>(false);
  const [dismissDiagnosis, setDismissDiagnosis] = useState<boolean>(false);
  const autoDiagnosedRef = useRef<boolean>(false);

  const logsEndRef = useRef<HTMLDivElement>(null);

  const runDiagnosis = async (currentLogs = logs) => {
    if (currentLogs.length === 0) return;
    setIsDiagnosing(true);
    setDismissDiagnosis(false);
    try {
      const fullText = currentLogs.map((l) => l.line).join("\n");
      const res = await diagnosticService.diagnoseLogContent(fullText);
      setDiagnosticResult(res);
    } catch (e) {
      console.error("Failed to run log diagnosis:", e);
    } finally {
      setIsDiagnosing(false);
    }
  };

  useEffect(() => {
    let unlistenLog: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;

    // Load initial in-memory buffered logs for this specific instance
    if (activeInstanceId) {
      instanceService.getInstanceLogBuffer(activeInstanceId).then((buffered) => {
        if (buffered && buffered.length > 0) {
          // Keep live events newer than the snapshot instead of overwriting them.
          const lastTs = buffered[buffered.length - 1].timestamp;
          setLogs((prev) => [...buffered, ...prev.filter((l) => l.timestamp > lastTs)]);
        }
      });
      instanceService.getInstanceRunningStatus(activeInstanceId).then((proc) => {
        if (proc) {
          setStatus("running");
          setActivePid(proc.pid);
        }
      });
    }

    // Listen to real-time log events filtered by this instance
    listen<InstanceLogEvent>("instance-log", (event) => {
      if (activeInstanceId && event.payload.instance_id && event.payload.instance_id !== activeInstanceId) {
        return;
      }
      setLogs((prev) => {
        // Keep max 10,000 lines in memory
        const next = [...prev, event.payload];
        if (next.length > 10000) {
          return next.slice(next.length - 10000);
        }
        return next;
      });
      if (!activeInstanceId && event.payload.instance_id) {
        setActiveInstanceId(event.payload.instance_id);
      }
    }).then((un) => {
      unlistenLog = un;
    });

    // Listen to process status events filtered by this instance
    listen<InstanceStatusEvent>("instance-status", (event) => {
      if (activeInstanceId && event.payload.instance_id && event.payload.instance_id !== activeInstanceId) {
        return;
      }
      setStatus(event.payload.status);
      if (event.payload.instance_id) {
        setActiveInstanceId(event.payload.instance_id);
      }
      if (event.payload.pid) {
        setActivePid(event.payload.pid);
      }
      if (event.payload.exit_code !== undefined && event.payload.exit_code !== null) {
        setExitCode(event.payload.exit_code);
        if (event.payload.status === "stopped" || event.payload.status === "crashed") {
          setActivePid(null);
        }
        if (event.payload.status === "crashed" && !autoDiagnosedRef.current) {
          autoDiagnosedRef.current = true;
          // Defer diagnosis slightly to ensure final stderr lines are buffered
          setTimeout(() => {
            setLogs((currentLogs) => {
              runDiagnosis(currentLogs);
              return currentLogs;
            });
          }, 300);
        }
      }
    }).then((un) => {
      unlistenStatus = un;
    });

    return () => {
      if (unlistenLog) unlistenLog();
      if (unlistenStatus) unlistenStatus();
    };
  }, [activeInstanceId]);

  // Auto-scroll when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const handleCopyLogs = async () => {
    const text = logs
      .map(
        (l) =>
          `[${new Date(l.timestamp).toLocaleTimeString()}] [${l.stream.toUpperCase()}] ${l.line}`
      )
      .join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast(t.common.copied, "success");
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  const handleKill = async () => {
    if (activeInstanceId) {
      try {
        await instanceService.killInstance(activeInstanceId);
      } catch (e) {
        console.error("Failed to kill instance:", e);
      }
    }
  };

  const filteredLogs = logs.filter((log) => {
    if (streamFilter !== "all" && log.stream !== streamFilter) {
      return false;
    }
    if (filterText && !log.line.toLowerCase().includes(filterText.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col h-screen w-screen bg-canvas text-slate-200 select-text overflow-hidden font-mono text-xs">
      {/* Frameless Window Bar with window controls */}
      <WindowBar title={t.logWin.windowTitle(activeInstanceId ? `— ${activeInstanceId}` : "")} />

      {/* Detached Window Header */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <Terminal className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-slate-100">
                {t.logWin.title}
              </span>
              {activeInstanceId && (
                <span className="text-[11px] text-slate-400">
                  ({activeInstanceId})
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Status Indicator */}
        <div className="flex items-center gap-3">
          {status === "running" && (
            <Badge className="bg-brand/20 border-brand-light/40 text-brand-light gap-1.5 py-0.5 px-2">
              <span className="h-2 w-2 rounded-full bg-brand-light animate-pulse" />
              {t.logWin.runningPid(activePid ?? 0)}
            </Badge>
          )}
          {status === "launching" && (
            <Badge className="bg-amber-500/20 border-amber-500/40 text-amber-400 gap-1.5 py-0.5 px-2">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
              {t.logWin.starting}
            </Badge>
          )}
          {status === "stopped" && (
            <Badge className="bg-slate-500/20 border-slate-500/40 text-slate-300 gap-1.5 py-0.5 px-2">
              <CheckCircle2 className="h-3 w-3" />
              {t.logWin.stopped(exitCode ?? 0)}
            </Badge>
          )}
          {status === "crashed" && (
            <Badge className="bg-rose-500/20 border-rose-500/40 text-rose-400 gap-1.5 py-0.5 px-2">
              <AlertTriangle className="h-3 w-3" />
              {t.logWin.abnormalExit(exitCode ?? "N/A")}
            </Badge>
          )}

          {status === "running" && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleKill}
              className="h-7 text-xs gap-1.5 bg-rose-600 hover:bg-rose-700 text-white font-medium px-2.5"
            >
              <Square className="h-3 w-3 fill-current" />
              {t.logWin.forceStop}
            </Button>
          )}
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-white/5 gap-3 shrink-0">
        <div className="flex items-center gap-2 flex-1 max-w-sm">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              type="text"
              placeholder={t.logWin.searchPlaceholder}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="h-8 pl-8 text-xs bg-white/5 border-white/10 text-slate-200 focus-visible:border-brand-light"
            />
          </div>
        </div>

        {/* Stream Filter Pills */}
        <div className="relative flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/10 text-xs">
          <SlidingIndicator box={pill.box} className="top-1 bottom-1 rounded-lg bg-brand shadow-sm shadow-brand/50" />
          {(["all", "stdout", "stderr", "system"] as const).map((s) => (
            <button
              key={s}
              ref={pill.register(s)}
              type="button"
              onClick={() => setStreamFilter(s)}
              className={`relative px-3 py-1 rounded-lg font-medium transition-colors ${
                streamFilter === s
                  ? "text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <span className="relative z-10">{s.toUpperCase()}</span>
            </button>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => runDiagnosis()}
            disabled={isDiagnosing || logs.length === 0}
            className="h-8 text-xs gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300"
          >
            <Sparkles className={`h-3.5 w-3.5 ${isDiagnosing ? "animate-spin" : ""}`} />
            {isDiagnosing ? t.logWin.diagnosing : t.logWin.diagnose}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setAutoScroll(!autoScroll)}
            className={`h-8 text-xs gap-1.5 border-white/10 ${
              autoScroll ? "text-brand-light bg-brand-light/10" : "text-slate-400"
            }`}
          >
            <ArrowDownCircle className="h-3.5 w-3.5" />
            {t.logWin.autoScroll}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleCopyLogs}
            className="h-8 text-xs gap-1.5 border-white/10 text-slate-300 hover:text-white"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? t.common.copied : t.logWin.copyAll}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleClearLogs}
            className="h-8 text-xs gap-1.5 border-white/10 text-slate-400 hover:text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t.logWin.clear}
          </Button>
        </div>
      </div>

      {/* Crash Alert Banner */}
      {status === "crashed" && !diagnosticResult?.hasCrash && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-rose-950/60 border-b border-rose-500/30 text-rose-200 shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
            <span>
              {t.logWin.crashNotice(exitCode)}
              {t.logWin.diagnoseHint}
            </span>
          </div>
        </div>
      )}

      {/* Structured Diagnostic Result Card */}
      {diagnosticResult && diagnosticResult.hasCrash && !dismissDiagnosis && (
        <div className="mx-4 my-2.5 p-3.5 bg-slate-900/90 border border-emerald-500/30 rounded-xl shadow-xl backdrop-blur-md shrink-0">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-light" />
              <span className="font-semibold text-slate-100 text-xs">
                {t.logWin.diagnoseResult}
              </span>
              <Badge className="bg-emerald-500/10 border-emerald-500/30 text-emerald-400 text-[10px] py-0 px-1.5 font-mono">
                {((diagnosticResult.executionTimeMicros ?? 0) / 1000).toFixed(2)} ms
              </Badge>
              <Badge className="bg-amber-500/10 border-amber-500/30 text-amber-300 text-[10px] py-0 px-1.5 font-mono">
                {diagnosticResult.rootCauseType}
              </Badge>
            </div>
            <button
              type="button"
              onClick={() => setDismissDiagnosis(true)}
              className="text-slate-400 hover:text-white transition-colors p-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="pt-2.5 space-y-2 text-xs">
            <div className="text-slate-200 font-medium leading-relaxed">
              {diagnosticResult.summary}
            </div>

            {diagnosticResult.details.length > 0 && (
              <div className="bg-black/30 rounded-lg p-2 space-y-1 border border-white/5 font-mono text-[11px] text-slate-300">
                {diagnosticResult.details.map((detail, idx) => (
                  <div key={idx} className="flex items-start gap-1.5">
                    <span className="text-emerald-500 select-none">•</span>
                    <span>{detail}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-start gap-2 text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 text-[11px]">
              <Lightbulb className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <span className="font-semibold text-amber-400">{t.logWin.suggestions}</span>
                {diagnosticResult.suggestion}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Terminal Viewport (Shadcn ScrollArea, 0px 排版位移) */}
      <ScrollArea className="flex-1 min-h-0 w-full" viewportClassName="p-4 space-y-1 font-mono text-[11px] leading-relaxed">
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-slate-500 space-y-2">
            <Terminal className="h-8 w-8 stroke-1" />
            <p>{t.logWin.noLogs}</p>
          </div>
        ) : (
          filteredLogs.map((log, index) => {
            const timeStr = new Date(log.timestamp).toLocaleTimeString();
            let streamColor = "text-slate-300";
            let tagColor = "text-slate-500 border-slate-700 bg-slate-800/40";

            if (log.stream === "system") {
              streamColor = "text-emerald-400 font-semibold";
              tagColor = "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
            } else if (log.stream === "stderr") {
              streamColor = "text-rose-400";
              tagColor = "text-rose-400 border-rose-500/30 bg-rose-500/10";
            }

            return (
              <div
                key={`${log.timestamp}-${index}`}
                className="flex items-start gap-2 hover:bg-white/[0.03] px-1 py-0.5 rounded transition-colors group"
              >
                <span className="text-slate-600 select-none shrink-0 w-16">
                  {timeStr}
                </span>
                <span
                  className={`text-[9px] px-1 rounded border uppercase select-none shrink-0 ${tagColor}`}
                >
                  {log.stream}
                </span>
                <span className={`break-all whitespace-pre-wrap ${streamColor}`}>
                  {log.line}
                </span>
              </div>
            );
          })
        )}
        <div ref={logsEndRef} />
      </ScrollArea>
      <Toaster />
    </div>
  );
};
