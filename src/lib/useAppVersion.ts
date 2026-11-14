import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

let cachedVersion: string | null = null;

/** Running launcher version from the Tauri app metadata; empty until resolved (or in a plain browser). */
export function useAppVersion(): string {
  const [version, setVersion] = useState<string>(cachedVersion ?? "");

  useEffect(() => {
    if (cachedVersion) return;
    getVersion()
      .then((v) => {
        cachedVersion = v;
        setVersion(v);
      })
      .catch(() => {
        /* not running inside Tauri */
      });
  }, []);

  return version;
}
