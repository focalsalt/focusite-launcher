import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { zhTW, I18nDictionary } from "./locales/zh-TW";
import { enUS } from "./locales/en-US";
import { listen, emit } from "@tauri-apps/api/event";

export type SupportedLanguage = "zh-TW" | "en-US";

const dictionaries: Record<SupportedLanguage, I18nDictionary> = {
  "zh-TW": zhTW,
  "en-US": enUS,
};

const STORAGE_KEY = "focusite_language";

interface I18nContextValue {
  language: SupportedLanguage;
  t: I18nDictionary;
  setLanguage: (lang: SupportedLanguage) => void;
}

const I18nContext = createContext<I18nContextValue>({
  language: "zh-TW",
  t: zhTW,
  setLanguage: () => {},
});

export const I18nProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<SupportedLanguage>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as SupportedLanguage | null;
    return saved === "en-US" || saved === "zh-TW" ? saved : "zh-TW";
  });

  const setLanguage = (lang: SupportedLanguage) => {
    localStorage.setItem(STORAGE_KEY, lang);
    setLanguageState(lang);
    // Broadcast to other webview windows (log-window, workshop)
    emit("focusite:language-changed", { language: lang }).catch(() => {});
  };

  // Keep <html lang> in sync for screen readers and font selection.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    // Listen for broadcasts from other windows
    const unlistenPromise = listen<{ language: SupportedLanguage }>(
      "focusite:language-changed",
      (event) => {
        if (event.payload.language && event.payload.language !== language) {
          localStorage.setItem(STORAGE_KEY, event.payload.language);
          setLanguageState(event.payload.language);
        }
      }
    );

    // Listen for same-origin storage changes
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        const next = e.newValue as SupportedLanguage;
        if (next === "zh-TW" || next === "en-US") {
          setLanguageState(next);
        }
      }
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
      window.removeEventListener("storage", handleStorage);
    };
  }, [language]);

  return (
    <I18nContext.Provider
      value={{
        language,
        t: dictionaries[language],
        setLanguage,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = (): I18nContextValue => {
  return useContext(I18nContext);
};
