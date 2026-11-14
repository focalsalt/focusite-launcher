const LOADER_NAMES: Record<string, string> = {
  fabric: "Fabric",
  forge: "Forge",
  neoforge: "NeoForge",
  quilt: "Quilt",
};

/** Human-readable loader name; unknown ids are shown as given. */
export function loaderDisplayName(id?: string | null, vanillaLabel = "Vanilla"): string {
  if (!id) return "";
  if (id.toLowerCase() === "vanilla") return vanillaLabel;
  return LOADER_NAMES[id.toLowerCase()] ?? id;
}
