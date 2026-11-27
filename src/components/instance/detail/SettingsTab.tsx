import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Coffee, Cpu, FolderOpen, MonitorSmartphone, RotateCcw, Terminal, Trash2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { instanceService } from "@/services/instanceService";
import type { MinecraftInstance } from "@/types/navigation";
import type { JavaInstallationDto } from "@/services/instanceService";
import { SectionHeading, tabContentVariants } from "./shared";
import { LaunchOptionsSections } from "./LaunchOptionsSections";
import { toast } from "@/lib/toast";
import { toUserMessage } from "@/lib/errorMessage";
import { useI18n } from "@/i18n";
import { splitArgs } from "@/lib/launchOptions";
import { Tip } from "@/components/ui/tooltip";

interface SettingsTabProps {
  instance: MinecraftInstance;
  maxRam: number;
  handleRamChange: (val: number) => void | Promise<void>;
  selectedJavaPath: string;
  handleJavaChange: (path: string) => void | Promise<void>;
  systemJavas: JavaInstallationDto[];
  showLogOnLaunch: boolean;
  handleToggleShowLog: (checked: boolean) => void | Promise<void>;
  onInstanceUpdated?: (updated: MinecraftInstance) => void;
  setIsDeleteDialogOpen: (open: boolean) => void;
  tabDirection: number;
  ref?: React.Ref<HTMLDivElement>;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  instance,
  maxRam,
  handleRamChange,
  selectedJavaPath,
  handleJavaChange,
  systemJavas,
  showLogOnLaunch,
  handleToggleShowLog,
  onInstanceUpdated,
  setIsDeleteDialogOpen,
  tabDirection,
  ref,
}: SettingsTabProps) => {
  const { t } = useI18n();
  const [javaPathInput, setJavaPathInput] = useState<string>(selectedJavaPath);
  const [customJvmArgsInput, setCustomJvmArgsInput] = useState<string>(
    instance.customJvmArgs?.join(" ") ?? ""
  );

  // Re-sync the editable fields when another instance is shown.
  useEffect(() => {
    setJavaPathInput(selectedJavaPath);
    setCustomJvmArgsInput(instance.customJvmArgs?.join(" ") ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id]);

  const [winW, setWinW] = useState<string>(instance.windowWidth ? String(instance.windowWidth) : "");
  const [winH, setWinH] = useState<string>(instance.windowHeight ? String(instance.windowHeight) : "");
  useEffect(() => {
    setWinW(instance.windowWidth ? String(instance.windowWidth) : "");
    setWinH(instance.windowHeight ? String(instance.windowHeight) : "");
  }, [instance.id, instance.windowWidth, instance.windowHeight]);

  // Both fields empty clears the size (the game picks its default); otherwise both are required.
  const saveWindowSize = async () => {
    const w = winW.trim();
    const h = winH.trim();
    const clearing = w === "" && h === "";
    const wn = Number(w);
    const hn = Number(h);
    if (!clearing && (!Number.isInteger(wn) || !Number.isInteger(hn) || wn <= 0 || hn <= 0)) {
      toast(t.instSettings.windowInvalid, "error");
      return;
    }
    try {
      const updated = await instanceService.updateInstanceSettings(instance.id, {
        windowWidth: clearing ? 0 : wn,
        windowHeight: clearing ? 0 : hn,
      });
      onInstanceUpdated?.(updated);
      toast(t.instSettings.windowUpdated, "success");
    } catch (err) {
      toast(toUserMessage(err), "error");
    }
  };

  const applyJavaPath = async (path: string) => {
    setJavaPathInput(path);
    await handleJavaChange(path);
  };

  const browseJava = async () => {
    try {
      const picked = await openFileDialog({
        multiple: false,
        filters: [{ name: t.instSettings.javaFilter, extensions: ["exe"] }],
      });
      if (picked && typeof picked === "string") {
        await applyJavaPath(picked);
      }
    } catch (err) {
      toast(t.errors.fileDialogFailed(toUserMessage(err)), "error");
    }
  };

  const saveJvmArgs = async () => {
    const parsed = splitArgs(customJvmArgsInput);
    try {
      const updated = await instanceService.updateInstanceSettings(instance.id, {
        customJvmArgs: parsed,
      });
      onInstanceUpdated?.(updated);
      toast(t.instSettings.jvmUpdated, "success");
    } catch (err) {
      toast(toUserMessage(err), "error");
    }
  };

  const divider = <div className="h-px w-full bg-white/5" />;

  return (
    <motion.div
      key="settings"
      custom={tabDirection}
      ref={ref}
      variants={tabContentVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="w-full space-y-8"
    >
      {/* 1. Memory */}
      <section className="space-y-3">
        <SectionHeading
          icon={<Cpu className="h-4 w-4 text-brand-light" />}
          title={t.instSettings.ramTitle}
          description={t.instSettings.ramDesc}
        />
        <div className="space-y-3 pt-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">{t.instSettings.maxHeap}</span>
            <span className="font-mono font-bold text-brand-light">{maxRam} MB</span>
          </div>
          <Slider value={maxRam} min={1024} max={16384} step={512} onChange={handleRamChange} />
          <div className="flex justify-between font-mono text-3xs text-slate-400">
            <span>1024 MB</span>
            <span>{t.instSettings.recommended4096}</span>
            <span>8192 MB</span>
            <span>16384 MB</span>
          </div>
        </div>
      </section>

      {divider}

      {/* 2. Java runtime: pick an executable path */}
      <section className="space-y-3">
        <SectionHeading
          icon={<Coffee className="h-4 w-4 text-warning-400" />}
          title={t.instSettings.javaTitle}
          description={t.instSettings.javaDesc}
        />
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center gap-2">
            <Input
              value={javaPathInput}
              onChange={(e) => setJavaPathInput(e.target.value)}
              onBlur={() => {
                if (javaPathInput.trim() !== selectedJavaPath.trim()) void applyJavaPath(javaPathInput.trim());
              }}
              placeholder={t.instSettings.javaPathPlaceholder}
              className="h-9 flex-1 border-white/10 bg-black/30 font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={browseJava}
              className="h-9 shrink-0 gap-1.5 border-white/10 bg-white/5 text-xs hover:bg-white/10"
            >
              <FolderOpen className="h-3.5 w-3.5 text-brand-light" />
              {t.inst.browseEllipsis}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!javaPathInput}
              onClick={() => void applyJavaPath("")}
              className="h-9 shrink-0 gap-1.5 border-white/10 text-xs text-slate-400 hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t.instSettings.javaUseAuto}
            </Button>
          </div>
          <p className="text-2xs text-slate-400">
            {javaPathInput ? t.instSettings.javaCustomNote : t.instSettings.javaAutoNote}
          </p>

          {systemJavas.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-2xs text-slate-400">{t.instSettings.javaDetected}</span>
              <div className="flex flex-wrap gap-1.5">
                {systemJavas.map((j) => (
                  <Tip label={j.path}>
                    <button
                      key={j.path}
                      type="button"
                      onClick={() => void applyJavaPath(j.path)}
                      className={`rounded-lg border px-2.5 py-1 text-2xs transition-colors ${
                        javaPathInput === j.path
                          ? "border-brand-light bg-brand/15 text-brand-light"
                          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      Java {j.major_version} ({j.vendor}) · {j.is_64_bit ? "64-bit" : "32-bit"}
                    </button>
                  </Tip>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {divider}

      {/* 3. Extra JVM arguments */}
      <section className="space-y-3">
        <SectionHeading
          icon={<Terminal className="h-4 w-4 text-brand-light" />}
          title={t.instSettings.jvmTitle}
          description={t.instSettings.jvmHint}
        />
        <div className="flex gap-2 pt-1">
          <Input
            value={customJvmArgsInput}
            onChange={(e) => setCustomJvmArgsInput(e.target.value)}
            placeholder={t.instSettings.jvmPlaceholder}
            className="h-9 border-white/10 bg-black/30 font-mono text-xs"
          />
          <Button
            size="sm"
            onClick={saveJvmArgs}
            className="h-9 shrink-0 bg-brand px-4 text-xs text-on-solid hover:bg-brand-hover"
          >
            {t.common.save}
          </Button>
        </div>
      </section>

      {divider}

      <LaunchOptionsSections instance={instance} onInstanceUpdated={onInstanceUpdated} />

      {divider}

      {/* 3.5 Default game window size */}
      <section className="space-y-3">
        <SectionHeading
          icon={<MonitorSmartphone className="h-4 w-4 text-brand-light" />}
          title={t.instSettings.windowTitle}
          description={t.instSettings.windowDesc}
        />
        <div className="flex items-center gap-2 pt-1">
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={winW}
            onChange={(e) => setWinW(e.target.value)}
            placeholder={t.instSettings.windowWidth}
            aria-label={t.instSettings.windowWidth}
            className="h-9 w-32 border-white/10 bg-black/30 font-mono text-xs"
          />
          <span className="text-xs text-slate-400">×</span>
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={winH}
            onChange={(e) => setWinH(e.target.value)}
            placeholder={t.instSettings.windowHeight}
            aria-label={t.instSettings.windowHeight}
            className="h-9 w-32 border-white/10 bg-black/30 font-mono text-xs"
          />
          <Button
            size="sm"
            onClick={saveWindowSize}
            className="h-9 shrink-0 bg-brand px-4 text-xs text-on-solid hover:bg-brand-hover"
          >
            {t.common.save}
          </Button>
        </div>
        <p className="text-2xs text-slate-400">{t.instSettings.windowNote}</p>
      </section>

      {divider}

      {/* 4. Live log window */}
      <section className="space-y-3">
        <SectionHeading
          icon={<Terminal className="h-4 w-4 text-brand-light" />}
          title={t.instSettings.logWindowTitle}
          description={t.instSettings.logWindowDesc}
        />
        <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] p-4 text-xs">
          <div>
            <span className="font-semibold text-slate-200">{t.instSettings.showLogOnLaunch}</span>
            <p className="mt-1 text-2xs text-slate-400">{t.instSettings.logWindowNote}</p>
          </div>
          <Switch checked={showLogOnLaunch} onCheckedChange={handleToggleShowLog} />
        </div>
      </section>

      {divider}

      {/* 5. Danger zone */}
      <section className="space-y-4 rounded-2xl border border-danger-500/20 bg-danger-950/10 p-5">
        <div className="flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-danger-500" />
          <h3 className="text-sm font-bold text-danger-300">{t.instSettings.dangerZone}</h3>
        </div>
        <p className="text-xs leading-relaxed text-slate-400">{t.instSettings.dangerDesc}</p>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setIsDeleteDialogOpen(true)}
          className="h-8 gap-2 rounded-lg px-3.5 text-xs font-semibold shadow-md shadow-danger-950/40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>{t.instSettings.deleteThis}</span>
        </Button>
      </section>
    </motion.div>
  );
};
