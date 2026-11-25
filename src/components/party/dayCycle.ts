import { useEffect, useState } from "react";
import { solarMcTime, type Location } from "./solar.ts";

/** Minecraft time of day: `tick` 0..24000 (0 = sunrise, 6000 = noon, 18000 = midnight) and the day count for the moon. */
export interface McTime {
  tick: number;
  day: number;
}

// Without a location the vanilla timetable is laid over the real clock: sunrise is 06:00 (tick 0), 1 tick = 3.6 s.
const SUNRISE_HOUR = 6;
const MS_PER_DAY = 86_400_000;

/**
 * Real clock to Minecraft time. With a `location` the day follows the real sun there (see solarMcTime);
 * without one, one real day is one Minecraft day and real 06:00 is Minecraft sunrise (tick 0).
 */
export const mcTimeAt = (date: Date, location?: Location | null): McTime => {
  if (location) return solarMcTime(date.getTime(), location);
  const hours = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const sinceSunrise = (((hours - SUNRISE_HOUR) % 24) + 24) % 24;
  // Days since the epoch in local time, counted from sunrise to sunrise.
  const shifted = date.getTime() - date.getTimezoneOffset() * 60_000 - SUNRISE_HOUR * 3_600_000;
  return { tick: sinceSunrise * 1000, day: Math.floor(shifted / MS_PER_DAY) };
};

/** The current Minecraft time, refreshed every 5 seconds (the sun moves about 0.08 degrees in that time). */
export const useMcTime = (location?: Location | null): McTime => {
  const [time, setTime] = useState(() => mcTimeAt(new Date(), location));
  useEffect(() => {
    const update = () => setTime(mcTimeAt(new Date(), location));
    update();
    const id = setInterval(update, 5_000);
    return () => clearInterval(id);
  }, [location]);
  return time;
};
