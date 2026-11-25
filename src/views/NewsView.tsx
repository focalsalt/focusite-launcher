import { slideVariants } from "@/lib/motion";
import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ExternalLink, Calendar, Image as ImageIcon, Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { NewsSubNav } from "@/types/navigation";
import { openExternal } from "@/lib/openExternal";
import { PatchNoteDialog } from "@/components/news/PatchNoteDialog";
import { newsService, LauncherNewsItem, LauncherPatchNoteItem } from "@/services/newsService";
import { toUserMessage } from "@/lib/errorMessage";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { toast } from "@/lib/toast";
import { useI18n } from "@/i18n";
import { Tip } from "@/components/ui/tooltip";

const NEWS_SUB_NAV_ORDER: Record<NewsSubNav, number> = {
  official: 0,
  changelog: 1,
  announcements: 2,
};

const PAGE_SIZE = 20;

/** Calls onVisible whenever the sentinel scrolls into view (used for infinite scroll). */
const LoadMoreSentinel: React.FC<{ onVisible: () => void }> = ({ onVisible }) => {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current();
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return <div ref={ref} className="h-8 w-full" aria-hidden />;
};

const subTabVariants = slideVariants("x", 16);

interface NewsViewProps {
  subNav: NewsSubNav;
  direction?: number;
}

