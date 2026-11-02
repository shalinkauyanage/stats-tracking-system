// A small XML reader, enough for the files inside an .xlsx.
// Namespace prefixes are dropped ("r:id" -> "id", "xlrd:rvb" -> "rvb").
// Text is kept EXACTLY as written (spaces and line breaks matter in cell values).

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:[^>"']|"[^"]*"|'[^']*')+>|[^<]+/g;
const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Excel writes unusual characters as _x000D_ inside strings. */
export function decodeExcelEscapes(text) {
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

const local = (name) => name.slice(name.indexOf(':') + 1);

// The XML standard says line endings are read as a single "\n" (even if the file has "\r\n").
const normalizeNewlines = (text) => text.replace(/\r\n?/g, '\n');

export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  for (const token of xml.match(TOKEN) || []) {
    const top = stack[stack.length - 1];
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) { top.text += normalizeNewlines(token.slice(9, -3)); continue; }
    if (token[0] !== '<') { top.text += decodeEntities(normalizeNewlines(token)); continue; }
    if (token[1] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const selfClosing = token.endsWith('/>');
    const inner = token.slice(1, selfClosing ? -2 : -1);
    const nameEnd = inner.search(/[\s/]/);
    const name = local(nameEnd < 0 ? inner : inner.slice(0, nameEnd));
    const attrs = {};
    if (nameEnd >= 0) {
      for (const m of inner.slice(nameEnd).matchAll(ATTR)) attrs[local(m[1])] = decodeEntities(m[2] ?? m[3] ?? '');
    }
    const node = { name, attrs, children: [], text: '' };
    top.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root.children[0] || root;
}

export const child = (node, name) => node?.children.find((c) => c.name === name);
export const childrenNamed = (node, name) => (node?.children || []).filter((c) => c.name === name);

/** Depth-first search for every descendant with this name. */
export function descendants(node, name, out = []) {
  for (const c of node?.children || []) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}
