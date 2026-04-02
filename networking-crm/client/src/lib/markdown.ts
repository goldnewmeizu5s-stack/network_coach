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
