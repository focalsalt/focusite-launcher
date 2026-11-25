export type Weather = "clear" | "rain" | "snow" | "thunder";

/** WMO weather interpretation codes (as used by Open-Meteo) to Minecraft weather; fog and clouds stay clear. */
export const weatherFromWmo = (code: number): Weather => {
  if (code >= 95) return "thunder";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  return "clear";
};

/** What the camp shows for the sky: Minecraft weather plus how overcast it is (0 clear .. 1 fully clouded). */
export interface LocalSky {
  weather: Weather;
  cloud: number;
}

export const CLEAR_SKY: LocalSky = { weather: "clear", cloud: 0 };

/** Open-Meteo `cloud_cover` is a percentage; anything unusable counts as clear. */
export const cloudFromPercent = (percent: unknown): number =>
  typeof percent === "number" && Number.isFinite(percent) ? Math.min(1, Math.max(0, percent / 100)) : 0;
