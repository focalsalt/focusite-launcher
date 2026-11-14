/** What one member's connection data asks this computer to do. Pure, so the trust rules can be tested. */
export type SignalAction =
  | { type: "make-offer" }
  | { type: "accept-offer"; code: string }
  | { type: "apply-answer"; session: string; code: string }
  | { type: "ignore" };

export interface SignalState {
  /** This computer currently shares a world into the group. */
  sharing: boolean;
  /** This computer asked that member to host and is waiting for the offer. */
  waitingForOffer: boolean;
  /** Tunnel session already opened for that member as host, if any. */
  hostedSession: string | undefined;
  /** A previous message from the same member is still being handled. */
  busy: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * - `join` is honoured only while sharing (a host never opens a tunnel nobody can use).
 * - `offer` is honoured only after this computer asked for it (nobody can push a tunnel onto it).
 * - `answer` is honoured only for a tunnel this computer offered.
 * - A second message from the same member while the first is still running is dropped.
 */
export const decideSignal = (state: SignalState, data: unknown): SignalAction => {
  if (state.busy || !isRecord(data)) return { type: "ignore" };
  const code = typeof data.code === "string" ? data.code : null;
  if (data.kind === "join" && state.sharing) return { type: "make-offer" };
  if (data.kind === "offer" && code && state.waitingForOffer) return { type: "accept-offer", code };
  if (data.kind === "answer" && code && state.hostedSession) {
    return { type: "apply-answer", session: state.hostedSession, code };
  }
  return { type: "ignore" };
};
