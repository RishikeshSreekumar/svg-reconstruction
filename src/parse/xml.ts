/** Minimal XML reader — enough for SVG. No entities beyond the standard five. */

export interface XNode {
  tag: string;
  attrs: Record<string, string>;
  children: XNode[];
  parent: XNode | null;
  /** Concatenated character data directly inside this element, unescaped. */
  text?: string;
}

const ENT: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function unescape(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENT[body] ?? m;
  });
}

export function parseXML(src: string): XNode {
  const root: XNode = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  let i = 0;
  const n = src.length;

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i && cur !== root) {
      const chunk = src.slice(i, lt);
      if (chunk.trim()) cur.text = (cur.text ?? '') + unescape(chunk);
    }
    i = lt;

    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<?', i) || src.startsWith('<!', i)) {
      const end = src.indexOf('>', i);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (src.startsWith('</', i)) {
      const end = src.indexOf('>', i);
      if (cur.parent) cur = cur.parent;
      i = end < 0 ? n : end + 1;
      continue;
    }

    // Open tag. Find the '>' that is not inside a quoted attribute value.
    let j = i + 1;
    let quote = '';
    while (j < n) {
      const ch = src[j];
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      j++;
    }
    const raw = src.slice(i + 1, j);
    i = j + 1;

    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const tagMatch = /^([^\s/>]+)/.exec(body);
    if (!tagMatch) continue;
    const tag = tagMatch[1].toLowerCase();

    const attrs: Record<string, string> = {};
    const attrRe = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    attrRe.lastIndex = tagMatch[0].length;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(body))) {
      attrs[am[1].toLowerCase()] = unescape(am[3] ?? am[4] ?? am[5] ?? '');
    }

    const node: XNode = { tag, attrs, children: [], parent: cur };
    cur.children.push(node);
    if (!selfClose) cur = node;
  }
  return root;
}

export function findFirst(node: XNode, tag: string): XNode | null {
  if (node.tag === tag) return node;
  for (const c of node.children) {
    const hit = findFirst(c, tag);
    if (hit) return hit;
  }
  return null;
}
