import React, { useEffect, useRef, useState } from "react";
import { Copy, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/lib/toast";
import { MC_FONT_FAMILY } from "./CampScene";
import { useI18n } from "@/i18n";
import { type ChatLine, isPartyId, partyService, useParty } from "@/services/partyService";
import { getAutoShare, setAutoShare } from "@/services/worldShare";

/** Vanilla HUD text: Minecraft font, white, with the #3f3f3f drop shadow one font pixel down-right. */
const HUD_FONT = { fontFamily: MC_FONT_FAMILY, textShadow: "2px 2px 0 #3f3f3f" } as const;

const CARD = "pointer-events-auto rounded-xl border border-white/10 bg-slate-950/90 text-slate-100 shadow-lg backdrop-blur-md";
const ICON_BUTTON = "flex h-6 w-6 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40";

/** The team ID with a copy button; shown only while connected. */
export const PartyIdBadge: React.FC = () => {
  const { t } = useI18n();
  const party = useParty();
  if (party.status !== "connected" || !party.partyId) return null;
  const id = party.partyId;
  const copy = () => void navigator.clipboard.writeText(id).then(() => toast(id, "success", 1500));
  return (
    <div className={`${CARD} flex items-center gap-2 px-3 py-1.5 text-xs`}>
      <span className="text-slate-400">{t.party.partyId}</span>
      <span className="font-mono text-sm font-bold tracking-widest text-brand-light">{id}</span>
      <Tip label={t.party.copyPartyId}>
        <button type="button" onClick={copy} aria-label={t.party.copyPartyId} className={ICON_BUTTON}>
          <Copy className="h-3.5 w-3.5" />
        </button>
      </Tip>
    </div>
  );
};

const SettingRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-3 text-xs">
    <span className="min-w-0 flex-1 text-slate-200">{label}</span>
    {children}
  </div>
);

/** Team settings only: joining by ID, world sharing and leaving; or the box to join a team by ID when there is none. */
export const PartyPanel: React.FC = () => {
  const { t } = useI18n();
  const party = useParty();
  const [id, setId] = useState("");
  const [autoShare, setAuto] = useState(getAutoShare);
  const isHost = party.self !== null && party.self === party.host;

  if (party.status !== "connected") {
    const join = (e: React.FormEvent) => {
      e.preventDefault();
      if (isPartyId(id)) void partyService.join(id);
    };
    return (
      <div className={`${CARD} w-60 space-y-2 p-3`}>
        <h3 className="text-sm font-semibold">{t.party.settingsTitle}</h3>
        <p className="text-xs text-slate-400">{t.party.noParty}</p>
        <form onSubmit={join} className="flex gap-1.5">
          <Input
            value={id}
            onChange={(e) => setId(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6))}
            placeholder={t.party.joinPlaceholder}
            disabled={party.status === "connecting"}
            className="h-8 border-white/10 bg-black/30 text-xs uppercase"
          />
          <Button type="submit" size="sm" disabled={!isPartyId(id) || party.status === "connecting"} className="h-8">
            {t.party.joinParty}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className={`${CARD} w-60 space-y-2.5 p-3`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t.party.settingsTitle}</h3>
        {party.members.length > 1 && (
          <Tip label={t.party.leaveParty}>
            <button
              type="button"
              onClick={() => {
                partyService.leave();
                void partyService.create();
              }}
              aria-label={t.party.leaveParty}
              className={ICON_BUTTON}
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </Tip>
        )}
      </div>
      {isHost && (
        <SettingRow label={t.party.joinByIdToggle}>
          <Switch checked={party.joinById} onCheckedChange={(v) => partyService.setJoinById(v)} />
        </SettingRow>
      )}
      <SettingRow label={t.party.autoShare}>
        <Switch
          checked={autoShare}
          onCheckedChange={(v) => {
            setAuto(v);
            setAutoShare(v);
          }}
        />
      </SettingRow>
    </div>
  );
};

/** Chat box in the style of the game's chat: translucent black lines, a bar to type in. */
export const PartyChat: React.FC = () => {
  const { t } = useI18n();
  const party = useParty();
  const [text, setText] = useState("");
  const connected = party.status === "connected";
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [party.lines]);

  const systemText = (line: Extract<ChatLine, { kind: "system" }>): string => {
    const name = line.name ?? "";
    switch (line.code) {
      case "joined":
        return t.party.chatSystemJoined(name);
      case "left":
        return t.party.chatSystemLeft(name);
      case "host":
        return t.party.chatSystemHost(name);
      case "invited":
        return t.party.chatSystemInvited(name, line.target ?? "");
      case "joinOpen":
        return t.party.chatSystemJoinOpen;
      case "joinClosed":
        return t.party.chatSystemJoinClosed;
      case "shared":
        return t.party.chatSystemShared(name);
      case "unshared":
        return t.party.chatSystemUnshared(name);
      case "worldFailed":
        return t.party.chatSystemWorldFailed;
      default:
        return line.target ? `${t.party.chatSystemConnectFailed} [${line.target}]` : t.party.chatSystemConnectFailed;
    }
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    partyService.chat(text);
    setText("");
  };

  return (
    <div className="pointer-events-auto w-[28rem] max-w-full text-white" style={HUD_FONT}>
      <div className="mb-1 max-h-48 space-y-px overflow-y-auto">
        {party.lines.map((line) => (
          <div key={line.id} className="bg-scrim/60 px-1 text-lg leading-snug">
            {line.kind === "chat" && (
              <>
                <span className="text-slate-300">&lt;{line.name}&gt;</span> {line.text}
              </>
            )}
            {line.kind === "system" && <span className="text-warning-200">{systemText(line)}</span>}
            {line.kind === "invite" && (
              <span className="text-warning-200">
                {t.party.chatInviteLine(line.invite.fromName)}{" "}
                <button
                  type="button"
                  className="text-success-300 hover:underline"
                  onClick={() => {
                    partyService.dismissInvite(line.id);
                    void partyService.join(line.invite.party);
                  }}
                >
                  [{t.party.acceptInvite}]
                </button>{" "}
                <button type="button" className="text-danger-300 hover:underline" onClick={() => partyService.dismissInvite(line.id)}>
                  [{t.party.ignoreInvite}]
                </button>
              </span>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={send}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 256))}
          placeholder={connected ? t.party.chatPlaceholder : t.party.chatOffline}
          disabled={!connected}
          className="w-full bg-scrim/60 px-1 py-0.5 text-lg text-on-solid outline-none placeholder:text-on-solid/70"
        />
      </form>
    </div>
  );
};