export const NewsView: React.FC<NewsViewProps> = ({ subNav, direction: directionProp }) => {
  const { t } = useI18n();
  const prevNavRef = useRef<NewsSubNav>(subNav);
  const direction =
    directionProp ??
    (NEWS_SUB_NAV_ORDER[subNav] >= NEWS_SUB_NAV_ORDER[prevNavRef.current] ? 1 : -1);

  useEffect(() => {
    prevNavRef.current = subNav;
  }, [subNav]);
  const [news, setNews] = useState<LauncherNewsItem[]>([]);
  const [isLoadingNews, setIsLoadingNews] = useState<boolean>(true);

  const [patchNotes, setPatchNotes] = useState<LauncherPatchNoteItem[]>([]);
  const [isLoadingPatchNotes, setIsLoadingPatchNotes] = useState<boolean>(true);
  const [selectedPatch, setSelectedPatch] = useState<LauncherPatchNoteItem | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newsPage, setNewsPage] = useState<number>(1);
  const [newsHasMore, setNewsHasMore] = useState<boolean>(true);
  const loadingMoreNews = useRef<boolean>(false);
  const [patchVisible, setPatchVisible] = useState<number>(PAGE_SIZE);

  useEffect(() => {
    let isMounted = true;
    setLoadError(null);
    if (subNav === "official") {
      setIsLoadingNews(true);
      loadingMoreNews.current = true;
      newsService
        .getNewsArchivePage(1)
        .then((res) => {
          if (isMounted) {
            setNews(res.items);
            setNewsPage(1);
            setNewsHasMore(res.hasMore);
            setIsLoadingNews(false);
          }
          loadingMoreNews.current = false;
        })
        .catch((err) => {
          console.error("Failed to load news:", err);
          loadingMoreNews.current = false;
          if (isMounted) {
            setLoadError(toUserMessage(err, t.news.loadNewsFailed));
            setIsLoadingNews(false);
          }
        });
    } else if (subNav === "changelog") {
      setIsLoadingPatchNotes(true);
      newsService
        .getPatchNotes()
        .then((items) => {
          if (isMounted) {
            setPatchNotes(items);
            setIsLoadingPatchNotes(false);
          }
        })
        .catch((err) => {
          console.error("Failed to load patch notes:", err);
          if (isMounted) {
            setLoadError(toUserMessage(err, t.news.loadPatchFailed));
            setIsLoadingPatchNotes(false);
          }
        });
    }

    return () => {
      isMounted = false;
    };
  }, [subNav, reloadKey]);

  // Pulls the next server page when the user reaches the bottom.
  const loadMoreNews = () => {
    if (loadingMoreNews.current || !newsHasMore) return;
    loadingMoreNews.current = true;
    const next = newsPage + 1;
    newsService
      .getNewsArchivePage(next)
      .then((res) => {
        setNews((prev) => {
          const seen = new Set(prev.map((n) => n.id));
          return [...prev, ...res.items.filter((n) => !seen.has(n.id))];
        });
        setNewsPage(next);
        setNewsHasMore(res.hasMore);
      })
      .catch((err) => {
        console.error("Failed to load more news:", err);
        toast(t.errors.loadMoreNewsFailed(toUserMessage(err)), "error");
      })
      .finally(() => {
        loadingMoreNews.current = false;
      });
  };

  // Pull-to-refresh: refetch in place (keeps the current list visible instead of showing skeletons).
  const handleRefresh = async () => {
    try {
      if (subNav === "official") {
        const res = await newsService.getNewsArchivePage(1);
        setNews(res.items);
        setNewsPage(1);
        setNewsHasMore(res.hasMore);
      } else if (subNav === "changelog") {
        setPatchNotes(await newsService.getPatchNotes(true));
        setPatchVisible(PAGE_SIZE);
      } else {
        // Announcements are static for now; a short pause keeps the gesture feeling responsive.
        await new Promise((r) => setTimeout(r, 400));
      }
      setLoadError(null);
    } catch (err) {
      console.error("Failed to refresh news:", err);
      toast(toUserMessage(err, t.news.loadNewsFailed), "error");
    }
  };

  return (
    <>
    <AnimatePresence mode="popLayout" custom={direction}>
      <motion.div
        key={subNav}
        custom={direction}
        variants={subTabVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="w-full"
      >
      <PullToRefresh onRefresh={handleRefresh} className="space-y-4">
      {/* 官方新聞快訊：依寬度自適應排列，最少維持 3 欄 */}
      {subNav === "official" && (
        <div className="grid grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {isLoadingNews
            ? Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col rounded-2xl border border-white/10 bg-slate-900/60 overflow-hidden shadow-xl"
                >
                  <Skeleton className="aspect-video w-full rounded-none bg-white/10" />
                  <div className="p-3.5 flex flex-col flex-1 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-4 w-20 rounded bg-white/10" />
                      <Skeleton className="h-3 w-16 rounded bg-white/10" />
                    </div>
                    <Skeleton className="h-5 w-4/5 rounded bg-white/10" />
                    <div className="space-y-1.5 flex-1 pt-1">
                      <Skeleton className="h-3 w-full rounded bg-white/10" />
                      <Skeleton className="h-3 w-5/6 rounded bg-white/10" />
                    </div>
                    <div className="pt-2 border-t border-white/5 flex justify-end">
                      <Skeleton className="h-3.5 w-16 rounded bg-white/10" />
                    </div>
                  </div>
                </div>
              ))
            : news.map((item) => (
                <motion.article
                  key={item.id}
                  whileHover={{ y: -4 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => void openExternal(item.readMoreLink)}
                  className="group cursor-pointer flex flex-col rounded-2xl border border-white/10 bg-slate-900/60 hover:border-brand-light/50 hover:bg-slate-900/90 transition-all duration-200 overflow-hidden shadow-xl"
                >
                  {/* Hero 橫幅大圖 */}
                  <div className="relative aspect-video w-full overflow-hidden bg-slate-950 shrink-0">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-dark/30 to-slate-900">
                        <ImageIcon className="h-8 w-8 text-white/20" />
                      </div>
                    )}
                    <div className="absolute top-2.5 left-2.5">
                      <Badge
                        variant="outline"
                        className="border-black/50 bg-black/75 backdrop-blur-md text-[10px] text-white px-2 py-0.5"
                      >
                        {item.category}
                      </Badge>
                    </div>
                  </div>

                  {/* 標題與內容摘要 */}
                  <div className="p-3.5 flex flex-col flex-1 justify-between space-y-2">
                    <div className="space-y-1.5">
                      <Tip label={item.title}>
                        <h3
                          className="font-bold text-xs text-slate-100 line-clamp-2 leading-snug group-hover:text-brand-light transition-colors"
                        >
                          {item.title}
                        </h3>
                      </Tip>
                      <p className="text-[11px] text-slate-400 line-clamp-3 leading-relaxed">
                        {item.text}
                      </p>
                    </div>

                    {/* 卡片底部：日期與外部連結 */}
                    <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-500">
                      <span className="flex items-center gap-1 font-mono">
                        <Calendar className="h-3 w-3" />
                        {item.date}
                      </span>
                      <span className="inline-flex items-center gap-1 text-brand-light group-hover:underline">
                        {t.news.readFull}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </span>
                    </div>
                  </div>
                </motion.article>
              ))}
        </div>
      )}
      {subNav === "official" && !isLoadingNews && newsHasMore && (
        <LoadMoreSentinel key={newsPage} onVisible={loadMoreNews} />
      )}

      {/* 更改日誌 (Minecraft Java 官方更新歷史，依寬度自適應最少 3 欄) */}
      {subNav === "changelog" && (
        <div className="grid grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {isLoadingPatchNotes
            ? Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col rounded-2xl border border-white/10 bg-slate-900/60 overflow-hidden shadow-xl"
                >
                  <Skeleton className="aspect-video w-full rounded-none bg-white/10" />
                  <div className="p-3.5 flex flex-col flex-1 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-4 w-16 rounded bg-white/10" />
                      <Skeleton className="h-3 w-14 rounded bg-white/10" />
                    </div>
                    <Skeleton className="h-5 w-4/5 rounded bg-white/10" />
                    <div className="space-y-1.5 flex-1 pt-1">
                      <Skeleton className="h-3 w-full rounded bg-white/10" />
                      <Skeleton className="h-3 w-4/5 rounded bg-white/10" />
                    </div>
                    <div className="pt-2 border-t border-white/5 flex justify-end">
                      <Skeleton className="h-3.5 w-16 rounded bg-white/10" />
                    </div>
                  </div>
                </div>
              ))
            : patchNotes.slice(0, patchVisible).map((patch) => (
                <motion.article
                  key={patch.id}
                  whileHover={{ y: -4 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setSelectedPatch(patch)}
                  className="group cursor-pointer flex flex-col rounded-2xl border border-white/10 bg-slate-900/60 hover:border-brand-light/50 hover:bg-slate-900/90 transition-all duration-200 overflow-hidden shadow-xl"
                >
                  {/* Hero 橫幅大圖 */}
                  <div className="relative aspect-video w-full overflow-hidden bg-slate-950 shrink-0">
                    {patch.imageUrl ? (
                      <img
                        src={patch.imageUrl}
                        alt={patch.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-dark/30 to-slate-900">
                        <ImageIcon className="h-8 w-8 text-white/20" />
                      </div>
                    )}
                    <div className="absolute top-2.5 left-2.5">
                      <Badge
                        variant="outline"
                        className={
                          patch.type === "release"
                            ? "border-brand-light/50 bg-brand/85 backdrop-blur-md text-[10px] text-white px-2 py-0.5"
                            : "border-white/20 bg-black/75 backdrop-blur-md text-[10px] text-slate-300 px-2 py-0.5"
                        }
                      >
                        {patch.type === "release" ? t.common.release : t.common.snapshot}
                      </Badge>
                    </div>
                  </div>

                  {/* 標題與摘要 */}
                  <div className="p-3.5 flex flex-col flex-1 justify-between space-y-2">
                    <div className="space-y-1.5">
                      <Tip label={patch.title}>
                        <h3
                          className="font-bold text-xs text-slate-100 line-clamp-2 leading-snug group-hover:text-brand-light transition-colors"
                        >
                          {patch.title}
                        </h3>
                      </Tip>
                      {patch.snippet ? (
                        <p className="text-[11px] text-slate-400 line-clamp-3 leading-relaxed">
                          {patch.snippet}
                        </p>
                      ) : (
                        <p className="text-[11px] text-slate-500 italic">
                          {t.news.patchHint}
                        </p>
                      )}
                    </div>

                    {/* 卡片底部：版本與連結 */}
                    <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-500">
                      <span className="font-mono text-slate-400">
                        MC {patch.version}
                      </span>
                      <span className="inline-flex items-center gap-1 text-brand-light group-hover:underline">
                        {t.news.viewNotes}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </span>
                    </div>
                  </div>
                </motion.article>
              ))}
        </div>
      )}
      {subNav === "changelog" && !isLoadingPatchNotes && patchVisible < patchNotes.length && (
        <LoadMoreSentinel onVisible={() => setPatchVisible((v) => v + PAGE_SIZE)} />
      )}

      {(subNav === "official" || subNav === "changelog") &&
        !(subNav === "official" ? isLoadingNews : isLoadingPatchNotes) &&
        (subNav === "official" ? news.length === 0 : patchNotes.length === 0) && (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
            <p className="text-sm font-semibold text-slate-200">
              {loadError ? t.news.loadFailedTitle : t.news.emptyTitle}
            </p>
            <p className="text-xs text-slate-400 max-w-sm">
              {loadError ?? t.news.emptyHint}
            </p>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
            >
              {t.common.retry}
            </button>
          </div>
        )}

      {/* 啟動器快訊 (純淨空狀態，無假資料) */}
      {subNav === "announcements" && (
        <div className="flex flex-col items-center justify-center py-24 text-center select-none space-y-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-brand-light shadow-inner">
            <Megaphone className="h-7 w-7" />
          </div>
          <div className="space-y-1.5 max-w-sm">
            <h3 className="text-sm font-bold text-slate-200">
              {t.news.noAnnouncements}
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t.news.announcementsHint}
            </p>
          </div>
        </div>
      )}
      </PullToRefresh>
      </motion.div>
    </AnimatePresence>
    <PatchNoteDialog patch={selectedPatch} onClose={() => setSelectedPatch(null)} />
    </>
  );
};
