import React, { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Image as ImageIcon, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { newsService, LauncherPatchNoteItem } from "@/services/newsService";
import { sanitizeHtml } from "@/lib/sanitizeHtml";
import { openExternal } from "@/lib/openExternal";
import { useI18n } from "@/i18n";
import { useLastValue } from "@/lib/useExitMount";

interface PatchNoteDialogProps {
  patch: LauncherPatchNoteItem | null;
  onClose: () => void;
}

export const PatchNoteDialog: React.FC<PatchNoteDialogProps> = ({ patch: patchProp, onClose }) => {
  const { t } = useI18n();
  // Keep the last patch while the dialog animates out.
  const patch = useLastValue(patchProp);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!patch) return;
    let cancelled = false;
    setHtml(null);
    setError(null);
    newsService
      .getPatchNoteBody(patch)
      .then((body) => {
        if (!cancelled) setHtml(sanitizeHtml(body, "https://launchercontent.mojang.com/"));
      })
      .catch(() => {
        if (!cancelled) setError(t.news.patchLoadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [patch]);

  // Links inside the rendered HTML must open in the system browser.
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (anchor) {
      e.preventDefault();
      void openExternal(anchor.getAttribute("href") ?? "");
    }
  };

  return (
    <Dialog open={!!patchProp} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[80vh] max-h-[85vh] max-w-2xl flex-col space-y-0 overflow-hidden border-white/10 bg-slate-900 p-0 text-white">
        {/* Always-visible close button, pinned to the top-right of the dialog */}
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="fc-dark absolute right-3 top-3 z-20 rounded-full border border-white/20 bg-scrim/60 p-1.5 text-on-solid backdrop-blur-md transition-colors hover:bg-scrim/80 hover:text-on-solid"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Hero banner */}
        <div className="relative h-44 w-full shrink-0 overflow-hidden bg-slate-950">
          {patch?.imageUrl ? (
            <img
              src={patch.imageUrl}
              alt={patch.title}
              className="h-full w-full object-cover object-center"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-dark/40 to-slate-900">
              <ImageIcon className="h-10 w-10 text-white/20" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 space-y-1.5 px-5 pb-3 pr-14">
            <Badge variant="outline" className="border-white/25 bg-scrim/60 text-3xs text-on-solid backdrop-blur-md">
              {patch?.type === "release" ? t.common.release : t.common.snapshot}
              {patch?.version ? ` · ${patch.version}` : ""}
            </Badge>
            <h2 className="text-lg font-bold leading-tight text-white drop-shadow">{patch?.title}</h2>
            {patch?.date && (
              <p className="font-mono text-2xs text-slate-300">{patch.date.slice(0, 10)}</p>
            )}
          </div>
        </div>

        {/* Scrollable release notes */}
        <ScrollArea className="min-h-0 flex-1" viewportClassName="px-5 py-4">
          {error ? (
            <p className="py-6 text-xs text-danger-300">{error}</p>
          ) : html === null ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-4 w-full bg-white/10" />
              <Skeleton className="h-4 w-5/6 bg-white/10" />
              <Skeleton className="h-4 w-4/6 bg-white/10" />
            </div>
          ) : (
            <div
              onClick={handleClick}
              className="select-text space-y-2 text-xs leading-relaxed text-slate-300 [&_a]:text-brand-light [&_a]:underline [&_code]:font-mono [&_code]:text-success-300 [&_h1]:text-sm [&_h1]:font-bold [&_h1]:text-white [&_h2]:text-sm [&_h2]:font-bold [&_h2]:text-white [&_h3]:font-semibold [&_h3]:text-slate-100 [&_img]:max-w-full [&_img]:rounded-lg [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
