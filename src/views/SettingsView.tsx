import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { slideVariants } from "@/lib/motion";
import type { SettingsSubNav } from "@/types/navigation";
import {
  DownloadCloud,
  ShieldCheck,
  Info,
  Key,
  AlertTriangle,
  Eye,
  EyeOff,
  Languages,
  Palette,
  FolderOpen,
  HardDrive,
  RotateCcw,
  Upload,
  RefreshCw,
  Sparkles,
  MapPin,
  Users,
  UserRound,
  Network,
} from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { settingsService } from "@/services/settingsService";
import { useI18n } from "@/i18n";
import { themeService, ThemePack, DEFAULT_THEME_ID } from "@/services/themeService";
import { ThemeSwatches } from "@/components/settings/ThemeSwatches";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updaterService, UpdateCheckResult } from "@/services/updaterService";
import { REPLAY_ONBOARDING_EVENT } from "@/components/onboarding/OnboardingGuide";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { useAppVersion } from "@/lib/useAppVersion";

const subTabVariants = slideVariants("x", 16);

export const SettingsView: React.FC<{ subNav: SettingsSubNav; direction?: number }> = ({ subNav, direction = 1 }) => {
  const appVersion = useAppVersion();
  const { language, setLanguage, t } = useI18n();
  const [enableBmclapi, setEnableBmclapi] = useState<boolean>(false);
  const [campLocation, setCampLocation] = useState<boolean>(false);
  const [curseforgeApiKey, setCurseforgeApiKey] = useState<string>("");
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Theme packs live in <app data>\themes; the active one is remembered by id.
  const [themes, setThemes] = useState<ThemePack[]>([]);
  const [activeThemeId, setActiveThemeId] = useState<string>(() => themeService.getActiveThemeId());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Updater
  const [isCheckingUpdate, setIsCheckingUpdate] = useState<boolean>(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState<boolean>(false);
  const [updateProgress, setUpdateProgress] = useState<number>(0);

  useEffect(() => {
    settingsService
      .getSettings()
      .then((cfg) => {
        setEnableBmclapi(cfg.enableBmclapiMirror);
        setCampLocation(cfg.locationEnabled === true);
        setCurseforgeApiKey(cfg.curseforgeApiKey || "");
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load settings:", err);
        setIsLoading(false);
      });
  }, []);

  const [instancesDir, setInstancesDir] = useState<string>("");

  useEffect(() => {
    settingsService.getInstancesDir().then(setInstancesDir).catch(() => {});
  }, []);

  const applyInstancesDir = async (dir: string) => {
    try {
      await settingsService.updateSettings({ instancesDir: dir });
      setInstancesDir(await settingsService.getInstancesDir());
      toast(t.settings.instancesDirChanged, "success");
    } catch (err) {
      toast(toUserMessage(err), "error");
    }
  };

  const handleChooseInstancesDir = async () => {
    const picked = await openFileDialog({ directory: true, multiple: false, defaultPath: instancesDir || undefined });
    if (typeof picked === "string") await applyInstancesDir(picked);
  };

  const handleToggleBmclapi = async (checked: boolean) => {
    setEnableBmclapi(checked);
    try {
      await settingsService.updateSettings({ enableBmclapiMirror: checked });
    } catch (err) {
      console.error("Failed to update mirror setting:", err);
      setEnableBmclapi(!checked);
      toast(t.errors.mirrorFailed(toUserMessage(err)), "error");
    }
  };

  const handleToggleCampLocation = async (checked: boolean) => {
    setCampLocation(checked);
    try {
      await settingsService.updateSettings({ locationEnabled: checked });
    } catch (err) {
      console.error("Failed to update camp location setting:", err);
      setCampLocation(!checked);
      toast(toUserMessage(err), "error");
    }
  };

  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await settingsService.updateSettings({ curseforgeApiKey: curseforgeApiKey.trim() || null });
      toast(t.settings.saved, "success");
    } catch (err) {
      console.error("Failed to save CurseForge API Key:", err);
      toast(t.errors.apiKeySaveFailed(toUserMessage(err)), "error");
    }
  };

  const loadThemes = () =>
    themeService
      .listThemes()
      .then(setThemes)
      .catch((err) => toast(toUserMessage(err), "error"));

  useEffect(() => {
    void loadThemes();
  }, []);

  const handleSelectTheme = (id: string) => {
    const pack = themes.find((p) => p.id === id);
    if (!pack) return;
    setActiveThemeId(id);
    themeService.applyTheme(pack);
    toast(t.settings.themeApplied, "success");
  };

  const handleResetTheme = () => {
    setActiveThemeId(DEFAULT_THEME_ID);
    themeService.resetToDefault();
    toast(t.settings.themeApplied, "success");
  };

  const handleImportThemeFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const imported = await themeService.importThemeJson(await file.text());
      await loadThemes();
      setActiveThemeId(imported.id);
      themeService.applyTheme(imported);
      toast(t.settings.themeApplied, "success");
    } catch (err) {
      toast(t.errors.themeImportFailed(toUserMessage(err)), "error");
    }
  };

  const handleCheckUpdates = async () => {
    setIsCheckingUpdate(true);
    try {
      const res = await updaterService.checkForUpdates();
      setUpdateResult(res);
      if (!res.available) {
        toast(t.settings.upToDate, "success");
      }
    } catch (err: any) {
      toast(t.errors.updateCheckFailed(toUserMessage(err)), "error");
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateResult?.available) return;
    setIsInstallingUpdate(true);
    setUpdateProgress(0);
    try {
      await updaterService.downloadAndInstall((downloaded, total) => {
        const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
        setUpdateProgress(pct);
      });
    } catch (err: any) {
      toast(t.errors.updateInstallFailed(toUserMessage(err)), "error");
      setIsInstallingUpdate(false);
    }
  };

  return (
    <AnimatePresence mode="popLayout" custom={direction} initial={false}>
      <motion.div
        key={subNav}
        custom={direction}
        variants={subTabVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="w-full space-y-8 pb-10 select-none"
      >
      {subNav === "general" ? (
        <>
      {/* 1. Language */}
      <SettingsSection icon={<Languages className="h-4 w-4 text-brand-light" />} title={t.settings.language} description={t.settings.languageDesc}>
        <div className="flex items-center gap-3">
          {(
            [
              ["zh-TW", "繁體中文 (台灣)"],
              ["en-US", "English (US)"],
            ] as const
          ).map(([code, label]) => (
            <Button
              key={code}
              lang={code}
              variant={language === code ? "default" : "outline"}
              size="sm"
              onClick={() => setLanguage(code)}
              className={`h-8 text-xs ${
                language === code ? "bg-brand hover:bg-brand-light text-white" : "border-white/10 text-slate-300"
              }`}
            >
              {label}
            </Button>
          ))}
        </div>
      </SettingsSection>

      <Divider />

      <SettingsSection icon={<Sparkles className="h-4 w-4 text-brand-light" />} title={t.settings.guide} description={t.settings.guideDesc}>
        <div>
          <Button variant="outline" size="sm" onClick={() => window.dispatchEvent(new Event(REPLAY_ONBOARDING_EVENT))} className="h-8 gap-1 border-white/10 text-xs text-slate-200 hover:text-white">
            <RotateCcw className="h-3.5 w-3.5" /> {t.settings.replayGuide}
          </Button>
        </div>
      </SettingsSection>

      <Divider />

      {/* 2. Appearance: theme packs from the themes folder */}
      <SettingsSection
        icon={<Palette className="h-4 w-4 text-brand-light" />}
        title={t.settings.theme}
        description={
          <>
            {t.settings.themeDescBefore}
            <kbd className="px-1 py-0.5 rounded bg-black/40 border border-white/10 font-mono text-3xs">Ctrl+Shift+R</kbd>
            {t.settings.themeDescAfter}
          </>
        }
      >
        <div>
          <Select value={activeThemeId} onValueChange={handleSelectTheme}>
            <SelectTrigger>
              <SelectValue>{themes.find((p) => p.id === activeThemeId)?.name ?? activeThemeId}</SelectValue>
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

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept=".json" onChange={handleImportThemeFile} className="hidden" />
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="h-8 text-xs gap-1 border-white/10 text-slate-300 hover:text-white">
              <Upload className="h-3.5 w-3.5" /> {t.settings.importTheme}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void themeService.openThemesDir()} className="h-8 text-xs gap-1 border-white/10 text-slate-300 hover:text-white">
              <FolderOpen className="h-3.5 w-3.5" /> {t.settings.openThemesFolder}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void loadThemes()} className="h-8 text-xs gap-1 border-white/10 text-slate-300 hover:text-white">
              <RefreshCw className="h-3.5 w-3.5" /> {t.settings.reloadThemes}
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={handleResetTheme} className="h-8 text-xs gap-1 text-slate-400 hover:text-rose-400">
            <RotateCcw className="h-3.5 w-3.5" /> {t.settings.restoreDefaultTheme}
          </Button>
        </div>
      </SettingsSection>

      <Divider />

      {/* Instance storage folder */}
      <SettingsSection icon={<HardDrive className="h-4 w-4 text-brand-light" />} title={t.settings.instancesDir} description={t.settings.instancesDirDesc}>
        <div className="flex items-center gap-2">
          <Input readOnly value={instancesDir} className="h-9 flex-1 border-white/10 bg-black/30 font-mono text-xs" />
          <Button type="button" size="sm" variant="outline" onClick={handleChooseInstancesDir} className="h-9 gap-1.5 border-white/10 text-xs text-slate-200 hover:text-white">
            <FolderOpen className="h-3.5 w-3.5" /> {t.settings.chooseFolder}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => void applyInstancesDir("")} className="h-9 gap-1.5 text-xs text-slate-400 hover:text-white">
            <RotateCcw className="h-3.5 w-3.5" /> {t.settings.resetDefault}
          </Button>
        </div>
      </SettingsSection>

      <Divider />

      {/* 6. About and updates */}
      <SettingsSection
        icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />}
        title={t.settings.licenseUpdates}
      >
        <div className="flex items-center justify-between rounded-xl border border-white/5 bg-black/20 p-3 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <Info className="h-4 w-4 text-brand-light" />
            <span>
              {t.settings.runningVersion}
              <strong className="font-mono text-slate-100">Focusite {appVersion}</strong>
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={handleCheckUpdates} disabled={isCheckingUpdate || isInstallingUpdate} className="h-8 gap-1.5 border-white/10 text-xs text-slate-200 hover:text-white">
            <RefreshCw className={`h-3.5 w-3.5 ${isCheckingUpdate ? "animate-spin" : ""}`} />
            <span>{isCheckingUpdate ? t.settings.checkingUpdates : t.settings.checkUpdates}</span>
          </Button>
        </div>

        {updateResult?.available && (
          <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-4 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-emerald-300">
                <Sparkles className="h-4 w-4 text-brand-light" />
                <span>{t.settings.newVersion(updateResult.version ?? "")}</span>
              </div>
              <Button size="sm" onClick={handleInstallUpdate} disabled={isInstallingUpdate} className="h-8 bg-brand text-xs text-white hover:bg-brand-light">
                {isInstallingUpdate ? t.settings.updating(updateProgress) : t.settings.downloadAndUpdate}
              </Button>
            </div>
            {updateResult.body && (
              <ScrollArea className="max-h-32 rounded-lg bg-black/30">
                <div className="whitespace-pre-wrap p-2.5 font-mono text-2xs text-slate-300">{updateResult.body}</div>
              </ScrollArea>
            )}
          </div>
        )}
      </SettingsSection>
        </>
      ) : (
        <>
      <p className="text-xs leading-relaxed text-slate-400">{t.privacy.intro}</p>

      {/* Camp: real sunrise, sunset and weather from the user's coarse location */}
      <SettingsSection icon={<MapPin className="h-4 w-4 text-brand-light" />} title={t.settings.campTitle}>
        <div className="flex items-start justify-between gap-4 rounded-xl border border-white/5 bg-black/20 p-4">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-100">{t.settings.campLocation}</span>
            <p className="max-w-3xl text-2xs leading-relaxed text-slate-400">{t.settings.campLocationDesc}</p>
          </div>
          <Switch checked={campLocation} onCheckedChange={handleToggleCampLocation} disabled={isLoading} />
        </div>
        <PrivacyDetail access={t.privacy.campAccess} sent={t.privacy.campSent} risk={t.privacy.campRisk} />
      </SettingsSection>

      <Divider />

      <SettingsSection icon={<Users className="h-4 w-4 text-brand-light" />} title={t.privacy.presenceTitle} description={t.privacy.presenceWhere}>
        <PrivacyDetail access={t.privacy.presenceAccess} sent={t.privacy.presenceSent} risk={t.privacy.presenceRisk} />
      </SettingsSection>

      <Divider />

      <SettingsSection icon={<UserRound className="h-4 w-4 text-brand-light" />} title={t.privacy.accountTitle}>
        <PrivacyDetail access={t.privacy.accountAccess} sent={t.privacy.accountSent} risk={t.privacy.accountRisk} />
      </SettingsSection>

      <Divider />

      <SettingsSection icon={<Network className="h-4 w-4 text-brand-light" />} title={t.privacy.p2pTitle}>
        <PrivacyDetail access={t.privacy.p2pAccess} sent={t.privacy.p2pSent} risk={t.privacy.p2pRisk} />
      </SettingsSection>

      <Divider />

      {/* Download engine and mirror */}
      <SettingsSection icon={<DownloadCloud className="h-4 w-4 text-brand-light" />} title={t.settings.downloadEngineTitle}>
        <div className="flex items-start justify-between gap-4 rounded-xl border border-white/5 bg-black/20 p-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-100">{t.settings.mirrorTitle}</span>
            </div>
            <p className="max-w-3xl text-2xs leading-relaxed text-slate-400">{t.settings.mirrorDesc}</p>
            {enableBmclapi && (
              <div className="flex items-center gap-1.5 pt-1 text-2xs text-amber-400/90">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{t.settings.mirrorWarning}</span>
              </div>
            )}
          </div>
          <Switch checked={enableBmclapi} onCheckedChange={handleToggleBmclapi} disabled={isLoading} />
        </div>
        <PrivacyDetail access={t.privacy.mirrorAccess} sent={t.privacy.mirrorSent} risk={t.privacy.mirrorRisk} />
      </SettingsSection>

      <Divider />

      {/* External integrations */}
      <SettingsSection icon={<Key className="h-4 w-4 text-brand-light" />} title={t.settings.integrations}>
        <form onSubmit={handleSaveApiKey} className="space-y-2">
          <label htmlFor="curseforge-key" className="text-xs font-semibold text-slate-300">{t.settings.curseforgeKeyLabel}</label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input id="curseforge-key"
                type={showApiKey ? "text" : "password"}
                value={curseforgeApiKey}
                onChange={(e) => setCurseforgeApiKey(e.target.value)}
                placeholder={t.settings.curseforgeKeyPlaceholder}
                className="h-9 border-white/10 bg-black/30 pr-10 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-200"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button type="submit" size="sm" className="h-9 bg-brand px-4 text-xs font-semibold text-white hover:bg-brand-light">
              {t.settings.saveKey}
            </Button>
          </div>
          <p className="pt-1 text-2xs leading-relaxed text-slate-400">{t.settings.keyDesc}</p>
        </form>
        <PrivacyDetail access={t.privacy.keyAccess} sent={t.privacy.keySent} risk={t.privacy.keyRisk} />
      </SettingsSection>
        </>
      )}
      </motion.div>
    </AnimatePresence>
  );
};

