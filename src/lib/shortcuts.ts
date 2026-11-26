import type { MainView } from "@/types/navigation";

/** Ctrl + digit, in the same order as the sidebar. */
export const VIEW_SHORTCUTS = ["news", "home", "instances", "settings"] as const satisfies readonly MainView[];

export type ShortcutAction =
  | { type: "navigate"; view: (typeof VIEW_SHORTCUTS)[number] }
  | { type: "launch" }
  | { type: "help" };

type KeyInput = Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "repeat">;

/** Maps a key press to a global action; `editing` means focus is in a text field. */
export function matchShortcut(e: KeyInput, editing: boolean): ShortcutAction | null {
  if (e.repeat || e.shiftKey || e.altKey || e.metaKey) return null;
  if (!e.ctrlKey) return e.key === "F1" ? { type: "help" } : null;
  if (e.key === "Enter") return editing ? null : { type: "launch" };
  const view = VIEW_SHORTCUTS[Number(e.key) - 1];
  return view ? { type: "navigate", view } : null;
}
