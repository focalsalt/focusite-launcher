import type { MinecraftInstance } from "@/types/navigation";

/** Sidebar order: instances that still need setup always come last; the rest keep their order. */
export const sortForSidebar = (instances: MinecraftInstance[]): MinecraftInstance[] =>
  [...instances].sort((a, b) => Number(!!a.needsSetup) - Number(!!b.needsSetup));
