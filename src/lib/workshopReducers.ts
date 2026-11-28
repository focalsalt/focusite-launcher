import type { Env, Sort } from "@/components/workshop/FilterSidebar";
import type { WorkshopProjectSummary } from "@/services/workshopService";

export interface WorkshopFilters {
  sort: Sort;
  env: Env | null;
  gameVersion: string;
  picked: Set<string>;
}

export type WorkshopFilterAction =
  | { type: "sort"; sort: Sort }
  | { type: "env"; env: Env | null }
  | { type: "gameVersion"; gameVersion: string }
  | { type: "toggleCategory"; name: string }
  | { type: "reset"; gameVersion: string };

export const initialFilters: WorkshopFilters = { sort: "relevance", env: null, gameVersion: "", picked: new Set() };

export function filtersReducer(state: WorkshopFilters, action: WorkshopFilterAction): WorkshopFilters {
  switch (action.type) {
    case "sort":
      return { ...state, sort: action.sort };
    case "env":
      return { ...state, env: action.env };
    case "gameVersion":
      return { ...state, gameVersion: action.gameVersion };
    case "toggleCategory": {
      const picked = new Set(state.picked);
      if (!picked.delete(action.name)) picked.add(action.name);
      return { ...state, picked };
    }
    case "reset":
      // A new set on every reset, so the search effects run again.
      return { ...initialFilters, gameVersion: action.gameVersion, picked: new Set() };
  }
}

export interface SearchResults {
  projects: WorkshopProjectSummary[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
}

export type SearchResultsAction =
  | { type: "started"; offset: number }
  | { type: "loaded"; offset: number; results: WorkshopProjectSummary[]; pageSize: number }
  | { type: "failed" };

export const initialResults: SearchResults = { projects: [], isLoading: false, isLoadingMore: false, hasMore: false };

export function resultsReducer(state: SearchResults, action: SearchResultsAction): SearchResults {
  switch (action.type) {
    case "started":
      return action.offset === 0 ? { ...state, isLoading: true } : { ...state, isLoadingMore: true };
    case "loaded":
      return {
        projects: action.offset === 0 ? action.results : [...state.projects, ...action.results],
        isLoading: false,
        isLoadingMore: false,
        hasMore: action.results.length === action.pageSize,
      };
    case "failed":
      return { ...state, isLoading: false, isLoadingMore: false };
  }
}
