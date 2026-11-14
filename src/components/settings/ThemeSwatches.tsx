import React from "react";
import type { ThemePack } from "@/services/themeService";

/** Primary / highlight / canvas colors of a pack, shown on the right of its dropdown row. */
export const ThemeSwatches: React.FC<{ pack: ThemePack }> = ({ pack }) => (
  <span className="flex items-center gap-1">
    {["--fc-primary", "--fc-highlight", "--fc-bg-canvas"].map((token) => (
      <span
        key={token}
        className="h-3.5 w-3.5 rounded-full border border-white/20"
        style={{ backgroundColor: pack.tokens[token] ?? "transparent" }}
      />
    ))}
  </span>
);
