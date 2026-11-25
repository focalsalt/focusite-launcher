import React, { useEffect, useLayoutEffect, useState } from "react";
import { motion } from "motion/react";
import { FolderDown, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeSwatches } from "@/components/settings/ThemeSwatches";
import { themeService, ThemePack } from "@/services/themeService";
import { useI18n } from "@/i18n";

const STORAGE_KEY = "focusite_onboarding_done";

/** Window event that asks the app to show the guide again (fired from Settings). */
export const REPLAY_ONBOARDING_EVENT = "focusite:replay-onboarding";

export const isOnboardingDone = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
};

export const markOnboardingDone = () => {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* storage unavailable: the guide may show again next start */
  }
};

/** Sidebar elements the tour points at, in order. */
const TOUR_TARGETS = ["nav-item-home", "nav-item-instances", "nav-instance-list", "nav-item-settings"] as const;

interface OnboardingGuideProps {
  onCreateInstance: () => void;
  onImportInstance: () => void;
  onFinish: () => void;
}

type Stage = "intro" | "tour" | "start";

/** First-run guide shown after login: language/theme, a short UI tour, then the first instance. */
export const OnboardingGuide: React.FC<OnboardingGuideProps> = ({ onCreateInstance, onImportInstance, onFinish }) => {
  const { t, language, setLanguage } = useI18n();
  const [stage, setStage] = useState<Stage>("intro");
  const [tourIndex, setTourIndex] = useState<number>(0);
  const [themes, setThemes] = useState<ThemePack[]>([]);
  const [themeId, setThemeId] = useState<string>(() => themeService.getActiveThemeId());

  useEffect(() => {
    themeService.listThemes().then(setThemes).catch(() => {});
  }, []);

  const finish = (after?: () => void) => {
    markOnboardingDone();
    onFinish();
    after?.();
  };

  const pickTheme = (id: string) => {
    const pack = themes.find((p) => p.id === id);
    if (!pack) return;
    setThemeId(id);
    themeService.applyTheme(pack);
  };

  return (
    <>
      <Dialog open={stage === "intro"} onOpenChange={() => {}} preventBackdropClose>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-light" />
              {t.onboarding.welcomeTitle}
            </DialogTitle>
            <DialogDescription>{t.onboarding.welcomeDesc}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">{t.settings.language}</label>
            <div className="flex gap-2">
              {(
                [
                  ["zh-TW", "繁體中文 (台灣)"],
                  ["en-US", "English (US)"],
                ] as const
              ).map(([code, label]) => (
                <Button
                  key={code}
                  type="button"
                  size="sm"
                  variant={language === code ? "default" : "outline"}
                  onClick={() => setLanguage(code)}
                  className={`h-8 text-xs ${language === code ? "bg-brand text-white hover:bg-brand-light" : "border-white/10 text-slate-300"}`}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">{t.settings.theme}</label>
            <Select value={themeId} onValueChange={pickTheme}>
              <SelectTrigger>
                <SelectValue>{themes.find((p) => p.id === themeId)?.name ?? themeId}</SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {themes.map((pack) => (
                  <SelectItem key={pack.id} value={pack.id} extraRight={<ThemeSwatches pack={pack} />}>
                    {pack.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-between pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => finish()} className="text-xs text-slate-400 hover:text-white">
              {t.onboarding.skip}
            </Button>
            <Button type="button" size="sm" onClick={() => setStage("tour")} className="bg-brand text-xs font-semibold text-white hover:bg-brand-light">
              {t.onboarding.next}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {stage === "tour" && (
        <TourStep
          index={tourIndex}
          onBack={() => (tourIndex === 0 ? setStage("intro") : setTourIndex(tourIndex - 1))}
          onNext={() => (tourIndex === TOUR_TARGETS.length - 1 ? setStage("start") : setTourIndex(tourIndex + 1))}
          onSkip={() => finish()}
        />
      )}

      <Dialog open={stage === "start"} onOpenChange={() => {}} preventBackdropClose>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.onboarding.startTitle}</DialogTitle>
            <DialogDescription>{t.onboarding.startDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Button type="button" onClick={() => finish(onCreateInstance)} className="w-full justify-start gap-2 bg-brand text-xs font-semibold text-white hover:bg-brand-light">
              <Plus className="h-4 w-4" />
              {t.onboarding.createInstance}
            </Button>
            <Button type="button" variant="outline" onClick={() => finish(onImportInstance)} className="w-full justify-start gap-2 border-white/10 text-xs text-slate-200 hover:text-white">
              <FolderDown className="h-4 w-4" />
              {t.onboarding.importInstance}
            </Button>
          </div>
          <div className="flex justify-between pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setTourIndex(TOUR_TARGETS.length - 1); setStage("tour"); }} className="text-xs text-slate-400 hover:text-white">
              {t.onboarding.back}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => finish()} className="text-xs text-slate-400 hover:text-white">
              {t.onboarding.later}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

interface TourStepProps {
  index: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}

/** Dims the window, rings one sidebar element and explains it beside it. */
const TourStep: React.FC<TourStepProps> = ({ index, onBack, onNext, onSkip }) => {
  const { t } = useI18n();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = t.onboarding.tour[index];
  const total = TOUR_TARGETS.length;

  useLayoutEffect(() => {
    const measure = () => setRect(document.getElementById(TOUR_TARGETS[index])?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [index]);

  const top = rect ? Math.min(Math.max(rect.top - 8, 48), window.innerHeight - 200) : 120;
  const left = rect ? rect.right + 20 : 280;

  return (
    <div className="fixed inset-0 z-[60]">
      {rect && (
        <motion.div
          key={index}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="pointer-events-none absolute rounded-xl ring-2 ring-brand-light"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.65)",
          }}
        />
      )}
      <motion.div
        key={`card-${index}`}
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: "spring", stiffness: 450, damping: 32 }}
        className="absolute w-72 space-y-3 rounded-2xl border border-white/15 bg-slate-900 p-4 shadow-2xl"
        style={{ top, left }}
      >
        <div className="space-y-1">
          <p className="text-2xs font-semibold text-brand-light">
            {index + 1} / {total}
          </p>
          <h3 className="text-sm font-bold text-white">{step.title}</h3>
          <p className="text-xs leading-relaxed text-slate-300">{step.body}</p>
        </div>
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={onSkip} className="h-7 text-xs text-slate-400 hover:text-white">
            {t.onboarding.skip}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onBack} className="h-7 border-white/10 text-xs text-slate-200">
              {t.onboarding.back}
            </Button>
            <Button type="button" size="sm" onClick={onNext} className="h-7 bg-brand text-xs font-semibold text-white hover:bg-brand-light">
              {t.onboarding.next}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
