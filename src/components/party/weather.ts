import { useEffect, useState } from "react";

export type Weather = "clear" | "rain" | "snow" | "thunder";

/** WMO weather interpretation codes (as used by Open-Meteo) to Minecraft weather; fog and clouds stay clear. */
export const weatherFromWmo = (code: number): Weather => {
  if (code >= 95) return "thunder";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  return "clear";
};

const REFRESH_MS = 15 * 60_000;

const position = (): Promise<GeolocationPosition> =>
  new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { maximumAge: 60 * 60_000, timeout: 20_000 }),
  );

/**
 * The real weather where the user is. Asks the OS for the location once (the user can refuse), then polls Open-Meteo.
 * Anything failing (no permission, offline) means clear weather.
 */
export const useLocalWeather = (): Weather => {
  const [weather, setWeather] = useState<Weather>("clear");
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    let stopped = false;
    let timer = 0;
    position()
      .then((pos) => {
        // Two decimals (about 1 km) is plenty for weather and keeps the exact location off the request.
        const lat = pos.coords.latitude.toFixed(2);
        const lon = pos.coords.longitude.toFixed(2);
        const poll = async () => {
          try {
            const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code`);
            const code = (await res.json())?.current?.weather_code;
            if (!stopped && typeof code === "number") setWeather(weatherFromWmo(code));
          } catch {
            // offline: keep the last known weather
          }
          if (!stopped) timer = window.setTimeout(poll, REFRESH_MS);
        };
        void poll();
      })
      .catch(() => {});
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  return weather;
};
