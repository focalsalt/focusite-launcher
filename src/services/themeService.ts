import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { accentTokens } from "@/lib/accent";

/** A theme pack from `<app data>\themes`: only `--fc-*` design tokens, no CSS. */
export interface ThemePack {
  id: string;
  name: string;
  author: string;
  description?: string;
  tokens: Record<string, string>;
}

/** What is remembered locally so the theme paints before the disk is read. */
interface ActiveTheme {
  id: string;
  tokens: Record<string, string>;
  /** The user's accent color, painted over the pack. */
  accent?: string;
}

/** Id of the built-in theme; its tokens are the defaults in theme-tokens.css. */
export const DEFAULT_THEME_ID = "minecraft";

const STORAGE_KEY = "focusite_active_theme_v2";
const LEGACY_STORAGE_KEY = "focusite_active_theme";
const TOKEN_NAME = /^--fc-[a-z0-9-]+$/;

// Names used by earlier builds map onto the packs that replaced them.
const LEGACY_IDS: Record<string, string> = {
  Minecraft: "minecraft",
  "Focusite Classic": "minecraft",
  Focusite: "focusite",
  Amethyst: "amethyst",
  "Amethyst Geode": "amethyst",
};

let appliedKeys: string[] = [];

function applyTokens(tokens: Record<string, string>): void {
  const style = document.documentElement.style;
  appliedKeys.forEach((k) => style.removeProperty(k));
  appliedKeys = [];
  for (const [key, value] of Object.entries(tokens)) {
    if (!TOKEN_NAME.test(key) || typeof value !== "string") continue;
    style.setProperty(key, value);
    appliedKeys.push(key);
  }
  document.documentElement.dataset.scheme = tokens["--fc-color-scheme"] === "light" ? "light" : "dark";
}

/** Pack tokens with the accent on top; shades derived from the primary color follow the accent. */
function effectiveTokens({ tokens, accent }: ActiveTheme): Record<string, string> {
  if (!accent) return tokens;
  const { "--fc-primary-hover": _hover, "--fc-primary-dark": _dark, ...base } = tokens;
  return { ...base, ...accentTokens(accent, tokens["--fc-bg-canvas"]) };
}

function readCached(): ActiveTheme | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as ActiveTheme;

    // Builds before theme packs stored three colors (and optional CSS, which is no longer supported).
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const old = JSON.parse(legacy);
      return {
        id: LEGACY_IDS[old.name] ?? DEFAULT_THEME_ID,
        tokens: {
          "--fc-primary": old.primaryColor,
          "--fc-highlight": old.highlightColor,
          "--fc-bg-canvas": old.canvasBg,
        },
      };
    }
  } catch (e) {
    console.warn("Failed to read theme from storage:", e);
  }
  return null;
}

/** Remembers, paints and tells the other windows. */
function activate(active: ActiveTheme): void {
  writeCached(active);
  applyTokens(effectiveTokens(active));
  emit("focusite:theme-updated", active).catch(() => {});
}

function writeCached(active: ActiveTheme): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
  } catch {
    /* storage unavailable: the theme still applies for this session */
  }
}

export const themeService = {
  getActiveThemeId: (): string => readCached()?.id ?? DEFAULT_THEME_ID,

  /** Paints the remembered theme synchronously; call before the first render to avoid a flash. */
  applyCachedTheme: (): void => {
    const cached = readCached();
    if (cached) applyTokens(effectiveTokens(cached));
  },

  listThemes: (): Promise<ThemePack[]> => invoke<ThemePack[]>("list_themes"),

  /** Switching packs drops the accent; re-applying the same pack keeps it. */
  applyTheme: (pack: ThemePack): void => {
    const cached = readCached();
    activate({ id: pack.id, tokens: pack.tokens, accent: cached?.id === pack.id ? cached.accent : undefined });
  },

  getAccent: (): string | undefined => readCached()?.accent,

  /** `undefined` returns to the pack's own colors. */
  setAccent: (accent: string | undefined): void => {
    activate({ ...(readCached() ?? { id: DEFAULT_THEME_ID, tokens: {} }), accent });
  },

  /** Writes what is on screen (pack plus accent) to a pack file that can be shared. */
  exportTheme: (destPath: string, name: string): Promise<void> => {
    const style = getComputedStyle(document.documentElement);
    const base = Object.fromEntries(
      ["--fc-primary", "--fc-highlight", "--fc-bg-canvas"].map((key) => [key, style.getPropertyValue(key).trim()]),
    );
    const cached = readCached();
    const tokens = { ...base, ...(cached ? effectiveTokens(cached) : {}) };
    return invoke("export_theme_pack", { destPath, jsonContent: JSON.stringify({ name, tokens }) });
  },

  /** Back to the built-in defaults (the stylesheet values), whatever is on disk. */
  resetToDefault: (): void => {
    activate({ id: DEFAULT_THEME_ID, tokens: {} });
  },

  /** Validates and saves a pack file into the themes folder. */
  importThemeJson: (jsonContent: string): Promise<ThemePack> =>
    invoke<ThemePack>("import_theme_pack", { jsonContent }),

  openThemesDir: (): Promise<void> => invoke("open_themes_dir"),

  /** Re-reads the active pack from disk so edits to the file show up on the next start. */
  refreshActiveFromDisk: async (): Promise<void> => {
    const id = themeService.getActiveThemeId();
    if (id === DEFAULT_THEME_ID && !readCached()) return;
    const packs = await themeService.listThemes();
    const pack = packs.find((p) => p.id === id);
    if (pack) themeService.applyTheme(pack);
  },

  initListeners: () => {
    themeService.applyCachedTheme();
    themeService.refreshActiveFromDisk().catch(() => {
      /* not running inside Tauri, or the folder is unreadable: keep the cached theme */
    });

    // Other windows (log, workshop) follow theme changes.
    const unlistenPromise = listen<ActiveTheme>("focusite:theme-updated", (event) => {
      if (!event.payload) return;
      writeCached(event.payload);
      applyTokens(effectiveTokens(event.payload));
    });

    // Ctrl+Shift+R: emergency reset to the built-in theme.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "R" || e.key === "r")) {
        e.preventDefault();
        themeService.resetToDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
      window.removeEventListener("keydown", handleKeyDown);
    };
  },
};
