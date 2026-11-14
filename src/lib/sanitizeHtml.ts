const ALLOWED_TAGS = new Set([
  "P", "BR", "UL", "OL", "LI", "H1", "H2", "H3", "H4", "STRONG", "B", "EM", "I", "CODE",
  "PRE", "A", "IMG", "BLOCKQUOTE", "HR",
]);

/**
 * Allowlist HTML sanitizer for remote content we render but do not control (Mojang patch notes).
 * Unknown elements are unwrapped, all attributes are dropped except https `href` / `src`.
 */
export function sanitizeHtml(html: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const resolveHttps = (value: string | null): string | null => {
    if (!value) return null;
    try {
      const u = new URL(value, baseUrl);
      return u.protocol === "https:" ? u.toString() : null;
    } catch {
      return null;
    }
  };

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      walk(child);
      const tag = child.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "IFRAME" || tag === "OBJECT") {
        child.remove();
        continue;
      }
      if (!ALLOWED_TAGS.has(tag)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      const href = tag === "A" ? resolveHttps(child.getAttribute("href")) : null;
      const src = tag === "IMG" ? resolveHttps(child.getAttribute("src")) : null;
      for (const attr of Array.from(child.attributes)) child.removeAttribute(attr.name);
      if (tag === "A") {
        if (href) child.setAttribute("href", href);
        else child.replaceWith(...Array.from(child.childNodes));
      }
      if (tag === "IMG") {
        if (src) {
          child.setAttribute("src", src);
          child.setAttribute("loading", "lazy");
        } else {
          child.remove();
        }
      }
    }
  };

  walk(doc.body);
  return doc.body.innerHTML;
}
