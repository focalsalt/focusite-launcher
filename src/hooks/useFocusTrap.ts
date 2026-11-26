import { useEffect, useRef, type RefObject } from "react";
import { FOCUSABLE, wrapTarget } from "@/lib/focus";

/** Open traps, outermost first; only the last one reacts to keys. */
const stack: symbol[] = [];

/**
 * Keyboard behaviour of an overlay while `active`: focus moves into `ref`, Tab stays inside, Escape
 * calls `onEscape`, and focus returns to where it was afterwards. Give the container `tabIndex={-1}`.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, onEscape?: () => void) {
  const id = useRef(Symbol("focus-trap")).current;
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  // Read during render: `autoFocus` moves focus before any effect runs.
  const returnRef = useRef<HTMLElement | null>(null);
  const wasActive = useRef(false);
  if (active !== wasActive.current) {
    if (active) returnRef.current = document.activeElement as HTMLElement | null;
    wasActive.current = active;
  }

  useEffect(() => {
    if (!active) return;
    stack.push(id);
    const container = ref.current;
    const items = () =>
      Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.getClientRects().length > 0,
      );
    if (container && !container.contains(document.activeElement)) (items()[0] ?? container).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      const root = ref.current;
      if (!root || stack[stack.length - 1] !== id) return;
      const target = e.target as Element;
      if (e.key === "Escape") {
        // An open dropdown inside the overlay takes Escape first.
        if (e.defaultPrevented || root.querySelector('[role="combobox"][aria-expanded="true"]')) return;
        escapeRef.current?.();
      } else if (e.key === "Tab") {
        // Dropdown lists are portalled outside the container and handle their own keys.
        if (!root.contains(target) && target.closest('[role="listbox"]')) return;
        const list = items();
        const next = wrapTarget(list.length, list.indexOf(document.activeElement as HTMLElement), e.shiftKey);
        if (next === null) return;
        e.preventDefault();
        (list[next] ?? root).focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      stack.splice(stack.indexOf(id), 1);
      // Deferred so a StrictMode re-run does not steal focus back and forth.
      queueMicrotask(() => {
        if (stack.includes(id)) return;
        const current = document.activeElement;
        const stranded = !current || current === document.body || !!container?.contains(current);
        if (stranded && returnRef.current?.isConnected) returnRef.current.focus();
      });
    };
  }, [active, id, ref]);
}
