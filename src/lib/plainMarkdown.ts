/** "adventure" -> "Adventure", "worldgen-biomes" -> "Worldgen biomes" */
export function formatCategory(name: string): string {
  const s = name.replace(/[-_]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
