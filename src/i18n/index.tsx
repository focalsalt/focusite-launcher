import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { zhTW, I18nDictionary } from "./locales/zh-TW";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { currentLanguage, dictionaries, isSupportedLanguage, LANGUAGE_KEY, SupportedLanguage } from "./language";

export type { SupportedLanguage };

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
  const [language, setLanguageState] = useState<SupportedLanguage>(currentLanguage);

  const setLanguage = (lang: SupportedLanguage) => {
    localStorage.setItem(LANGUAGE_KEY, lang);
    setLanguageState(lang);
    // Broadcast to other webview windows (log-window, workshop)
    emit("focusite:language-changed", { language: lang }).catch(() => {});
  };

  // Keep <html lang> in sync for screen readers and font selection.
  useEffect(() => {
    document.documentElement.lang = language;
    // The backend writes some text itself (progress, console lines, tray, window titles).
    if (isTauri()) invoke("set_ui_language", { language }).catch(console.error);
  }, [language]);

  useEffect(() => {
    // Listen for broadcasts from other windows
    const unlistenPromise = listen<{ language: SupportedLanguage }>(
      "focusite:language-changed",
      (event) => {
        if (event.payload.language && event.payload.language !== language) {
          localStorage.setItem(LANGUAGE_KEY, event.payload.language);
          setLanguageState(event.payload.language);
        }
      }
    );

    // Listen for same-origin storage changes
    const handleStorage = (e: StorageEvent) => {
      if (e.key === LANGUAGE_KEY && e.newValue) {
        if (isSupportedLanguage(e.newValue)) {
          setLanguageState(e.newValue);
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
