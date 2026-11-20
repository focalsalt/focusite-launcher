import React from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { useI18n } from "@/i18n";

export interface FriendEntry {
  id: string;
  name: string;
  online: boolean;
}

interface FriendsDrawerProps {
  open: boolean;
  onToggle: () => void;
  friends: FriendEntry[];
  loading: boolean;
  error: string | null;
}

const DRAWER_WIDTH = 256;
/** Height of the custom window bar, which stays on top and holds the window controls. */
const WINDOW_BAR_HEIGHT = 36;
const SPRING = { type: "spring", stiffness: 420, damping: 40 } as const;

/**
 * Collapsible overlay on the right edge of the whole window, laid out like the Java Edition friends list:
 * online friends first. It is portalled to body because page transitions use transforms, which would
 * otherwise make `fixed` relative to the page instead of the window.
 */
export const FriendsDrawer: React.FC<FriendsDrawerProps> = ({ open, onToggle, friends, loading, error }) => {
  const { t } = useI18n();
  const sorted = [...friends].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));

  return createPortal(
    <>
      <motion.aside
        initial={false}
        animate={{ x: open ? 0 : DRAWER_WIDTH }}
        transition={SPRING}
        style={{ width: DRAWER_WIDTH, top: WINDOW_BAR_HEIGHT }}
        className="fixed bottom-0 right-0 z-40 flex flex-col border-l border-white/10 bg-slate-950/85 backdrop-blur-md"
        aria-hidden={!open}
        inert={!open}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <Users className="h-4 w-4 text-brand-light" />
          <h3 className="text-sm font-semibold text-slate-100">{t.party.friendsCount(friends.length)}</h3>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {loading && <p className="p-2 text-xs text-slate-400">{t.party.loading}</p>}
          {error && <p className="p-2 text-xs text-rose-300">{t.party.loadFailed(error)}</p>}
          {!loading && !error && sorted.length === 0 && <p className="p-2 text-xs text-slate-500">{t.party.noFriends}</p>}
          {sorted.map((f) => (
            <div key={f.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/5">
              <PlayerAvatar username={f.name} size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-100">{f.name}</p>
                <p className={`text-[11px] ${f.online ? "text-emerald-400" : "text-slate-500"}`}>
                  {f.online ? t.party.online : t.party.offline}
                </p>
              </div>
            </div>
          ))}
        </div>
      </motion.aside>

      <motion.button
        type="button"
        initial={false}
        animate={{ x: open ? -DRAWER_WIDTH : 0 }}
        transition={SPRING}
        onClick={onToggle}
        aria-label={open ? t.party.hideFriends : t.party.showFriends}
        title={open ? t.party.hideFriends : t.party.showFriends}
        style={{ top: WINDOW_BAR_HEIGHT + 12 }}
        className="fixed right-0 z-50 flex h-9 w-7 items-center justify-center rounded-l-lg border border-r-0 border-white/10 bg-slate-950/85 text-slate-200 backdrop-blur-md hover:text-white"
      >
        {open ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </motion.button>
    </>,
    document.body,
  );
};
