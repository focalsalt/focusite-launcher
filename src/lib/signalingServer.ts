/** Accepts "name.workers.dev" or a full https URL; anything else is rejected. */
export const normalizeServer = (input: string): string | null => {
  const text = input.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

/** HTTPS origin of the signaling Worker, from VITE_SIGNALING_URL in .env; null when unset or invalid. */
export const SIGNALING_SERVER = normalizeServer(import.meta.env.VITE_SIGNALING_URL ?? "");
