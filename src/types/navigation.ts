export type MainView =
  | "news"
  | "home"
  | "instances"
  | "instance-detail"
  | "settings"
  | "skins";

export type NewsSubNav = "official" | "changelog" | "announcements";

export type HomeSubNav = "overview" | "p2p";

export type SettingsSubNav = "general" | "privacy";

export type InstanceDetailSubNav =
  | "screenshots"
  | "mods"
  | "resourcepacks"
  | "saves"
  | "servers"
  | "settings";

export type LoaderType =
  | "Vanilla"
  | "Fabric"
  | "Forge"
  | "NeoForge"
  | "Quilt"
  | "Custom";

export interface VersionCapabilities {
  supportsNonVanillaLoaders: boolean;
  supportsShaderpacks: boolean;
  packFolderKind: "hidden" | "texturepacks" | "resourcepacks";
  modsTabMode: "hidden" | "legacydualnav" | "modernsinglelist";
}

export interface PackFileInfo {
  filename: string;
  sizeBytes: number;
  isDirectory: boolean;
  size?: number;
  path?: string;
  modified?: number;
  description?: string;
  format?: number;
}

export interface MinecraftInstance {
  id: string;
  name: string;
  version: string;
  loader: LoaderType;
  loaderVersion?: string;
  description?: string;
  hasIcon?: boolean;
  iconPath?: string;
  iconSource?: string;
  iconUpdatedAt?: number;
  /** Absolute path of the instance's own background image. */
  backgroundPath?: string;
  modCount: number;
  /** The folder has no config of ours yet; the user must pick version and loader first. */
  needsSetup?: boolean;
  /** Unix epoch milliseconds of the last launch. */
  lastPlayedAt?: number;
  /** Accumulated game process run time in milliseconds. */
  totalPlayTimeMs?: number;
  isFavorite?: boolean;
  showLogOnLaunch?: boolean;
  /** Initial game window size; unset keeps the game default. */
  windowWidth?: number;
  windowHeight?: number;
  minMemoryMb?: number;
  maxMemoryMb?: number;
  javaPath?: string;
  jvmArgs?: string[];
  group?: string;
  customJvmArgs?: string[];
  environmentVars?: Record<string, string>;
  capabilities?: VersionCapabilities;
}

export interface RunningInstanceInfo {
  pid: number;
  instanceId: string;
  accountId?: string;
  accountName?: string;
}

export interface UserCape {
  id: string;
  state: string;
  url: string;
  alias?: string;
}

export interface UserAccount {
  id: string;
  username: string;
  accountType: "microsoft" | "offline";
  isReady: boolean;
  skinUrl?: string;
  skinModel?: "default" | "slim";
  capeUrl?: string;
  capes?: UserCape[];
  isActive: boolean;
  hasValidToken?: boolean;
}
