import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { listenSafe } from "@/lib/listenSafe";
import { revealCurrentWindow } from "@/lib/tauriWindow";
import {
  instanceService,
  InstanceLogEvent,
  InstanceStatusEvent,
  LogFileEntry,
} from "@/services/instanceService";
import {
  diagnosticService,
  DiagnosticResult,
} from "@/services/diagnosticService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toUserMessage } from "@/lib/errorMessage";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WindowBar } from "@/components/layout/WindowBar";
import { useI18n } from "@/i18n";
import { toast } from "@/lib/toast";
import { Toaster } from "@/components/ui/Toaster";
import { SlidingIndicator, useSlidingIndicator } from "@/components/ui/sliding-indicator";

/** Keeps the newest lines in memory; older ones are dropped. */
const MAX_LOG_LINES = 10_000;
/** Incoming lines are collected for this long, so a noisy game does not re-render once per line. */
const LOG_FLUSH_MS = 80;

// Keys follow the event object, so rows stay mounted while old lines are trimmed off the front.
const rowKeys = new WeakMap<InstanceLogEvent, number>();
let nextRowKey = 0;
function rowKey(log: InstanceLogEvent) {
  let key = rowKeys.get(log);
  if (key === undefined) {
    key = nextRowKey++;
    rowKeys.set(log, key);
  }
  return key;
}

/**
 * One terminal line. Memoised so its time is formatted once; `content-visibility` lets the webview skip
 * layout and paint for off-screen rows while keeping the text selectable.
 * shortcut: all rows stay in the DOM, add a virtualizer if 10k lines still stutter.
 */
const LogRow = React.memo(function LogRow({ log, withMeta }: { log: InstanceLogEvent; withMeta: boolean }) {
  const { language } = useI18n();
  let streamColor = "text-slate-300";
  let tagColor = "text-slate-400 border-slate-700 bg-slate-800/40";

  if (log.stream === "system") {
    streamColor = "text-success-400 font-semibold";
    tagColor = "text-success-400 border-success-500/30 bg-success-500/10";
  } else if (log.stream === "stderr") {
    streamColor = "text-danger-400";
    tagColor = "text-danger-400 border-danger-500/30 bg-danger-500/10";
  }

  return (
    <div className="flex items-start gap-2 hover:bg-white/[0.03] px-1 py-0.5 rounded transition-colors group [content-visibility:auto] [contain-intrinsic-size:auto_18px]">
      {withMeta && (
        <>
          <span className="text-slate-400 select-none shrink-0 w-16">
            {new Date(log.timestamp).toLocaleTimeString(language)}
          </span>
          <span className={`text-[9px] px-1 rounded border uppercase select-none shrink-0 ${tagColor}`}>
            {log.stream}
          </span>
        </>
      )}
      <span className={`break-all whitespace-pre-wrap ${streamColor}`}>{log.line}</span>
    </div>
  );
});

