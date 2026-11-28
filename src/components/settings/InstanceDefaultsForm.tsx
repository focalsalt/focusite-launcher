import React, { useEffect, useId, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { settingsService, type InstanceDefaults } from "@/services/settingsService";
import { splitArgs } from "@/lib/launchOptions";
import { toast } from "@/lib/toast";
import { toUserMessage } from "@/lib/errorMessage";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

const FIELD_CLASS = "h-9 border-white/10 bg-black/30 font-mono text-xs";

const toForm = (defaults: InstanceDefaults = {}) => ({
  min: defaults.minMemoryMb ? String(defaults.minMemoryMb) : "",
  max: defaults.maxMemoryMb ? String(defaults.maxMemoryMb) : "",
  java: defaults.javaPath ?? "",
  jvm: defaults.customJvmArgs?.join(" ") ?? "",
});

/** Values a newly created instance starts with. An empty field keeps the built-in default. */
export const InstanceDefaultsForm: React.FC = () => {
  const { t } = useI18n();
  const id = useId();
  const [form, setForm] = useState(() => toForm());

  useEffect(() => {
    settingsService
      .getSettings()
      .then((cfg) => setForm(toForm(cfg.instanceDefaults)))
      .catch((err) => toast(toUserMessage(err), "error"));
  }, []);

  const field = (key: keyof typeof form) => ({
    id: `${id}-${key}`,
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  const label = (key: keyof typeof form, text: string) => (
    <label htmlFor={`${id}-${key}`} className="text-xs font-semibold text-slate-300">
      {text}
    </label>
  );

  const browseJava = async () => {
    try {
      const picked = await openFileDialog({
        multiple: false,
        filters: [{ name: t.instSettings.javaFilter, extensions: ["exe"] }],
      });
      if (typeof picked === "string") setForm((f) => ({ ...f, java: picked }));
    } catch (err) {
      toast(t.errors.fileDialogFailed(toUserMessage(err)), "error");
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const saved = await settingsService.updateSettings({
        instanceDefaults: {
          minMemoryMb: Number(form.min) || undefined,
          maxMemoryMb: Number(form.max) || undefined,
          javaPath: form.java.trim() || undefined,
          customJvmArgs: splitArgs(form.jvm),
        },
      });
      // The backend clamps out-of-range values: show what was stored.
      setForm(toForm(saved.instanceDefaults));
      toast(t.settings.saved, "success");
    } catch (err) {
      toast(toUserMessage(err), "error");
    }
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          {label("min", t.settings.defaultsMinMemory)}
          <Input {...field("min")} type="number" min={256} step={256} placeholder="1024" className={FIELD_CLASS} />
        </div>
        <div className="space-y-1.5">
          {label("max", t.settings.defaultsMaxMemory)}
          <Input {...field("max")} type="number" min={512} step={256} placeholder="4096" className={FIELD_CLASS} />
        </div>
      </div>
      <div className="space-y-1.5">
        {label("java", t.instSettings.javaTitle)}
        <div className="flex gap-2">
          <Input {...field("java")} placeholder={t.instSettings.javaPathPlaceholder} className={cn(
            FIELD_CLASS,
            "flex-1",
          )} />
          <Button type="button" variant="outline" size="sm" onClick={browseJava} className="h-9 shrink-0 gap-1.5 text-xs">
            <FolderOpen className="h-3.5 w-3.5" /> {t.inst.browseEllipsis}
          </Button>
        </div>
      </div>
      <div className="space-y-1.5">
        {label("jvm", t.instSettings.jvmTitle)}
        <Input {...field("jvm")} placeholder={t.instSettings.jvmPlaceholder} className={FIELD_CLASS} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" className="h-8 px-4 text-xs">
          {t.common.save}
        </Button>
      </div>
    </form>
  );
};
