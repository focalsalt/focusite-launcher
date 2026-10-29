//! Live Mojang Official Launcher News and Java Patch Notes service fetching from Mojang content servers.

export interface LauncherNewsItem {
  id: string;
  title: string;
  category: string;
  date: string;
  text: string;
  imageUrl: string;
  readMoreLink: string;
}

export interface LauncherPatchNoteItem {
  id: string;
  title: string;
  type: "release" | "snapshot";
  version: string;
  imageUrl: string;
  snippet: string;
}

interface RawNewsEntry {
  id: string;
  title: string;
  category?: string;
  date: string;
  text: string;
  newsPageImage?: {
    url?: string;
    title?: string;
  };
  playPageImage?: {
    url?: string;
    title?: string;
  };
  readMoreLink?: string;
  newsType?: string[];
}

interface RawNewsResponse {
  entries: RawNewsEntry[];
  version?: number;
}

interface RawPatchNoteEntry {
  id: string;
  title: string;
  type?: "release" | "snapshot";
  version?: string;
  image?: {
    url?: string;
    title?: string;
  };
  body?: string;
  contentPath?: string;
}

interface RawPatchNotesResponse {
  entries: RawPatchNoteEntry[];
  version?: number;
}

const MOJANG_CONTENT_ORIGIN = "https://launchercontent.mojang.com";

let cachedNews: LauncherNewsItem[] | null = null;
let lastNewsFetchTime = 0;

let cachedPatchNotes: LauncherPatchNoteItem[] | null = null;
let lastPatchNotesFetchTime = 0;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

function stripHtmlToSnippet(html?: string, maxLength = 120): string {
  if (!html) return "";
  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

export const newsService = {
  /**
   * Fetches official news entries from Mojang content server.
   */
  async getNews(forceRefresh = false): Promise<LauncherNewsItem[]> {
    const now = Date.now();
    if (!forceRefresh && cachedNews && now - lastNewsFetchTime < CACHE_TTL_MS) {
      return cachedNews;
    }

    try {
      const resp = await fetch(`${MOJANG_CONTENT_ORIGIN}/news.json`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const data: RawNewsResponse = await resp.json();
      const entries = data.entries || [];

      const parsed: LauncherNewsItem[] = entries.map((entry) => {
        let rawImg = entry.newsPageImage?.url || entry.playPageImage?.url || "";
        if (rawImg && rawImg.startsWith("/")) {
          rawImg = `${MOJANG_CONTENT_ORIGIN}${rawImg}`;
        }

        return {
          id: entry.id || Math.random().toString(36).substring(2),
          title: entry.title || "Minecraft 最新快訊",
          category: entry.category || "Minecraft",
          date: entry.date || new Date().toISOString().split("T")[0],
          text: entry.text || "",
          imageUrl: rawImg,
          readMoreLink: entry.readMoreLink || "https://www.minecraft.net/zh-hant/article",
        };
      });

      cachedNews = parsed;
      lastNewsFetchTime = now;
      return parsed;
    } catch (err) {
      console.error("Failed to fetch official Minecraft news:", err);
      if (cachedNews) return cachedNews;
      return [];
    }
  },

  /**
   * Fetches official Minecraft Java edition patch notes from Mojang content server.
   */
  async getPatchNotes(forceRefresh = false): Promise<LauncherPatchNoteItem[]> {
    const now = Date.now();
    if (!forceRefresh && cachedPatchNotes && now - lastPatchNotesFetchTime < CACHE_TTL_MS) {
      return cachedPatchNotes;
    }

    try {
      const resp = await fetch(`${MOJANG_CONTENT_ORIGIN}/javaPatchNotes.json`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const data: RawPatchNotesResponse = await resp.json();
      const entries = data.entries || [];

      const parsed: LauncherPatchNoteItem[] = entries.map((entry) => {
        let rawImg = entry.image?.url || "";
        if (rawImg && rawImg.startsWith("/")) {
          rawImg = `${MOJANG_CONTENT_ORIGIN}${rawImg}`;
        }

        return {
          id: entry.id || Math.random().toString(36).substring(2),
          title: entry.title || `Minecraft ${entry.version || ""}`,
          type: entry.type === "release" ? "release" : "snapshot",
          version: entry.version || "",
          imageUrl: rawImg,
          snippet: stripHtmlToSnippet(entry.body, 120),
        };
      });

      cachedPatchNotes = parsed;
      lastPatchNotesFetchTime = now;
      return parsed;
    } catch (err) {
      console.error("Failed to fetch Minecraft Java patch notes:", err);
      if (cachedPatchNotes) return cachedPatchNotes;
      return [];
    }
  },
};
