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

export interface P2pHandshakeResult {
  sessionId: string;
  success: boolean;
  latencyMs: number;
  motd: string;
  serverVersion: string;
}

export interface TunnelCodeDto {
  session: P2pSessionDto;
  /** Offer code (host) or answer code (guest) to hand to the friend. */
  code: string;
}

export const p2pService = {
  startHost: (instanceId: string, hostPort: number, alias: string): Promise<P2pSessionDto> =>
    invoke<P2pSessionDto>("start_p2p_host", { instanceId, hostPort, alias }),

  stopSession: async (sessionId: string): Promise<void> => {
    await invoke("stop_p2p_session", { sessionId });
  },

  listSessions: (): Promise<P2pSessionDto[]> => invoke<P2pSessionDto[]>("list_p2p_sessions"),

  /** The handshake result is serialized with snake_case field names by the Rust crate. */
  verifyHandshake: async (sessionId: string): Promise<P2pHandshakeResult> => {
    const raw = await invoke<{
      session_id: string;
      success: boolean;
      latency_ms: number;
      motd: string;
      server_version: string;
    }>("p2p_verify_handshake", { sessionId });
    return {
      sessionId: raw.session_id,
      success: raw.success,
      latencyMs: raw.latency_ms,
      motd: raw.motd,
      serverVersion: raw.server_version,
    };
  },

  /** Host: opens a WebRTC tunnel to the local game port and returns the invite code. */
  createOffer: (instanceId: string | null, gamePort: number, alias: string): Promise<TunnelCodeDto> =>
    invoke<TunnelCodeDto>("p2p_create_offer", { instanceId, gamePort, alias }),

  /** Host: applies the friend's reply code. */
  applyAnswer: (sessionId: string, answerCode: string): Promise<P2pSessionDto> =>
    invoke<P2pSessionDto>("p2p_apply_answer", { sessionId, answerCode }),

  /** Guest: joins with the host's invite code and returns the reply code. */
  joinWithOffer: (offerCode: string, localPort?: number): Promise<TunnelCodeDto> =>
    invoke<TunnelCodeDto>("p2p_join_with_offer", { offerCode, localPort: localPort ?? null }),

  /** Whether Windows Firewall already allows this app (always true elsewhere). */
  firewallStatus: (): Promise<boolean> => invoke<boolean>("p2p_firewall_status"),

  /** Creates the firewall rule; Windows shows one administrator prompt. */
  firewallSetup: async (): Promise<void> => {
    await invoke("p2p_firewall_setup");
  },
};
