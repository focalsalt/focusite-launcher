import type { DiagnosticResult } from "@/services/diagnosticService";
import type { InstanceStatusEvent } from "@/services/instanceService";

/** The game process this window follows. */
export interface LogProcess {
  status: "ready" | InstanceStatusEvent["status"];
  activePid: number | null;
  exitCode: number | null;
}

export type LogProcessAction =
  | { type: "running"; pid: number }
  | { type: "statusEvent"; event: InstanceStatusEvent };

export const initialProcess: LogProcess = { status: "ready", activePid: null, exitCode: null };

export function processReducer(state: LogProcess, action: LogProcessAction): LogProcess {
  switch (action.type) {
    case "running":
      return { ...state, status: "running", activePid: action.pid };
    case "statusEvent": {
      const { status, pid, exit_code } = action.event;
      const exited = exit_code !== undefined && exit_code !== null;
      const ended = exited && (status === "stopped" || status === "crashed");
      return {
        status,
        activePid: ended ? null : pid || state.activePid,
        exitCode: exited ? exit_code : state.exitCode,
      };
    }
  }
}

/** A past log file being read. */
export interface LogHistory {
  text: string | null;
  isLoading: boolean;
}

export type LogHistoryAction =
  | { type: "clear" }
  | { type: "started" }
  | { type: "loaded"; text: string }
  | { type: "failed" };

export const initialHistory: LogHistory = { text: null, isLoading: false };

export function historyReducer(state: LogHistory, action: LogHistoryAction): LogHistory {
  switch (action.type) {
    case "clear":
      return { ...state, text: null };
    case "started":
      return { text: null, isLoading: true };
    case "loaded":
      return { text: action.text, isLoading: false };
    case "failed":
      return { ...state, isLoading: false };
  }
}

export interface Diagnosis {
  result: DiagnosticResult | null;
  isDiagnosing: boolean;
  dismissed: boolean;
}

export type DiagnosisAction =
  | { type: "started" }
  | { type: "done"; result: DiagnosticResult }
  | { type: "failed" }
  | { type: "dismiss" };

export const initialDiagnosis: Diagnosis = { result: null, isDiagnosing: false, dismissed: false };

export function diagnosisReducer(state: Diagnosis, action: DiagnosisAction): Diagnosis {
  switch (action.type) {
    case "started":
      return { ...state, isDiagnosing: true, dismissed: false };
    case "done":
      return { ...state, result: action.result, isDiagnosing: false };
    case "failed":
      return { ...state, isDiagnosing: false };
    case "dismiss":
      return { ...state, dismissed: true };
  }
}
