import type { JobProgress, MissingModItem, ModpackImportResult, PackInspection } from "@/services/modpackService";
import type { WorkshopProjectSummary } from "@/services/workshopService";

/** What the user is about to import. */
export interface ImportForm {
  source: "local" | "online";
  packFilePath: string;
  customName: string;
  /** Set once the user types a name, which then stops being replaced by suggestions. */
  nameTouched: boolean;
  activeProject: WorkshopProjectSummary | null;
  selectedProject: WorkshopProjectSummary | null;
  selectedVersion: { id: string; label: string } | null;
}

export type ImportFormAction =
  | { type: "source"; source: ImportForm["source"] }
  | { type: "path"; path: string }
  | { type: "browsed"; path: string; suggestedName: string }
  | { type: "name"; name: string }
  | { type: "view"; project: WorkshopProjectSummary | null }
  | { type: "pick"; project: WorkshopProjectSummary; version: { id: string; label: string } }
  | { type: "reset" };

export const initialForm: ImportForm = {
  source: "local",
  packFilePath: "",
  customName: "",
  nameTouched: false,
  activeProject: null,
  selectedProject: null,
  selectedVersion: null,
};

const suggest = (state: ImportForm, name: string) => (state.nameTouched || !name ? state.customName : name);

export function formReducer(state: ImportForm, action: ImportFormAction): ImportForm {
  switch (action.type) {
    case "source":
      return { ...state, source: action.source };
    case "path":
      return { ...state, packFilePath: action.path };
    case "browsed":
      return { ...state, packFilePath: action.path, customName: suggest(state, action.suggestedName) };
    case "name":
      return { ...state, customName: action.name, nameTouched: true };
    case "view":
      return { ...state, activeProject: action.project };
    case "pick":
      return {
        ...state,
        selectedProject: action.project,
        selectedVersion: action.version,
        customName: suggest(state, action.project.title),
      };
    case "reset":
      return initialForm;
  }
}

/** Preview of the chosen local file or folder. */
export interface Inspection {
  inspection: PackInspection | null;
  error: string;
  isInspecting: boolean;
}

export type InspectionAction =
  | { type: "clear" }
  | { type: "started" }
  | { type: "done"; inspection: PackInspection }
  | { type: "failed"; error: string };

export const initialInspection: Inspection = { inspection: null, error: "", isInspecting: false };

export function inspectionReducer(state: Inspection, action: InspectionAction): Inspection {
  switch (action.type) {
    case "clear":
      return { ...state, inspection: null, error: "" };
    case "started":
      return { ...state, isInspecting: true };
    case "done":
      return { inspection: action.inspection, error: "", isInspecting: false };
    case "failed":
      return { inspection: null, error: action.error, isInspecting: false };
  }
}

/** The import run and what it left behind. */
export interface ImportJob {
  isImporting: boolean;
  progress: JobProgress | null;
  cancelling: boolean;
  result: ModpackImportResult | null;
  missingMods: MissingModItem[];
}

export type ImportJobAction =
  | { type: "started" }
  | { type: "progress"; progress: JobProgress }
  | { type: "cancelRequested" }
  | { type: "succeeded"; result: ModpackImportResult }
  | { type: "finished" }
  | { type: "missing"; mods: MissingModItem[] }
  | { type: "reset" };

export const initialJob: ImportJob = { isImporting: false, progress: null, cancelling: false, result: null, missingMods: [] };

export function jobReducer(state: ImportJob, action: ImportJobAction): ImportJob {
  switch (action.type) {
    case "started":
      return { ...state, isImporting: true, progress: null, cancelling: false };
    case "progress":
      return { ...state, progress: action.progress };
    case "cancelRequested":
      return { ...state, cancelling: true };
    case "succeeded":
      return { ...state, result: action.result, missingMods: action.result.missingMods };
    case "finished":
      return { ...state, isImporting: false, cancelling: false };
    case "missing":
      return { ...state, missingMods: action.mods };
    case "reset":
      return { ...state, result: null, missingMods: [] };
  }
}
