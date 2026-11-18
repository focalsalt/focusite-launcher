/** Raw error patterns mapped to short, plain messages. The first match wins. */
const FRIENDLY: [RegExp, string][] = [
  [/error sending request|network|dns|connect|connection|offline|unreachable|無法連線/i, "無法連線，請檢查網路後再試"],
  [/timed? ?out|逾時/i, "連線逾時，請稍後再試"],
  [/permission|access is denied|拒絕存取|os error 5\b/i, "沒有權限存取檔案，請確認資料夾可寫入"],
  [/no space|disk full|空間不足/i, "磁碟空間不足"],
  [/hash|checksum|sha-?1|validation|verify|corrupt|驗證失敗/i, "檔案不完整，請重試"],
  [/keyring|credential|token|expired|unauthorized|401|403|offline play forbidden/i, "登入已過期，請重新登入"],
  [/http\s*(range|[45]\d\d)|status|server returned|回應錯誤/i, "伺服器暫時無法使用，請稍後再試"],
  [/signal|webrtc|ice |peer|tunnel/i, "連線失敗，請確認對方在線並重試"],
  [/serde|json|parse|regex|expected value|invalid (type|value)/i, "資料格式有誤，請重試"],
];

/**
 * Turns anything thrown by `invoke()` / `fetch()` into a short, plain message that is safe to show.
 * Known technical errors are rewritten; other Chinese messages are kept as-is, and anything else
 * (raw English backend text) falls back to the generic message.
 */
export function toUserMessage(err: unknown, fallback = "發生問題，請稍後再試"): string {
  let raw = "";
  if (typeof err === "string") {
    raw = err;
  } else if (err instanceof Error) {
    raw = err.message;
  } else if (err && typeof err === "object" && "message" in err) {
    raw = String((err as { message: unknown }).message ?? "");
  }
  raw = raw.trim();
  if (!raw) return fallback;

  const hit = FRIENDLY.find(([re]) => re.test(raw));
  if (hit) return hit[1];
  return /[一-鿿]/.test(raw) && raw.length <= 80 ? raw : fallback;
}
