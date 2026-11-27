import * as React from "react";
import { MapPin } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

interface LocationConsentDialogProps {
  open: boolean;
  /** Closing the dialog any other way counts as "no". */
  onAnswer: (allow: boolean) => void;
}

/** First-launch question: may the camp use the user's coarse location for real sunrise, sunset and weather. */
export const LocationConsentDialog: React.FC<LocationConsentDialogProps> = ({ open, onAnswer }) => {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onAnswer(false)}>
      <DialogContent className="max-w-md border-white/10 bg-slate-900 text-slate-100 shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-400">
              <MapPin className="h-5 w-5" />
            </div>
            <DialogTitle className="text-base font-semibold text-slate-100">{t.location.title}</DialogTitle>
          </div>
          <DialogDescription className="mt-2 text-xs leading-relaxed text-slate-300">{t.location.body}</DialogDescription>
        </DialogHeader>
        <p className="text-2xs text-slate-400">{t.location.note}</p>
        <DialogFooter className="mt-2 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onAnswer(false)}
            className="border-white/10 bg-transparent text-xs text-slate-300 hover:bg-white/5"
          >
            {t.location.deny}
          </Button>
          <Button type="button" size="sm" onClick={() => onAnswer(true)} className="bg-brand text-xs font-medium text-on-solid hover:bg-brand-hover">
            {t.location.allow}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
