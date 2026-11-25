import { invoke } from "@tauri-apps/api/core";

export interface P2pSessionDto {
  sessionId: string;
  role: "host" | "client";
  alias: string;
  instanceId?: string;
  localPort: number;
  targetPort?: number;
  status: string;
  latencyMs: number;
  bytesSent: number;
  bytesReceived: number;
  createdAt: number;
}

export interface TunnelCodeDto {
  session: P2pSessionDto;
  /** Offer code (host) or answer code (guest) to hand to the friend. */
  code: string;
}

/** A TURN relay the Worker issued; tunnels use it only when no direct connection works. */
export interface TurnServer {
  url: string;
  username?: string;
  credential?: string;
}

export const p2pService = {

  stopSession: async (sessionId: string): Promise<void> => {
    await invoke("stop_p2p_session", { sessionId });
  },

  /** Sets the files the peer may fetch through this session: sha1 hex -> local path. */
  serveFiles: async (sessionId: string, files: Record<string, string>): Promise<void> => {
    await invoke("p2p_serve_file", { sessionId, files });
  },

  /** Downloads a file the peer serves; rejects unless size and sha1 match. */
  fetchFile: async (sessionId: string, sha1: string, size: number, dest: string): Promise<void> => {
    await invoke("p2p_fetch_file", { sessionId, sha1, size, dest });
  },

  /** Host: opens a WebRTC tunnel to the local game port and returns the invite code. */
  createOffer: (instanceId: string | null, gamePort: number, alias: string, turn: TurnServer[] = []): Promise<TunnelCodeDto> =>
    invoke<TunnelCodeDto>("p2p_create_offer", { instanceId, gamePort, alias, turn }),

  /** Host: applies the friend's reply code. */
  applyAnswer: (sessionId: string, answerCode: string): Promise<P2pSessionDto> =>
    invoke<P2pSessionDto>("p2p_apply_answer", { sessionId, answerCode }),

  /** Guest: joins with the host's invite code and returns the reply code. */
  joinWithOffer: (offerCode: string, turn: TurnServer[] = [], localPort?: number): Promise<TunnelCodeDto> =>
    invoke<TunnelCodeDto>("p2p_join_with_offer", { offerCode, localPort: localPort ?? null, turn }),

  /** Starts reporting the local game's LAN world through the `lan-world` event. */
  watchLanWorld: async (): Promise<void> => {
    await invoke("lan_world_watch_start");
  },

  unwatchLanWorld: async (): Promise<void> => {
    await invoke("lan_world_watch_stop");
  },

  /** TURN relays for this account; empty when the Worker has none. */
  iceServers: (accountId: string, server: string, name: string): Promise<TurnServer[]> =>
    invoke<TurnServer[]>("party_ice_servers", { accountId, launcher: { server, name } }),
};
