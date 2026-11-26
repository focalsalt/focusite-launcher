import { useEffect, useRef } from "react";
import { matchShortcut, ShortcutAction } from "@/lib/shortcuts";

/** Listens for the app-wide shortcuts. Inactive while `enabled` is false or any modal dialog is open. */
export function useGlobalShortcuts(enabled: boolean, onAction: (action: ShortcutAction) => void) {
  const latest = useRef({ enabled, onAction });
  latest.current = { enabled, onAction };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editing = !!target?.closest("input, textarea, select, [contenteditable='true']");
      const action = matchShortcut(e, editing);
      if (!action) return;
      e.preventDefault();
      if (!latest.current.enabled || document.querySelector('[aria-modal="true"]')) return;
      latest.current.onAction(action);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
