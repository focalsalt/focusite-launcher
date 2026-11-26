import { currentLanguage, dictionaries, type SupportedLanguage } from "../i18n/language.ts";
import type { I18nDictionary } from "../i18n/locales/zh-TW.ts";

type ErrorKey = keyof I18nDictionary["errorText"];
type ErrorCode = keyof I18nDictionary["errorCodes"];

/** Error code the backend returns when the user cancelled a job; keep in sync with `CANCELLED_MESSAGE`. */
export const CANCELLED_CODE = "E_CANCELLED";

/** Raw error patterns mapped to short, plain messages. The first match wins. */
const FRIENDLY: [RegExp, ErrorKey][] = [
  [/error sending request|network|dns|connect|connection|offline|unreachable|無法連線/i, "network"],
  [/timed? ?out|逾時/i, "timeout"],
  [/permission|access is denied|拒絕存取|os error 5\b/i, "permission"],
  [/no space|disk full|空間不足/i, "diskFull"],
  [/hash|checksum|sha-?1|validation|verify|corrupt|驗證失敗/i, "corrupt"],
  [/keyring|credential|token|expired|unauthorized|401|403|offline play forbidden/i, "loginExpired"],
  [/http\s*(range|[45]\d\d)|status|server returned|回應錯誤/i, "server"],
  [/signal|webrtc|ice |peer|tunnel/i, "peer"],
  [/serde|json|parse|regex|expected value|invalid (type|value)/i, "badData"],
];

