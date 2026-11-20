import { useEffect, useState } from "react";

/** Minecraft time of day: `tick` 0..24000 (0 = sunrise, 6000 = noon, 18000 = midnight) and the day count for the moon. */
export interface McTime {
  tick: number;
  day: number;
}

// shortcut: fixed 06:00 sunrise instead of the real one, which needs the user's location; compute it when a location source exists.
const SUNRISE_HOUR = 6;
const MS_PER_DAY = 86_400_000;

/** Real clock to Minecraft time: one real day is one Minecraft day, and real 06:00 is Minecraft sunrise (tick 0). */
export const mcTimeAt = (date: Date): McTime => {
  const hours = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const sinceSunrise = (((hours - SUNRISE_HOUR) % 24) + 24) % 24;
  // Days since the epoch in local time, counted from sunrise to sunrise.
  const shifted = date.getTime() - date.getTimezoneOffset() * 60_000 - SUNRISE_HOUR * 3_600_000;
  return { tick: sinceSunrise * 1000, day: Math.floor(shifted / MS_PER_DAY) };
};

/** The current Minecraft time, refreshed every 5 seconds (the sun moves about 0.08 degrees in that time). */
export const useMcTime = (): McTime => {
  const [time, setTime] = useState(() => mcTimeAt(new Date()));
  useEffect(() => {
    const id = setInterval(() => setTime(mcTimeAt(new Date())), 5_000);
    return () => clearInterval(id);
  }, []);
  return time;
};
