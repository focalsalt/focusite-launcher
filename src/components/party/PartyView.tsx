import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import type { UserAccount } from "@/types/navigation";
import { CampScene, CampMember, MAX_PARTY } from "./CampScene";
import { useMcTime } from "./dayCycle";
import { useLocalWeather } from "./weather";

interface PartyViewProps {
  account: UserAccount | null;
}

/** Accounts whose walk-in already played since the launcher started; kept in memory only. */
const introPlayed = new Set<string>();

export const PartyView: React.FC<PartyViewProps> = ({ account }) => {
  const { t } = useI18n();
  const accountId = account?.id;
  const time = useMcTime();
  const weather = useLocalWeather();
  const [playIntro] = useState(() => !accountId || !introPlayed.has(accountId));

  useEffect(() => {
    if (accountId) introPlayed.add(accountId);
  }, [accountId]);

  const members = useMemo<CampMember[]>(
    () =>
      account
        ? [{ id: account.id, name: account.username, skinUrl: account.skinUrl, capeUrl: account.capeUrl, slim: account.skinModel === "slim", isSelf: true }]
        : [],
    [account],
  );

  return (
    <div className="relative h-full w-full">
      {/* Bleeds over the page padding (p-6 in App) so the scene reaches the content area's edges. */}
      <div className="absolute -inset-6 overflow-hidden">
        <CampScene members={members} time={time} weather={weather} playIntro={playIntro} className="absolute inset-0 h-full w-full" />
      </div>
      {/* Vanilla HUD text: Minecraft font, white, with the #3f3f3f drop shadow one font pixel down-right. */}
      <div
        className="pointer-events-none absolute left-1 top-0 text-base text-white"
        style={{ fontFamily: "Minecraft, sans-serif", textShadow: "2px 2px 0 #3f3f3f" }}
      >
        {t.party.partySize(members.length, MAX_PARTY)}
      </div>
    </div>
  );
};