/** Codes that only say which step failed; the cause after them often explains more. */
const STEP_CODES = new Set<ErrorCode>([
  "E_ACCOUNT_SAVE_FAILED",
  "E_API_KEY_SAVE_FAILED",
  "E_ASSETS_DOWNLOAD_FAILED",
  "E_AUTH_FAILED",
  "E_AUTH_POLL_FAILED",
  "E_BACKGROUND_SAVE_FAILED",
  "E_BACKGROUND_TASK_FAILED",
  "E_BACKUP_FAILED",
  "E_BAD_RESPONSE",
  "E_CACHE_FAILED",
  "E_CAPE_REMOVE_FAILED",
  "E_CAPE_SET_FAILED",
  "E_CLIENT_DOWNLOAD_FAILED",
  "E_COMPATIBILITY_FAILED",
  "E_CONNECTION",
  "E_CONSOLE_WINDOW_FAILED",
  "E_CREDENTIAL_DECRYPT_FAILED",
  "E_CREDENTIAL_READ_FAILED",
  "E_CREDENTIAL_STORE_FAILED",
  "E_DATAPACKS_FOLDER_MISSING",
  "E_DATAPACKS_READ_FAILED",
  "E_DATAPACK_DELETE_FAILED",
  "E_DEPENDENCIES_FAILED",
  "E_DEVICE_LOGIN_FAILED",
  "E_DOWNLOAD_INTERRUPTED",
  "E_DOWNLOAD_URL_INVALID",
  "E_EXPORT_CREATE_FAILED",
  "E_EXPORT_FINISH_FAILED",
  "E_EXPORT_UNPACK_FAILED",
  "E_EXPORT_UNREADABLE",
  "E_EXPORT_WRITE_FAILED",
  "E_FILE_DECOMPRESS_FAILED",
  "E_FILE_OPEN_FAILED",
  "E_FILE_STORE_FAILED",
  "E_FOLDER_NOT_WRITABLE",
  "E_GAME_FOLDER_INVALID",
  "E_ICON_SAVE_FAILED",
  "E_IMAGE_DECODE_FAILED",
  "E_IMAGE_OPEN_FAILED",
  "E_IMPORT_COPY_FAILED",
  "E_IMPORT_PACK_JSON_INVALID",
  "E_IMPORT_PACK_JSON_UNREADABLE",
  "E_IMPORT_SOURCE_UNREADABLE",
  "E_IMPORT_VERSION_JSON_INVALID",
  "E_IMPORT_VERSION_JSON_UNREADABLE",
  "E_INSTANCE_CONFIG_UNREADABLE",
  "E_INSTANCE_CONFIG_WRITE_FAILED",
  "E_INSTANCE_CREATE_FAILED",
  "E_INSTANCE_DELETE_FAILED",
  "E_INSTANCE_FOLDER_UNREADABLE",
  "E_INSTANCE_LOG_UNREADABLE",
  "E_INSTANCE_RENAME_FAILED",
  "E_JAR_NOT_ARCHIVE",
  "E_JAR_OPEN_FAILED",
  "E_JAR_SAVE_FAILED",
  "E_JAR_VERSION_JSON_INVALID",
  "E_JAR_VERSION_JSON_UNREADABLE",
  "E_JAVA_DOWNLOAD_FAILED",
  "E_LAN_LISTEN_FAILED",
  "E_LIBRARIES_DOWNLOAD_FAILED",
  "E_LINK_OPEN_FAILED",
  "E_LOADER_DOWNLOAD_FAILED",
  "E_LOADER_INSTALL_FAILED",
  "E_LOADER_NO_PROFILE",
  "E_LOG_READ_FAILED",
  "E_MIGRATION_COMMIT_FAILED",
  "E_MIGRATION_CONFIG_FAILED",
  "E_MIGRATION_PLAN_FAILED",
  "E_MINECRAFT_LOGIN_FAILED",
  "E_MODS_FOLDER_CREATE_FAILED",
  "E_MODS_READ_FAILED",
  "E_MOD_DOWNLOAD_FAILED",
  "E_MOD_TOGGLE_FAILED",
  "E_MOVE_FAILED",
  "E_NEWS_BAD_DATA",
  "E_NEWS_CONNECTION_FAILED",
  "E_OFFLINE_CHECK_FAILED",
  "E_PACK_DOWNLOAD_FAILED",
  "E_PACK_PARSE_FAILED",
  "E_PACK_UNPACK_FAILED",
  "E_PACK_UNREADABLE",
  "E_PEER_ANSWER_FAILED",
  "E_PEER_CLOSE_FAILED",
  "E_PEER_FETCH_FAILED",
  "E_PEER_HANDSHAKE_FAILED",
  "E_PEER_HOST_FAILED",
  "E_PEER_INVITE_FAILED",
  "E_PEER_JOIN_FAILED",
  "E_PEER_SHARE_FAILED",
  "E_PING_BAD_RESPONSE",
  "E_PING_READ_FAILED",
  "E_PING_SEND_FAILED",
  "E_PREPARE_FAILED",
  "E_RESOURCES_READ_FAILED",
  "E_RTC_ANSWER_CREATE_FAILED",
  "E_RTC_ANSWER_FAILED",
  "E_RTC_CHANNEL_FAILED",
  "E_RTC_CONNECTION_FAILED",
  "E_RTC_LOCAL_DESCRIPTION_FAILED",
  "E_RTC_OFFER_APPLY_FAILED",
  "E_RTC_OFFER_FAILED",
  "E_RTC_PORT_RANGE",
  "E_SCREENSHOTS_READ_FAILED",
  "E_SERVERS_READ_FAILED",
  "E_SERVERS_SAVE_FAILED",
  "E_SERVER_PING_FAILED",
  "E_SERVER_RESPONSE",
  "E_SETTINGS_SAVE_FAILED",
  "E_SETTINGS_UPDATE_FAILED",
  "E_SIGNAL_ENCODE_FAILED",
  "E_SKIN_DELETE_FAILED",
  "E_SKIN_SAVE_FAILED",
  "E_SKIN_UPLOAD_FAILED",
  "E_SPAWN_FAILED",
  "E_TARGET_FOLDER_CREATE_FAILED",
  "E_TARGET_FOLDER_INVALID",
  "E_TEMP_FOLDER_CREATE_FAILED",
  "E_THEME_FOLDER_FAILED",
  "E_THEME_INVALID",
  "E_THEME_SAVE_FAILED",
  "E_VERSION_DETAIL_FAILED",
  "E_VERSION_FILE_WRITE_FAILED",
  "E_VERSION_LIST_FAILED",
  "E_WORKSHOP_CATEGORIES_FAILED",
  "E_WORKSHOP_PROJECT_FAILED",
  "E_WORKSHOP_SEARCH_FAILED",
  "E_WORKSHOP_VERSIONS_FAILED",
  "E_WORKSHOP_WINDOW_FAILED",
  "E_WORLDS_READ_FAILED",
  "E_WORLD_DELETE_FAILED",
  "E_WORLD_RENAME_FAILED",
]);

