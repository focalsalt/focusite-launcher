import { useEffect, useState } from "react";
import { LOCATION_SETTING_EVENT, settingsService } from "@/services/settingsService";
import type { Location } from "./solar";
import { CLEAR_SKY, cloudFromPercent, weatherFromWmo, type LocalSky } from "./weather";

const REFRESH_MS = 15 * 60_000;
const CACHE_KEY = "focusite_camp_location_v1";

const position = (): Promise<GeolocationPosition> =>
  new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("no geolocation"));
    navigator.geolocation.getCurrentPosition(resolve, reject, { maximumAge: 60 * 60_000, timeout: 20_000 });
  });

const readCache = (): Location | null => {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    return typeof c?.lat === "number" && typeof c?.lon === "number" ? { lat: c.lat, lon: c.lon } : null;
  } catch {
    return null;
  }
};

const writeCache = (loc: Location | null) => {
  try {
    if (loc) localStorage.setItem(CACHE_KEY, JSON.stringify(loc));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // storage unavailable: the location is just asked for again next time
  }
};

/**
 * Where the camp is, only while the user allows it (settings `locationEnabled`). The OS is asked once the setting is on;
 * the last coarse position is cached so the real sunrise and sunset still work offline. Null = vanilla timetable.
 */
export const useCampLocation = (): Location | null => {
  const [location, setLocation] = useState<Location | null>(null);
  useEffect(() => {
    let stopped = false;
    const apply = async () => {
      const cfg = await settingsService.getSettings().catch(() => null);
      if (stopped) return;
      if (cfg?.locationEnabled !== true) {
        writeCache(null);
        setLocation(null);
        return;
      }
      const same = (prev: Location | null, next: Location) => (prev && prev.lat === next.lat && prev.lon === next.lon ? prev : next);
      const cached = readCache();
      if (cached) setLocation((prev) => same(prev, cached));
      try {
        const pos = await position();
        // Two decimals (about 1 km) is plenty for the sun and the weather and keeps the exact location off the request.
        const here = { lat: Number(pos.coords.latitude.toFixed(2)), lon: Number(pos.coords.longitude.toFixed(2)) };
        if (stopped) return;
        writeCache(here);
        setLocation((prev) => same(prev, here));
      } catch {
        // refused or unavailable: keep the cached position, if any
      }
    };
    void apply();
    window.addEventListener(LOCATION_SETTING_EVENT, apply);
    return () => {
      stopped = true;
      window.removeEventListener(LOCATION_SETTING_EVENT, apply);
    };
  }, []);
  return location;
};

/** The real weather and cloud cover at `location`, polled from Open-Meteo. Clear when there is no location or it is offline. */
export const useLocalSky = (location: Location | null): LocalSky => {
  const [sky, setSky] = useState<LocalSky>(CLEAR_SKY);
  const lat = location?.lat;
  const lon = location?.lon;
  useEffect(() => {
    setSky(CLEAR_SKY);
    if (lat === undefined || lon === undefined) return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code,cloud_cover`);
        const current = (await res.json())?.current;
        if (!stopped && typeof current?.weather_code === "number") {
          setSky({ weather: weatherFromWmo(current.weather_code), cloud: cloudFromPercent(current.cloud_cover) });
        }
      } catch {
        // offline: keep the last known sky
      }
      if (!stopped) timer = window.setTimeout(poll, REFRESH_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [lat, lon]);
  return sky;
};
