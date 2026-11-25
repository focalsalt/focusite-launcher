import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "motion/react";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { I18nProvider } from "./i18n";
import "./index.css";
import { themeService } from "./services/themeService";

// Paint the remembered theme before the first render to avoid a color flash.
themeService.applyCachedTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <MotionConfig reducedMotion="user">
          <App />
        </MotionConfig>
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
