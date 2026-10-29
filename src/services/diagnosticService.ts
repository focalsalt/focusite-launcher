import { invoke } from "@tauri-apps/api/core";

export interface DiagnosticResult {
  hasCrash: boolean;
  rootCauseType: string;
  summary: string;
  details: string[];
  suggestion: string;
  executionTimeMicros: number;

  // 相容歷史 snake_case 存取
  has_crash?: boolean;
  root_cause_type?: string;
  execution_time_micros?: number;
}

export const diagnosticService = {
  diagnoseLogContent: async (logContent: string): Promise<DiagnosticResult> => {
    const res = await invoke<DiagnosticResult>("diagnose_log_content", { logContent });
    return {
      ...res,
      has_crash: res.hasCrash,
      root_cause_type: res.rootCauseType,
      execution_time_micros: res.executionTimeMicros,
    };
  },

  diagnoseInstanceLog: async (instanceId: string): Promise<DiagnosticResult> => {
    const res = await invoke<DiagnosticResult>("diagnose_instance_log", { instanceId });
    return {
      ...res,
      has_crash: res.hasCrash,
      root_cause_type: res.rootCauseType,
      execution_time_micros: res.executionTimeMicros,
    };
  },
};
