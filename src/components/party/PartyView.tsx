import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import { partyService, useParty } from "@/services/partyService";
import type { UserAccount } from "@/types/navigation";
import { CampScene, CampMember, isCampReady, MAX_PARTY } from "./CampScene";
import { useMcTime } from "./dayCycle";
import { McLoadingScreen } from "./McLoadingScreen";
import { MemberDialog, ShareInfoLines } from "./MemberDialog";
import { PartyChat, PartyIdBadge, PartyPanel } from "./PartyHud";
import { useCampLocation, useLocalSky } from "./useCampEnvironment";

interface PartyViewProps {
  account: UserAccount | null;
}

/** Accounts whose walk-in already played since the launcher started; kept in memory only. */
const introPlayed = new Set<string>();

export const PartyView: React.FC<PartyViewProps> = ({ account }) => {
  const { t } = useI18n();
  const accountId = account?.id;
  const location = useCampLocation();
  const time = useMcTime(location);
  const { weather, cloud } = useLocalSky(location);
  const [playIntro] = useState(() => !accountId || !introPlayed.has(accountId));

  useEffect(() => {
    if (accountId) introPlayed.add(accountId);
  }, [accountId]);

  const party = useParty();
  const [sceneReady, setSceneReady] = useState(isCampReady);
  const [progress, setProgress] = useState(0);

  // Everyone has a party of their own: the Party ID is shown (and shared) from the start.
  // A failed attempt moves the service to "offline", which retries on its own countdown (so no loop here).
  useEffect(() => {
    if (!accountId || party.status !== "idle" || !partyService.isConfigured) return;
    void partyService.create();
  }, [accountId, party.status]);
  const members = useMemo<CampMember[]>(() => {
    if (!account) return [];
    const self: CampMember = { id: account.id, name: account.username, skinUrl: account.skinUrl, capeUrl: account.capeUrl, slim: account.skinModel === "slim", isSelf: true };
    // Other members show the default skin: their skins are not fetched yet.
    const others = party.members.filter((m) => m.id !== account.id).map<CampMember>((m) => ({ id: m.id, name: m.name }));
    const nameOf = (id: string) => party.members.find((m) => m.id === id)?.name ?? "";
    // The tag under a name: who a member plays with, or that they share a world; the host's name is yellow.
    return [self, ...others]
      .map((m) => {
        const info = party.members.find((p) => p.id === m.id);
        const subtitle = info?.playing ? t.party.playingWith(nameOf(info.playing)) : party.shares.some((x) => x.by === m.id) ? t.party.sharingWorld : undefined;
        return { ...m, host: m.id === party.host, subtitle };
      })
      .slice(0, MAX_PARTY);
  }, [account, party.members, party.shares, party.host, t]);

  // Pointing at a member who shares a world outlines them and shows the world; clicking opens the member dialog.
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const hoveredShare = hover ? party.shares.find((x) => x.by === hover.id) : undefined;
  const glowId = hoveredShare && hover && hover.id !== party.self ? hover.id : null;
  const isHost = party.self !== null && party.self === party.host;
  const pick = (id: string) => {
    if (id !== party.self && (isHost || party.shares.some((x) => x.by === id))) setPicked(id);
  };

  return (
    <div className="fc-dark relative h-full w-full">
      {/* Bleeds over the page padding (p-6 in App) so the scene reaches the content area's edges. */}
      <div className="absolute -inset-6 overflow-hidden">
        <CampScene members={members} time={time} weather={weather} cloud={cloud} playIntro={playIntro} glowId={glowId} onHoverMember={(id, x, y) => setHover(id ? { id, x, y } : null)} onPickMember={pick} onReady={() => setSceneReady(true)} onProgress={setProgress} className="absolute inset-0 h-full w-full" />
        {/* Inside the scene's own box so it always covers exactly what the scene covers, also while resizing. */}
        <McLoadingScreen title={t.party.loadingWorld} variant="world" visible={!sceneReady} progress={progress} />
        <McLoadingScreen
          title={t.party.connectingParty}
          variant="realms"
          visible={sceneReady && party.status === "connecting" && party.joining}
        />
        <McLoadingScreen
          title={t.party.offlineRetry(party.retryIn)}
          variant="offline"
          visible={sceneReady && party.status === "offline"}
        />
      </div>
      <div className="pointer-events-none absolute left-1 top-1">
        <PartyIdBadge />
      </div>
      <div className="pointer-events-none absolute right-1 top-1">
        <PartyPanel />
      </div>
      {glowId && hoveredShare && hover && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-white/10 bg-slate-950/90 px-3 py-2 shadow-lg backdrop-blur-md"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <ShareInfoLines share={hoveredShare} />
        </div>
      )}
      <MemberDialog memberId={picked} onClose={() => setPicked(null)} />
      <div className="pointer-events-none absolute bottom-1 left-1">
        <PartyChat />
      </div>
    </div>
  );
};
