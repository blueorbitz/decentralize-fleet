// Atlassian Document Format helpers — the same translation fleet-worker uses.
//
// Jira Cloud REST v3 returns descriptions and comments as ADF. The fleet needs
// plain text to snapshot into a PR body and to hand to a harness, and needs to
// write simple paragraphs back. This module is the whole of that translation.

export function adfToText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToText).join('');
  if (typeof node !== 'object') return String(node);

  const content = node.content || [];
  switch (node.type) {
    case 'text':
      return node.text || '';
    case 'hardBreak':
      return '\n';
    case 'paragraph':
      return `${content.map(adfToText).join('')}\n`;
    case 'heading':
      return `\n${content.map(adfToText).join('')}\n`;
    case 'listItem':
      return `- ${content.map(adfToText).join('').trim()}\n`;
    case 'bulletList':
    case 'orderedList':
    case 'doc':
    case 'blockquote':
    case 'panel':
      return content.map(adfToText).join('');
    case 'codeBlock':
      return `\`\`\`\n${content.map(adfToText).join('')}\n\`\`\`\n`;
    case 'rule':
      return '---\n';
    default:
      return content.map(adfToText).join('');
  }
}

export function fieldText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return adfToText(value).trim();
}

export function textToAdf(text) {
  const lines = String(text ?? '').split('\n');
  return {
    type: 'doc',
    version: 1,
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  };
}

// Triage (Rovo, or a human) writes acceptance criteria as a list under an
// "Acceptance criteria" heading. Tickets that never got triaged have none.
export function extractAcceptanceCriteria(description) {
  const text = typeof description === 'string' ? description : fieldText(description);
  if (!text) return '';
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /acceptance criteria/i.test(l));
  if (start === -1) return '';
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const item = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.*\S)\s*$/);
    if (item) {
      out.push(item[1]);
      continue;
    }
    if (!line.trim()) {
      if (out.length) break;
      continue;
    }
    if (out.length) break;
  }
  return out.join('\n');
}
