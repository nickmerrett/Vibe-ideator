function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMarkdown(text) {
  return escapeHtml(text)
    .replace(/^### (.*?)$/gm, '<h3 class="text-lg font-bold mt-5 mb-2">$1</h3>')
    .replace(/^## (.*?)$/gm, '<h2 class="text-xl font-bold mt-6 mb-3">$1</h2>')
    .replace(/^# (.*?)$/gm, '<h1 class="text-2xl font-bold mt-8 mb-4">$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code class="bg-black/30 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>')
    .replace(/^- (.*?)$/gm, '<li class="ml-5 list-disc">$1</li>')
    .replace(/^(\d+)\. (.*?)$/gm, '<li class="ml-5 list-decimal">$2</li>')
    .replace(/\n\n/g, '</p><p class="mb-3">')
    .replace(/\n/g, '<br/>');
}

export function MarkdownText({ text, className = '' }) {
  return (
    <div
      className={`leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: `<p class="mb-3">${formatMarkdown(text)}</p>` }}
    />
  );
}
