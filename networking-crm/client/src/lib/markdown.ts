// Simple markdown-to-HTML converter for chat messages
export function renderMarkdown(text: string): string {
  return (
    text
      // Escape HTML
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Bold
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // Italic
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      // Inline code
      .replace(/`(.+?)`/g, '<code class="rounded bg-neutral-700 px-1 py-0.5 text-xs">$1</code>')
      // Unordered lists
      .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
      // Ordered lists
      .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
      // Line breaks (double newline → paragraph)
      .replace(/\n\n/g, '</p><p class="mt-2">')
      // Single newlines → br
      .replace(/\n/g, "<br/>")
      // Wrap in paragraph
      .replace(/^/, '<p>')
      .replace(/$/, "</p>")
  );
}

const ALLOWED_TAGS = new Set([
  "strong", "em", "code", "li", "p", "br", "a",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["class", "data-contact-id"]),
  code: new Set(["class"]),
  li: new Set(["class"]),
  p: new Set(["class"]),
};

export function sanitizeHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";

  function cleanNode(node: Node): void {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove();
        continue;
      }

      const el = child as Element;
      const tag = el.tagName.toLowerCase();

      if (!ALLOWED_TAGS.has(tag)) {
        // Replace disallowed tag with its text content
        const text = doc.createTextNode(el.textContent || "");
        node.replaceChild(text, el);
        continue;
      }

      // Strip disallowed attributes
      const allowed = ALLOWED_ATTRS[tag] || new Set();
      for (const attr of Array.from(el.attributes)) {
        if (!allowed.has(attr.name)) {
          el.removeAttribute(attr.name);
        }
      }

      cleanNode(el);
    }
  }

  cleanNode(root);
  return root.innerHTML;
}
