import type { MinecraftInstance } from "@/types/navigation";

/** Editable copy of an instance's launch settings, so controls respond before the save returns. */
export interface InstanceSettingsDraft {
  maxRam: number;
  javaPath: string;
  showLogOnLaunch: boolean;
}

export type InstanceSettingsAction =
  | { type: "sync"; instance: MinecraftInstance }
  | { type: "change"; changes: Partial<InstanceSettingsDraft> };

export function toSettingsDraft(instance?: MinecraftInstance | null): InstanceSettingsDraft {
  return {
    maxRam: instance?.maxMemoryMb ?? 4096,
    javaPath: instance?.javaPath ?? "",
    showLogOnLaunch: instance?.showLogOnLaunch ?? false,
  };
}

export function instanceSettingsReducer(
  state: InstanceSettingsDraft,
  action: InstanceSettingsAction,
): InstanceSettingsDraft {
  switch (action.type) {
    case "sync":
      return toSettingsDraft(action.instance);
    case "change":
      return { ...state, ...action.changes };
  }
}
