import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ExternalLink, Calendar, Image as ImageIcon, Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { NewsSubNav } from "@/types/navigation";
import { newsService, LauncherNewsItem, LauncherPatchNoteItem } from "@/services/newsService";

const NEWS_SUB_NAV_ORDER: Record<NewsSubNav, number> = {
  official: 0,
  changelog: 1,
  announcements: 2,
};

const subTabVariants = {
  initial: (dir: number) => ({
    opacity: 0,
    x: dir * 32,
  }),
  animate: {
    opacity: 1,
    x: 0,
    transition: {
      type: "spring" as const,
      stiffness: 450,
      damping: 35,
      mass: 0.8,
    },
  },
  exit: (dir: number) => ({
    opacity: 0,
    x: -dir * 32,
    transition: {
      duration: 0.14,
    },
  }),
};

interface NewsViewProps {
  subNav: NewsSubNav;
  direction?: number;
}

export const NewsView: React.FC<NewsViewProps> = ({ subNav, direction: directionProp }) => {
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

  useEffect(() => {
    let isMounted = true;
    if (subNav === "official") {
      setIsLoadingNews(true);
      newsService
        .getNews()
        .then((items) => {
          if (isMounted) {
            setNews(items);
            setIsLoadingNews(false);
          }
        })
        .catch((err) => {
          console.error("Failed to load news:", err);
          if (isMounted) setIsLoadingNews(false);
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
          if (isMounted) setIsLoadingPatchNotes(false);
        });
    }

    return () => {
      isMounted = false;
    };
  }, [subNav]);

  return (
    <AnimatePresence mode="wait" custom={direction}>
      <motion.div
        key={subNav}
        custom={direction}
        variants={subTabVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="space-y-4 w-full"
      >
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
                  onClick={() => window.open(item.readMoreLink, "_blank", "noopener,noreferrer")}
                  className="group cursor-pointer flex flex-col rounded-2xl border border-white/10 bg-slate-900/60 hover:border-[#52A43A]/50 hover:bg-slate-900/90 transition-all duration-200 overflow-hidden shadow-xl"
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
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#2E6B1D]/30 to-slate-900">
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
                      <h3
                        className="font-bold text-xs text-slate-100 line-clamp-2 leading-snug group-hover:text-[#52A43A] transition-colors"
                        title={item.title}
                      >
                        {item.title}
                      </h3>
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
                      <span className="inline-flex items-center gap-1 text-[#52A43A] group-hover:underline">
                        閱讀完整公告
                        <ExternalLink className="h-2.5 w-2.5" />
                      </span>
                    </div>
                  </div>
                </motion.article>
              ))}
        </div>
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
            : patchNotes.map((patch) => (
                <motion.article
                  key={patch.id}
                  whileHover={{ y: -4 }}
                  transition={{ duration: 0.15 }}
                  onClick={() =>
                    window.open(
                      `https://www.minecraft.net/zh-hant/article`,
                      "_blank",
                      "noopener,noreferrer"
                    )
                  }
                  className="group cursor-pointer flex flex-col rounded-2xl border border-white/10 bg-slate-900/60 hover:border-[#52A43A]/50 hover:bg-slate-900/90 transition-all duration-200 overflow-hidden shadow-xl"
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
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#2E6B1D]/30 to-slate-900">
                        <ImageIcon className="h-8 w-8 text-white/20" />
                      </div>
                    )}
                    <div className="absolute top-2.5 left-2.5">
                      <Badge
                        variant="outline"
                        className={
                          patch.type === "release"
                            ? "border-[#52A43A]/50 bg-[#3C8527]/85 backdrop-blur-md text-[10px] text-white px-2 py-0.5"
                            : "border-white/20 bg-black/75 backdrop-blur-md text-[10px] text-slate-300 px-2 py-0.5"
                        }
                      >
                        {patch.type === "release" ? "正式版" : "快照版"}
                      </Badge>
                    </div>
                  </div>

                  {/* 標題與摘要 */}
                  <div className="p-3.5 flex flex-col flex-1 justify-between space-y-2">
                    <div className="space-y-1.5">
                      <h3
                        className="font-bold text-xs text-slate-100 line-clamp-2 leading-snug group-hover:text-[#52A43A] transition-colors"
                        title={patch.title}
                      >
                        {patch.title}
                      </h3>
                      {patch.snippet ? (
                        <p className="text-[11px] text-slate-400 line-clamp-3 leading-relaxed">
                          {patch.snippet}
                        </p>
                      ) : (
                        <p className="text-[11px] text-slate-500 italic">
                          點擊查閱此版本之詳細更新說明與修復清單。
                        </p>
                      )}
                    </div>

                    {/* 卡片底部：版本與連結 */}
                    <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-500">
                      <span className="font-mono text-slate-400">
                        MC {patch.version}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[#52A43A] group-hover:underline">
                        詳細內容
                        <ExternalLink className="h-2.5 w-2.5" />
                      </span>
                    </div>
                  </div>
                </motion.article>
              ))}
        </div>
      )}

      {/* 啟動器快訊 (純淨空狀態，無假資料) */}
      {subNav === "announcements" && (
        <div className="flex flex-col items-center justify-center py-24 text-center select-none space-y-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-[#52A43A] shadow-inner">
            <Megaphone className="h-7 w-7" />
          </div>
          <div className="space-y-1.5 max-w-sm">
            <h3 className="text-sm font-bold text-slate-200">
              目前尚無啟動器快訊
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Focusite Launcher 官方更新與公告將於此處即時發布。
            </p>
          </div>
        </div>
      )}
      </motion.div>
    </AnimatePresence>
  );
};
