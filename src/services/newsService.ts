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

export interface NewsArchivePage {
  items: LauncherNewsItem[];
  hasMore: boolean;
}

export interface LauncherPatchNoteItem {
  id: string;
  title: string;
  type: "release" | "snapshot";
  version: string;
  imageUrl: string;
  snippet: string;
  date: string;
  /** v2 feed: path of the JSON document that holds the full HTML body. */
  contentPath?: string;
  /** Legacy feed: HTML body is inlined. */
  body?: string;
}

interface RawNewsEntry {
  id?: string;
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
  shortText?: string;
  date?: string;
  contentPath?: string;
}

const MOJANG_CONTENT_ORIGIN = "https://launchercontent.mojang.com";
// The unversioned feeds are frozen (last entry 2024-01); the v2 feeds are the live ones.
const NEWS_URLS = [
  `${MOJANG_CONTENT_ORIGIN}/v2/news.json`,
  // Legacy feed: old articles that are no longer in v2.
  `${MOJANG_CONTENT_ORIGIN}/news.json`,
];
const PATCH_NOTES_URLS = [
  `${MOJANG_CONTENT_ORIGIN}/v2/javaPatchNotes.json`,
  `${MOJANG_CONTENT_ORIGIN}/javaPatchNotes.json`,
];

/** Fetches every feed in parallel and merges entries; a failing feed is skipped. Throws only if all fail. */
async function fetchMergedEntries<T>(urls: string[]): Promise<T[]> {
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} (${url})`);
      const data: { entries?: T[] } = await resp.json();
      return data.entries || [];
    })
  );
  const ok = results.filter((r): r is PromiseFulfilledResult<T[]> => r.status === "fulfilled");
  if (ok.length === 0) {
    throw new Error("all feeds failed");
  }
  return ok.flatMap((r) => r.value);
}

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

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const newsService = {
  /** Returns the full HTML body of a patch note (inline for the legacy feed, fetched for v2). */
  async getPatchNoteBody(item: LauncherPatchNoteItem): Promise<string> {
    if (item.body) return item.body;
    if (!item.contentPath) return `<p>${item.snippet}</p>`;
    const resp = await fetch(`${MOJANG_CONTENT_ORIGIN}/v2/${item.contentPath}`, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data: { body?: string } = await resp.json();
    return data.body || `<p>${item.snippet}</p>`;
  },

  /**
   * Fetches one page (24 articles, newest first) of the full minecraft.net news archive via the
   * Rust backend; pages continue back to the oldest article. Pages start at 1.
   */
  async getNewsArchivePage(page: number): Promise<NewsArchivePage> {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<NewsArchivePage>("news_fetch_archive_page", { page });
    }
    // Browser dev mode: only the launcher feed is reachable (CORS).
    const items = page === 1 ? await newsService.getNews() : [];
    return { items, hasMore: false };
  },

  /**
   * Fetches official news entries from Mojang content server.
   */
  async getNews(forceRefresh = false): Promise<LauncherNewsItem[]> {
    const now = Date.now();
    if (!forceRefresh && cachedNews && now - lastNewsFetchTime < CACHE_TTL_MS) {
      return cachedNews;
    }

    try {
      const entries = await fetchMergedEntries<RawNewsEntry>(NEWS_URLS);

      const parsed: LauncherNewsItem[] = entries.map((entry) => {
        let rawImg = entry.newsPageImage?.url || entry.playPageImage?.url || "";
        if (rawImg && rawImg.startsWith("/")) {
          rawImg = `${MOJANG_CONTENT_ORIGIN}${rawImg}`;
        }

        return {
          id: entry.id || `${entry.date}-${entry.title}`,
          title: entry.title || "Minecraft 最新快訊",
          category: entry.category || "Minecraft",
          date: entry.date || new Date().toISOString().split("T")[0],
          text: entry.text || "",
          imageUrl: rawImg,
          readMoreLink: entry.readMoreLink || "https://www.minecraft.net/zh-hant/article",
        };
      });

      // Same article can appear in both feeds: keep the first (v2) copy.
      const seen = new Set<string>();
      const unique = parsed.filter((n) => {
        const key = `${n.date}|${n.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      unique.sort((a, b) => b.date.localeCompare(a.date));
      cachedNews = unique;
      lastNewsFetchTime = now;
      return unique;
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
      const entries = await fetchMergedEntries<RawPatchNoteEntry>(PATCH_NOTES_URLS);

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
          snippet: stripHtmlToSnippet(entry.body || entry.shortText, 120),
          contentPath: entry.contentPath,
          body: entry.body,
          date: entry.date || "",
        };
      });

      const seenPatch = new Set<string>();
      const uniquePatch = parsed.filter((n) => {
        const key = n.version || n.id;
        if (seenPatch.has(key)) return false;
        seenPatch.add(key);
        return true;
      });
      uniquePatch.sort((a, b) => b.date.localeCompare(a.date));
      cachedPatchNotes = uniquePatch;
      lastPatchNotesFetchTime = now;
      return uniquePatch;
    } catch (err) {
      console.error("Failed to fetch Minecraft Java patch notes:", err);
      if (cachedPatchNotes) return cachedPatchNotes;
      return [];
    }
  },
};
