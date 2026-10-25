export type MainView =
  | "news"
  | "home"
  | "instances"
  | "instance-detail"
  | "settings";

export type NewsSubNav = "official" | "changelog" | "announcements";

export type HomeSubNav = "overview" | "p2p";

export type InstanceDetailSubNav = "settings" | "mods" | "saves" | "logs";

export interface MinecraftInstance {
  id: string;
  name: string;
  version: string;
  loader: "Vanilla" | "Fabric" | "Forge" | "NeoForge" | "Quilt";
  modCount: number;
  lastPlayed: string;
  isFavorite?: boolean;
}

export interface UserAccount {
  id: string;
  username: string;
  accountType: "microsoft" | "offline";
  isReady: boolean;
  skinUrl?: string;
  capeUrl?: string;
  isActive: boolean;
}
