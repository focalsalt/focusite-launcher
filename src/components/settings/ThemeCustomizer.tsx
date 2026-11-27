import React, { useEffect, useId, useState } from "react";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { themeService } from "@/services/themeService";
import { isHexColor } from "@/lib/accent";
import { toast } from "@/lib/toast";
import { toUserMessage } from "@/lib/errorMessage";
import { useI18n } from "@/i18n";

const currentPrimary = () => {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--fc-primary").trim();
  return isHexColor(value) ? value : "#3c8527";
};

/** Accent color on top of the active pack, and export of the result as a new pack. */
export const ThemeCustomizer: React.FC<{ themeId: string; themeName: string }> = ({ themeId, themeName }) => {
  const { t } = useI18n();
  const id = useId();
  const [accent, setAccent] = useState<string | undefined>(() => themeService.getAccent());
  const [swatch, setSwatch] = useState<string>("#3c8527");

  // Choosing another pack or restoring the default drops the accent.
  useEffect(() => {
    const stored = themeService.getAccent();
    setAccent(stored);
    setSwatch(stored ?? currentPrimary());
  }, [themeId]);

  const apply = (next: string | undefined) => {
    themeService.setAccent(next);
    setAccent(next);
    setSwatch(next ?? currentPrimary());
  };

  const exportTheme = async () => {
    try {
      const path = await saveFileDialog({
        defaultPath: `${themeId}.focusite-theme.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await themeService.exportTheme(path, themeName);
      toast(t.settings.themeExported, "success");
    } catch (err) {
      toast(toUserMessage(err), "error");
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-xs font-semibold text-slate-300">
          {t.settings.accentColor}
        </label>
        <ColorPicker id={id} label={t.settings.accentColor} value={swatch} onChange={apply} />
        {accent && (
          <Button variant="ghost" size="sm" onClick={() => apply(undefined)} className="h-8 gap-1 text-xs text-slate-400">
            <RotateCcw className="h-3.5 w-3.5" /> {t.settings.accentReset}
          </Button>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={exportTheme} className="h-8 gap-1 text-xs">
        <Download className="h-3.5 w-3.5" /> {t.settings.exportTheme}
      </Button>
    </div>
  );
};
