import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { VIEW_SHORTCUTS } from "@/lib/shortcuts";

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The list of app-wide keyboard shortcuts, opened with F1. */
export const ShortcutsDialog: React.FC<ShortcutsDialogProps> = ({ open, onOpenChange }) => {
  const { t } = useI18n();
  const viewNames: Record<(typeof VIEW_SHORTCUTS)[number], string> = {
    news: t.shell.newsFlash,
    home: t.shell.home,
    instances: t.shell.instanceOverview,
    settings: t.shell.globalSettings,
  };
  const rows: [string, string][] = [
    ...VIEW_SHORTCUTS.map((view, i): [string, string] => [`Ctrl + ${i + 1}`, viewNames[view]]),
    ["Ctrl + Enter", t.shortcuts.launch],
    ["Ctrl + Shift + R", t.shortcuts.resetTheme],
    ["F1", t.shortcuts.title],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle className="text-base">{t.shortcuts.title}</DialogTitle>
        </DialogHeader>
        <dl className="space-y-2 text-xs">
          {rows.map(([keys, label]) => (
            <div key={keys} className="flex items-center justify-between gap-4">
              <dt className="text-slate-300">{label}</dt>
              <dd>
                <kbd className="rounded-md border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-2xs text-slate-200">
                  {keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
};