/** What a feature reads, where it sends it, and what could go wrong. */
const PrivacyDetail: React.FC<{ access: string; sent: string; risk: string }> = ({ access, sent, risk }) => {
  const { t } = useI18n();
  const rows: [string, string, string][] = [
    [t.privacy.accessLabel, access, "text-slate-300"],
    [t.privacy.sentLabel, sent, "text-slate-300"],
    [t.privacy.riskLabel, risk, "text-amber-300/90"],
  ];
  return (
    <dl className="space-y-1.5 rounded-xl border border-white/5 bg-black/10 p-3 text-2xs leading-relaxed">
      {rows.map(([label, text, tone]) => (
        <div key={label} className="grid grid-cols-[4.5rem_1fr] gap-2">
          <dt className="font-semibold text-slate-400">{label}</dt>
          <dd className={tone}>{text}</dd>
        </div>
      ))}
    </dl>
  );
};

const Divider: React.FC = () => <div className="h-px w-full bg-white/5" />;

/** Flat settings section: heading row (icon, title, description, optional right slot) and content. */
const SettingsSection: React.FC<{
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon, title, description, right, children }) => (
  <section className="space-y-4">
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-bold text-white">{title}</h2>
        </div>
        {description && <p className="text-xs leading-relaxed text-slate-400">{description}</p>}
      </div>
      {right}
    </div>
    {children}
  </section>
);