/** Codes whose detail is data the user needs (a path, a version, sizes), shown in every language. */
const DATA_CODES = new Set<ErrorCode>([
  "E_DEPENDENCY_INCOMPATIBLE",
  "E_DEPENDENCY_TOO_DEEP",
  "E_DEPENDENCY_UNRESOLVED",
  "E_DISK_FULL",
  "E_DOWNLOAD_UNTRUSTED",
  "E_EXPORT_ITEM_INVALID",
  "E_FILE_COPY_FAILED",
  "E_FILE_NAME_ILLEGAL",
  "E_FILE_READ_FAILED",
  "E_FILE_TYPE_BLOCKED",
  "E_FOLDER_CREATE_FAILED",
  "E_FOLDER_READ_FAILED",
  "E_FRAME_UNKNOWN_TYPE",
  "E_FRIEND_ACTION_UNKNOWN",
  "E_JAR_NOT_FOUND",
  "E_JAVA_UNSUPPORTED_PLATFORM",
  "E_KILL_FAILED",
  "E_LAUNCHER_LOGIN_FAILED",
  "E_LAUNCHER_SYNC_FAILED",
  "E_LINK_UNSUPPORTED",
  "E_LOADER_VERSIONS_FAILED",
  "E_MIGRATE_LOADER_UNSUPPORTED",
  "E_MIGRATION_DOWNLOAD_FAILED",
  "E_MOD_NOT_FOUND",
  "E_MOD_PLACE_FAILED",
  "E_MOVE_INSTANCE_BUSY",
  "E_MOVE_NAME_TAKEN",
  "E_NEWS_SERVER_ERROR",
  "E_PACK_NOT_FOUND",
  "E_PACK_UNSAFE_PATH",
  "E_PING_CONNECT_FAILED",
  "E_PING_CONNECT_TIMEOUT",
  "E_ROOM_SESSION_NOT_FOUND",
  "E_SYMLINK_CROSS_DRIVE",
  "E_SYMLINK_UNSUPPORTED",
  "E_THEME_TOKEN_COUNT",
  "E_THEME_TOKEN_NAME",
  "E_THEME_TOKEN_VALUE",
  "E_VERSION_NOT_FOUND",
]);

// Rust's `ctx()` helper joins a code and its cause with a full-width colon.
const CODE_PATTERN = /\bE_[A-Z_]+\b[:：]?/g;
const CHINESE = /[\u4e00-\u9fff]/;

function rawMessage(err: unknown): string {
  if (typeof err === "string") return err.trim();
  if (err instanceof Error) return err.message.trim();
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message ?? "").trim();
  }
  return "";
}

/** Translates backend text that may be an error code; other text (e.g. a server's own MOTD) is kept. */
export const localizeBackendText = (text: string): string => (/^E_[A-Z_]+/.test(text) ? toUserMessage(text) : text);

export const isCancelled = (err: unknown): boolean => rawMessage(err).includes(CANCELLED_CODE);

/**
 * The message for a backend `E_*` code, or undefined when there is none. With nested codes the last
 * (innermost) one wins.
 */
function codeMessage(raw: string, language: SupportedLanguage): string | undefined {
  const { errorCodes, errorText } = dictionaries[language];
  const code = (raw.match(CODE_PATTERN) ?? [])
    .map((match) => match.replace(/[:：]/, ""))
    .filter((name): name is ErrorCode => Object.hasOwn(errorCodes, name))
    .pop();
  if (!code) return undefined;
  const message = errorCodes[code];
  const detail = raw.replace(CODE_PATTERN, "").trim();
  const separator = language === "zh-TW" ? "：" : ": ";
  if (DATA_CODES.has(code)) return detail ? `${message}${separator}${detail}` : message;
  if (!STEP_CODES.has(code)) return message;

  const hit = FRIENDLY.find(([re]) => re.test(detail));
  if (hit) return errorText[hit[1]];
  const readable = language === "zh-TW" && CHINESE.test(detail) && detail.length <= 80;
  return readable ? `${message}${separator}${detail}` : message;
}

/**
 * Turns anything thrown by `invoke()` / `fetch()` into a short, plain message that is safe to show.
 * Backend codes and known technical errors are rewritten. Short Chinese backend messages are kept for the Chinese UI;
 * anything else falls back to the generic message.
 */
export function toUserMessage(err: unknown, fallback?: string): string {
  const language = currentLanguage();
  const text = dictionaries[language].errorText;
  const raw = rawMessage(err);
  if (raw) {
    const coded = codeMessage(raw, language);
    if (coded) return coded;
    const hit = FRIENDLY.find(([re]) => re.test(raw));
    if (hit) return text[hit[1]];
    if (language === "zh-TW" && CHINESE.test(raw) && raw.length <= 80) return raw;
  }
  return fallback ?? text.generic;
}
