import { slideVariants } from "@/lib/motion";
import React, { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Plus, FolderDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { HomeSubNav, MinecraftInstance, UserAccount } from "@/types/navigation";
import { useI18n } from "@/i18n";
import { PartyView } from "@/components/party/PartyView";
import { RecentQuickPlay } from "@/components/home/RecentQuickPlay";

const HOME_SUB_NAV_ORDER: Record<HomeSubNav, number> = {
  overview: 0,
  p2p: 1,
};

const subTabVariants = slideVariants("x", 16);

interface HomeViewProps {
  subNav: HomeSubNav;
  activeInstance: MinecraftInstance | null;
  onCreateInstance: () => void;
  onImportInstance?: () => void;
  direction?: number;
  instances: MinecraftInstance[];
  /** Instance ids that are launching or running; their quick-play rows are disabled. */
  busyIds: Record<string, unknown>;
  account: UserAccount | null;
  onQuickPlay?: (instanceId: string, type: "singleplayer" | "multiplayer", target: string) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  subNav,
  activeInstance,
  onCreateInstance,
  onImportInstance,
  direction: directionProp,
  instances,
  busyIds,
  account,
  onQuickPlay,
}) => {
  const { t } = useI18n();
  const prevNavRef = useRef<HomeSubNav>(subNav);
  const direction =
    directionProp ??
    (HOME_SUB_NAV_ORDER[subNav] >= HOME_SUB_NAV_ORDER[prevNavRef.current] ? 1 : -1);

  useEffect(() => {
    prevNavRef.current = subNav;
  }, [subNav]);

  return (
    <AnimatePresence mode="popLayout" initial={false} custom={direction}>
      <motion.div
        key={subNav}
        custom={direction}
        variants={subTabVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="h-full w-full"
      >
        {/* 1. 主頁總覽 (Focusite 現代化高對比儀表板) */}
        {subNav === "overview" && !activeInstance && (
          <ScrollArea className="h-full">
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-950/80 to-canvas p-8 shadow-2xl backdrop-blur-xl">
                <div className="max-w-xl space-y-3">
                  <Badge variant="outline" className="border-brand-light/40 text-brand-light">
                    {t.home.quickStart}
                  </Badge>
                  <h2 className="text-3xl font-extrabold tracking-tight text-white">
                    {t.home.noInstanceYet}
                  </h2>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {t.home.emptyIntro}
                  </p>
                </div>

                <ol className="mt-5 max-w-xl space-y-2 text-xs text-slate-300">
                  {[t.onboarding.emptyStep1, t.onboarding.emptyStep2, t.onboarding.emptyStep3].map((text, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/20 text-2xs font-bold text-brand-light">
                        {i + 1}
                      </span>
                      <span className="pt-0.5 leading-relaxed">{text}</span>
                    </li>
                  ))}
                </ol>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Button
                    size="lg"
                    onClick={onCreateInstance}
                    className="gap-2 bg-gradient-to-r from-brand to-brand-dark hover:from-brand-hover hover:to-brand-dark font-semibold text-on-solid shadow-lg shadow-brand/30"
                  >
                    <Plus className="h-5 w-5" />
                    {t.home.createFirst}
                  </Button>
                  {onImportInstance && (
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={onImportInstance}
                      className="gap-2 border-white/15 bg-white/5 font-semibold text-slate-100 hover:bg-white/10"
                    >
                      <FolderDown className="h-5 w-5" />
                      {t.onboarding.importFirst}
                    </Button>
                  )}
                </div>
              </div>
          </ScrollArea>
        )}

        {subNav === "overview" && activeInstance && (
          <RecentQuickPlay
            instances={instances}
            refreshKey={Object.keys(busyIds).filter((k) => busyIds[k]).join(",")}
            isBusy={(id) => !!busyIds[id]}
            onPlay={(id, type, target) => onQuickPlay?.(id, type, target)}
          />
        )}

        {/* 2. 區域網路共遊 */}
        {subNav === "p2p" && <PartyView account={account} />}
      </motion.div>
    </AnimatePresence>
  );
};
