export type MainView =
  | "news"
  | "home"
  | "instances"
  | "instance-detail"
  | "settings"
  | "skins";

export type NewsSubNav = "official" | "changelog" | "announcements";

export type HomeSubNav = "overview" | "p2p";

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
  modCount: number;
  lastPlayed: string;
  isFavorite?: boolean;
  showLogOnLaunch?: boolean;
  minMemoryMb?: number;
  maxMemoryMb?: number;
  javaPath?: string;
  jvmArgs?: string[];
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
