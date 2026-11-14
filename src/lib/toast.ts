export type ToastKind = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

const emit = () => listeners.forEach((l) => l(items));

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Shows a non-blocking message; replaces `alert()`. Errors stay longer than confirmations. */
export function toast(message: string, kind: ToastKind = "info", durationMs?: number): void {
  const id = nextId++;
  items = [...items, { id, kind, message }].slice(-4);
  emit();
  const ttl = durationMs ?? (kind === "error" ? 15000 : 3000);
  setTimeout(() => dismissToast(id), ttl);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(items);
  return () => {
    listeners.delete(listener);
  };
}
