/** Text forms of an instance's launch options. */

/** Arguments typed on one line, separated by spaces. */
export const splitArgs = (text: string): string[] => text.split(/\s+/).filter(Boolean);

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_()]*$/;

/** One `NAME=value` per line; blank lines are skipped. Reports the first line that is not valid. */
export function parseEnvVars(text: string): { vars: Record<string, string> } | { invalidLine: number } {
  const vars: Record<string, string> = {};
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    const name = line.slice(0, Math.max(eq, 0)).trim();
    if (!ENV_NAME.test(name) || line.includes("\0")) return { invalidLine: i + 1 };
    vars[name] = line.slice(eq + 1).trim();
  }
  return { vars };
}

export const formatEnvVars = (vars: Record<string, string> | undefined): string =>
  Object.entries(vars ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
