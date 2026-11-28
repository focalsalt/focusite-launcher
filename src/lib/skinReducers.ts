import type { UserAccount, UserCape } from "@/types/navigation";

export type SkinModel = "default" | "slim" | "auto-detect";

/** The saved appearance and the one shown in the 3D preview. */
export interface SkinPreview {
  initialSkinUrl: string;
  initialCapeUrl: string;
  skinUrl: string;
  capeUrl: string;
  model: SkinModel;
}

export type SkinPreviewAction =
  | { type: "selectSkin"; url: string; model: SkinModel }
  | { type: "selectCape"; url: string }
  | { type: "model"; model: SkinModel }
  | { type: "reset"; model: SkinModel }
  | { type: "saved"; skinUrl: string; capeUrl: string };

export function createSkinPreview(skinUrl: string, capeUrl: string, model: SkinModel): SkinPreview {
  return { initialSkinUrl: skinUrl, initialCapeUrl: capeUrl, skinUrl, capeUrl, model };
}

export function skinPreviewReducer(state: SkinPreview, action: SkinPreviewAction): SkinPreview {
  switch (action.type) {
    case "selectSkin":
      return { ...state, skinUrl: action.url, model: action.model };
    case "selectCape":
      return { ...state, capeUrl: action.url };
    case "model":
      return { ...state, model: action.model };
    case "reset":
      return createSkinPreview(state.initialSkinUrl, state.initialCapeUrl, action.model);
    case "saved":
      return { ...state, initialSkinUrl: action.skinUrl, initialCapeUrl: action.capeUrl };
  }
}

/** Account data that Microsoft owns: capes and sign-in state. */
export interface SkinProfile {
  capes: UserCape[];
  hasValidToken: boolean;
  isRefreshing: boolean;
}

export type SkinProfileAction =
  | { type: "refreshStarted" }
  | { type: "refreshed"; account: Partial<Pick<UserAccount, "capes" | "hasValidToken">> }
  | { type: "refreshFinished" };

export function skinProfileReducer(state: SkinProfile, action: SkinProfileAction): SkinProfile {
  switch (action.type) {
    case "refreshStarted":
      return { ...state, isRefreshing: true };
    case "refreshed":
      return {
        ...state,
        capes: action.account.capes || state.capes,
        hasValidToken: action.account.hasValidToken ?? state.hasValidToken,
      };
    case "refreshFinished":
      return { ...state, isRefreshing: false };
  }
}
