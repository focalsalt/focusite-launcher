import { zhTW, type I18nDictionary } from "./locales/zh-TW.ts";
import { enUS } from "./locales/en-US.ts";

export type SupportedLanguage = "zh-TW" | "en-US";

export const dictionaries: Record<SupportedLanguage, I18nDictionary> = {
  "zh-TW": zhTW,
  "en-US": enUS,
};

export const LANGUAGE_KEY = "focusite_language";

export const isSupportedLanguage = (value: unknown): value is SupportedLanguage =>
  value === "zh-TW" || value === "en-US";

/** The saved choice, or the system language when there is none. Usable outside React. */
export function currentLanguage(): SupportedLanguage {
  const saved = localStorage.getItem(LANGUAGE_KEY);
  if (isSupportedLanguage(saved)) return saved;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-TW" : "en-US";
}
