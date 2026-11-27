// Built-in instance icons: 128x128 PNGs rendered from vanilla textures (see src/assets/instance_icons).
// `no-inline`: Vite would turn the small ones into data: URLs, which the app's CSP does not let fetch() read.
import grass from "@/assets/instance_icons/grass.png?no-inline";
import craftingTable from "@/assets/instance_icons/crafting_table.png?no-inline";
import furnace from "@/assets/instance_icons/furnace.png?no-inline";
import diamond from "@/assets/instance_icons/diamond.png?no-inline";
import redstone from "@/assets/instance_icons/redstone.png?no-inline";
import creeper from "@/assets/instance_icons/creeper.png?no-inline";
import tnt from "@/assets/instance_icons/tnt.png?no-inline";
import bookshelf from "@/assets/instance_icons/bookshelf.png?no-inline";
import enderChest from "@/assets/instance_icons/ender_chest.png?no-inline";
import sword from "@/assets/instance_icons/sword.png?no-inline";

const ICONS = {
  grass,
  crafting_table: craftingTable,
  furnace,
  diamond,
  redstone,
  creeper,
  tnt,
  bookshelf,
  ender_chest: enderChest,
  sword,
} as const;

export type PresetIconId = keyof typeof ICONS;

/** URL for showing the icon in the picker. */
export function presetIconUrl(id: PresetIconId): string {
  return ICONS[id];
}

/** The PNG saved as the instance icon (the backend resizes it), as a plain byte array for Tauri. */
export async function presetIconPngBytes(id: PresetIconId): Promise<number[]> {
  const res = await fetch(ICONS[id]);
  if (!res.ok) throw new Error("Could not load icon");
  return Array.from(new Uint8Array(await res.arrayBuffer()));
}
