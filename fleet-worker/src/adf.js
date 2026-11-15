// Atlassian Document Format helpers.
//
// Jira Cloud REST v3 returns rich text (description, comments) as ADF, a JSON
// document tree. The fleet only needs plain text (to snapshot into the PR body
// and to hand to the harness), and only needs to *write* simple paragraphs
// back. This module is the whole of that translation.

// Flatten an ADF node (or a plain string) to readable text.
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

// Any Jira field value (string or ADF) -> plain text.
export function fieldText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return adfToText(value).trim();
}

// Plain text -> the minimal ADF paragraph document Jira expects on writes.
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

// Pull acceptance criteria out of a plain-text description. Triage (Rovo)
// writes them under an "Acceptance criteria" heading as a list; tickets that
// never got triaged simply have none.
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
    // A non-list, non-blank line ends the section unless it just continues.
    if (out.length) break;
  }
  return out.join('\n');
}