export const LogWindow: React.FC = () => {
  const { t, language } = useI18n();
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
  // Lines received since the last flush.
  const pendingRef = useRef<InstanceLogEvent[]>([]);
  const flushTimerRef = useRef<number | undefined>(undefined);

  const flushLogs = useCallback(() => {
    window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = undefined;
    const batch = pendingRef.current;
    if (batch.length === 0) return;
    pendingRef.current = [];
    setLogs((prev) => {
      const next = prev.concat(batch);
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
    });
  }, []);

  // Past logs and crash reports can be browsed while the game is not running.
  const isLive = status === "running" || status === "launching";
  const [files, setFiles] = useState<LogFileEntry[]>([]);
  const [source, setSource] = useState<string>("live");
  const [historyText, setHistoryText] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  // "This session" only exists once the game has been started from here.
  const hasSession = isLive || logs.length > 0;
  const viewingHistory = !isLive && source !== "live";

  // The live view takes over as soon as the game starts.
  useEffect(() => {
    if (isLive) setSource("live");
  }, [isLive]);

  useEffect(() => {
    if (!activeInstanceId || isLive) return;
    let cancelled = false;
    instanceService
      .listInstanceLogFiles(activeInstanceId)
      .then((list) => !cancelled && setFiles(list))
      .catch((err) => console.error("Failed to list log files:", err));
    return () => {
      cancelled = true;
    };
  }, [activeInstanceId, isLive, status]);

  useEffect(() => {
    if (!viewingHistory) {
      setHistoryText(null);
      return;
    }
    const [kind, ...rest] = source.split(":");
    const name = rest.join(":");
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryText(null);
    instanceService
      .readInstanceLogFile(activeInstanceId, kind as LogFileEntry["kind"], name)
      .then((text) => !cancelled && setHistoryText(text))
      .catch((err) => !cancelled && toast(`${t.logWin.historyFailed}: ${toUserMessage(err)}`, "error"))
      .finally(() => !cancelled && setHistoryLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, viewingHistory, activeInstanceId]);

  const historyEvents = useMemo<InstanceLogEvent[]>(() => {
    if (historyText === null) return [];
    return historyText.split(/\r?\n/).map((line) => ({
      instance_id: activeInstanceId,
      timestamp: 0,
      line,
      stream: /\b(ERROR|FATAL)\b|Exception|^\s+at /.test(line) ? "stderr" : "stdout",
    }));
  }, [historyText, activeInstanceId]);
  const shownLogs = viewingHistory ? historyEvents : logs;

  const runDiagnosis = async (currentLogs = shownLogs) => {
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

  // The window is created hidden; reveal it once the first frame has painted to avoid a flash.
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => void revealCurrentWindow()));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    // Load initial in-memory buffered logs for this specific instance
    if (activeInstanceId) {
      instanceService.getInstanceLogBuffer(activeInstanceId).then((buffered) => {
        if (buffered && buffered.length > 0) {
          flushLogs();
          // Keep live events newer than the snapshot instead of overwriting them.
          const lastTs = buffered[buffered.length - 1].timestamp;
          setLogs((prev) => [...buffered, ...prev.filter((l) => l.timestamp > lastTs)]);
        }
      }).catch((err) => console.error("Failed to load buffered logs:", err));
      instanceService.getInstanceRunningStatus(activeInstanceId).then((proc) => {
        if (proc) {
          setStatus("running");
          setActivePid(proc.pid);
        }
      }).catch((err) => console.error("Failed to read running status:", err));
    }

    // Listen to real-time log events filtered by this instance
    const unlistenLog = listenSafe<InstanceLogEvent>("instance-log", (event) => {
      if (activeInstanceId && event.payload.instance_id && event.payload.instance_id !== activeInstanceId) {
        return;
      }
      pendingRef.current.push(event.payload);
      if (flushTimerRef.current === undefined) {
        flushTimerRef.current = window.setTimeout(flushLogs, LOG_FLUSH_MS);
      }
      if (!activeInstanceId && event.payload.instance_id) {
        setActiveInstanceId(event.payload.instance_id);
      }
    });

    // Listen to process status events filtered by this instance
    const unlistenStatus = listenSafe<InstanceStatusEvent>("instance-status", (event) => {
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
            flushLogs();
            setLogs((currentLogs) => {
              runDiagnosis(currentLogs);
              return currentLogs;
            });
          }, 300);
        }
      }
    });

    return () => {
      unlistenLog();
      unlistenStatus();
      flushLogs();
    };
  }, [activeInstanceId]);

  // Auto-scroll when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      // Instant: a smooth scroll falls short while off-screen row heights are still estimates.
      logsEndRef.current.scrollIntoView({ block: "end" });
    }
  }, [logs, autoScroll]);

  const handleCopyLogs = async () => {
    const text = viewingHistory
      ? shownLogs.map((l) => l.line).join("\n")
      : logs
          .map((l) => `[${new Date(l.timestamp).toLocaleTimeString(language)}] [${l.stream.toUpperCase()}] ${l.line}`)
          .join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast(t.common.copied, "success");
  };

  const handleClearLogs = () => {
    pendingRef.current = [];
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

  const filteredLogs = useMemo(() => {
    const needle = filterText.toLowerCase();
    return shownLogs.filter(
      (log) =>
        (streamFilter === "all" || log.stream === streamFilter) &&
        (!needle || log.line.toLowerCase().includes(needle))
    );
  }, [shownLogs, streamFilter, filterText]);

  return (
    <div className="flex flex-col h-screen w-screen bg-canvas text-slate-200 select-text overflow-hidden font-mono text-xs">
      {/* Frameless Window Bar with window controls */}
      <WindowBar title={t.logWin.windowTitle(activeInstanceId ? `— ${activeInstanceId}` : "")} />

      {/* Detached Window Header */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-white/10 shrink-0">
        {/* Source picker (the title is already in the window bar) */}
        <div className="flex items-center">
          {!isLive && (
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="h-8 w-56 shrink-0 text-xs" aria-label={t.logWin.sourceLabel}>
                <SelectValue>
                  {source === "live" ? (hasSession ? t.logWin.sourceLive : t.logWin.sourceLabel) : source.split(":").slice(1).join(":")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {hasSession && <SelectItem value="live">{t.logWin.sourceLive}</SelectItem>}
                {files.map((f) => (
                  <SelectItem
                    key={`${f.kind}:${f.name}`}
                    value={`${f.kind}:${f.name}`}
                    extraRight={
                      <span className={`text-3xs ${f.kind === "crash" ? "text-danger-400" : "text-slate-400"}`}>
                        {f.kind === "crash" ? t.logWin.groupCrash : t.logWin.groupLogs}
                      </span>
                    }
                  >
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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
            <Badge className="bg-warning-500/20 border-warning-500/40 text-warning-400 gap-1.5 py-0.5 px-2">
              <span className="h-2 w-2 rounded-full bg-warning-400 animate-ping" />
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
            <Badge className="bg-danger-500/20 border-danger-500/40 text-danger-400 gap-1.5 py-0.5 px-2">
              <AlertTriangle className="h-3 w-3" />
              {t.logWin.abnormalExit(exitCode ?? "N/A")}
            </Badge>
          )}

          {status === "running" && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleKill}
              className="h-7 text-xs gap-1.5 bg-danger-600 hover:bg-danger-700 text-white font-medium px-2.5"
            >
              <Square className="h-3 w-3 fill-current" />
              {t.logWin.forceStop}
            </Button>
          )}

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
            disabled={isDiagnosing || shownLogs.length === 0}
            className="h-8 text-xs gap-1.5 border-success-500/30 bg-success-500/10 text-success-400 hover:bg-success-500/20 hover:text-success-300"
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
            disabled={viewingHistory}
            onClick={handleClearLogs}
            className="h-8 text-xs gap-1.5 border-white/10 text-slate-400 hover:text-danger-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t.logWin.clear}
          </Button>
        </div>
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
              className="h-8 pl-8 text-xs bg-white/5 border-white/10 text-slate-200"
            />
          </div>
        </div>

      </div>

      {/* Crash Alert Banner */}
      {status === "crashed" && !diagnosticResult?.hasCrash && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-danger-950/60 border-b border-danger-500/30 text-danger-200 shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <XCircle className="h-4 w-4 text-danger-400 shrink-0" />
            <span>
              {t.logWin.crashNotice(exitCode)}
              {t.logWin.diagnoseHint}
            </span>
          </div>
        </div>
      )}

      {/* Structured Diagnostic Result Card */}
      {diagnosticResult && diagnosticResult.hasCrash && !dismissDiagnosis && (
        <div className="mx-4 my-2.5 p-3.5 bg-slate-900/90 border border-success-500/30 rounded-xl shadow-xl backdrop-blur-md shrink-0">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-light" />
              <span className="font-semibold text-slate-100 text-xs">
                {t.logWin.diagnoseResult}
              </span>
              <Badge className="bg-success-500/10 border-success-500/30 text-success-400 text-3xs py-0 px-1.5 font-mono">
                {((diagnosticResult.executionTimeMicros ?? 0) / 1000).toFixed(2)} ms
              </Badge>
              <Badge className="bg-warning-500/10 border-warning-500/30 text-warning-300 text-3xs py-0 px-1.5 font-mono">
                {diagnosticResult.rootCauseType}
              </Badge>
            </div>
            <button
              type="button"
              onClick={() => setDismissDiagnosis(true)}
              aria-label={t.common.close}
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
              <div className="bg-black/30 rounded-lg p-2 space-y-1 border border-white/5 font-mono text-2xs text-slate-300">
                {diagnosticResult.details.map((detail, idx) => (
                  <div key={idx} className="flex items-start gap-1.5">
                    <span className="text-success-500 select-none">•</span>
                    <span>{detail}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-start gap-2 text-warning-300/90 bg-warning-500/10 border border-warning-500/20 rounded-lg p-2 text-2xs">
              <Lightbulb className="h-4 w-4 text-warning-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <span className="font-semibold text-warning-400">{t.logWin.suggestions}</span>
                {diagnosticResult.suggestion}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Terminal Viewport (Shadcn ScrollArea, 0px 排版位移) */}
      <ScrollArea className="flex-1 min-h-0 w-full" viewportClassName="p-4 space-y-1 font-mono text-2xs leading-relaxed">
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-slate-400 space-y-2">
            <Terminal className="h-8 w-8 stroke-1" />
            <p>
              {historyLoading
                ? t.logWin.historyLoading
                : viewingHistory
                  ? t.logWin.noLogs
                  : !isLive && files.length === 0 && logs.length === 0
                    ? t.logWin.historyEmpty
                    : !isLive && logs.length === 0
                      ? t.logWin.historyHint
                      : t.logWin.noLogs}
            </p>
          </div>
        ) : (
          filteredLogs.map((log) => <LogRow key={rowKey(log)} log={log} withMeta={!viewingHistory} />)
        )}
        <div ref={logsEndRef} />
      </ScrollArea>
      <Toaster />
    </div>
  );
};
