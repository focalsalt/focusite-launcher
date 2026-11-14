/**
 * Turns anything thrown by `invoke()` / `fetch()` into a short message that is safe to show.
 * Tauri commands reject with plain strings; network failures reject with Error objects.
 */
export function toUserMessage(err: unknown, fallback = "發生未知錯誤，請稍後再試"): string {
  let raw = "";
  if (typeof err === "string") {
    raw = err;
  } else if (err instanceof Error) {
    raw = err.message;
  } else if (err && typeof err === "object" && "message" in err) {
    raw = String((err as { message: unknown }).message ?? "");
  }

  raw = raw
    .replace(/\s*\(os error \d+\)/gi, "")
    .replace(/error sending request for url \([^)]*\)/gi, "無法連線至伺服器")
    .trim();

  if (!raw) return fallback;
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}
