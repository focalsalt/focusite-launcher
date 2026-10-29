import { invoke } from "@tauri-apps/api/core";

export interface P2pSessionDto {
  sessionId: string;
  roomCode: string;
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

  // 相容歷史 snake_case 存取
  session_id?: string;
  room_code?: string;
  instance_id?: string;
  local_port?: number;
  target_port?: number;
  latency_ms?: number;
  bytes_sent?: number;
  bytes_received?: number;
  created_at?: number;
}

export interface P2pHandshakeResult {
  sessionId: string;
  success: boolean;
  latencyMs: number;
  motd: string;
  serverVersion: string;
}

const normalizeSession = (raw: any): P2pSessionDto => {
  return {
    sessionId: raw.sessionId ?? raw.session_id,
    roomCode: raw.roomCode ?? raw.room_code,
    role: raw.role,
    alias: raw.alias,
    instanceId: raw.instanceId ?? raw.instance_id,
    localPort: raw.localPort ?? raw.local_port,
    targetPort: raw.targetPort ?? raw.target_port,
    status: raw.status,
    latencyMs: raw.latencyMs ?? raw.latency_ms ?? 0,
    bytesSent: raw.bytesSent ?? raw.bytes_sent ?? 0,
    bytesReceived: raw.bytesReceived ?? raw.bytes_received ?? 0,
    createdAt: raw.createdAt ?? raw.created_at ?? Date.now(),
    // 相容
    session_id: raw.sessionId ?? raw.session_id,
    room_code: raw.roomCode ?? raw.room_code,
    instance_id: raw.instanceId ?? raw.instance_id,
    local_port: raw.localPort ?? raw.local_port,
    target_port: raw.targetPort ?? raw.target_port,
    latency_ms: raw.latencyMs ?? raw.latency_ms ?? 0,
    bytes_sent: raw.bytesSent ?? raw.bytes_sent ?? 0,
    bytes_received: raw.bytesReceived ?? raw.bytes_received ?? 0,
    created_at: raw.createdAt ?? raw.created_at ?? Date.now(),
  };
};

export const p2pService = {
  startHost: async (
    instanceId: string,
    hostPort: number,
    alias: string
  ): Promise<P2pSessionDto> => {
    const raw = await invoke<any>("start_p2p_host", {
      instanceId,
      hostPort,
      alias,
    });
    return normalizeSession(raw);
  },

  joinRoom: async (roomCode: string, alias: string): Promise<P2pSessionDto> => {
    const raw = await invoke<any>("join_p2p_room", {
      roomCode,
      alias,
    });
    return normalizeSession(raw);
  },

  stopSession: async (sessionId: string): Promise<void> => {
    await invoke("stop_p2p_session", { sessionId });
  },

  listSessions: async (): Promise<P2pSessionDto[]> => {
    const rawList = await invoke<any[]>("list_p2p_sessions");
    return rawList.map(normalizeSession);
  },

  verifyHandshake: async (sessionId: string): Promise<P2pHandshakeResult> => {
    const raw = await invoke<any>("p2p_verify_handshake", { sessionId });
    return {
      sessionId: raw.sessionId ?? raw.session_id,
      success: raw.success,
      latencyMs: raw.latencyMs ?? raw.latency_ms ?? 0,
      motd: raw.motd,
      serverVersion: raw.serverVersion ?? raw.server_version ?? "Minecraft",
    };
  },

  updateSessionAlias: async (sessionId: string, newAlias: string): Promise<P2pSessionDto> => {
    const raw = await invoke<any>("p2p_update_session_alias", { sessionId, newAlias });
    return normalizeSession(raw);
  },
};
