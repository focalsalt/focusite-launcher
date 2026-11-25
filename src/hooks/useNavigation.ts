import { useState } from "react";
import { HomeSubNav, MainView, NewsSubNav, SettingsSubNav } from "@/types/navigation";

/** Vertical order of the pages; decides which way a page transition moves. */
const VIEW_INDEX: Record<MainView, number> = {
  news: 0,
  home: 1,
  instances: 2,
  "instance-detail": 3,
  settings: 4,
  skins: 5,
};

/** +1 / -1 from the order of the views; 0 (a plain fade) when the skin manager is on either side. */
const viewDirectionFor = (from: MainView, to: MainView): number =>
  from === "skins" || to === "skins" ? 0 : VIEW_INDEX[to] > VIEW_INDEX[from] ? 1 : -1;

/** A sub navigation strip that also remembers which way the last change went. */
function useSubNav<T extends string>(order: readonly T[]) {
  const [nav, setNav] = useState<T>(order[0]);
  const [direction, setDirection] = useState<number>(1);
  const change = (next: T) => {
    if (next === nav) return;
    setDirection(order.indexOf(next) > order.indexOf(nav) ? 1 : -1);
    setNav(next);
  };
  return { nav, direction, change };
}

export function useNavigation() {
  const [currentView, setCurrentView] = useState<MainView>("home");
  const [viewDirection, setViewDirection] = useState<number>(1);
  const news = useSubNav<NewsSubNav>(["official", "changelog", "announcements"]);
  const home = useSubNav<HomeSubNav>(["overview", "p2p"]);
  const settings = useSubNav<SettingsSubNav>(["general", "privacy"]);

  /** Moves to a view even if it is already shown (the instance page is keyed by instance). */
  const showView = (view: MainView) => {
    setViewDirection(viewDirectionFor(currentView, view));
    setCurrentView(view);
  };

  const navigate = (view: MainView) => {
    if (view !== currentView) showView(view);
  };

  return { currentView, viewDirection, setViewDirection, showView, navigate, news, home, settings };
}
