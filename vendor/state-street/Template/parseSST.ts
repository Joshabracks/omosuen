enum ELEMENT_TYPE {
  OPEN,
  CLOSING,
  TEXT,
  SELF_CLOSING,
}

const REGEX = {
  OPEN_TAG: /^<[^/](?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^>"'`])*>/,
  SELF_CLOSING_TAG: /^<(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^>"'`])*\/>/,
  CLOSE_TAG: /^<\/\w+>/,
  TEXT: /^[^<]+/,
  WHITE_SPACE_TRIM: /\n\s+/g,
  ATTRIBUTE: /([\w-]+(?::[\w-]+)?)(?:=("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^\s/>"'`]+))?(?=[\s/>])/g,
  EVENT: /:(\w+)=(\w+)\(((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^)"'`])*)\)/g,
  PROP: /([\w-]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^,]*)/g,
  RAW_ATTR: /:raw(?:=\w+)?/gi,
  PRESERVE_ATTR: /:preserve\b/gi,
};

// Sticky (`y`) clones of the element regexes, anchored at `lastIndex` so the
// parser can scan with a moving cursor instead of slicing/replacing the string.
const STICKY = {
  SELF_CLOSING: new RegExp(REGEX.SELF_CLOSING_TAG.source.replace(/^\^/, ""), "y"),
  OPEN: new RegExp(REGEX.OPEN_TAG.source.replace(/^\^/, ""), "y"),
  CLOSE: new RegExp(REGEX.CLOSE_TAG.source.replace(/^\^/, ""), "y"),
  TEXT: new RegExp(REGEX.TEXT.source.replace(/^\^/, ""), "y"),
};

function isWhitespace(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13);
}

function getAttributes(tag: string): any[] {
  const cleanTag = tag
    .replace(/^<[\w:-]+\s*/, '')
    .replace(REGEX.EVENT, '')
    .replace(REGEX.RAW_ATTR, '')        // never surface :raw as a `raw="…"` attribute
    .replace(REGEX.PRESERVE_ATTR, '')   // nor :preserve as a `preserve` attribute
    .replace(/\s+/g, ' ');
  REGEX.ATTRIBUTE.lastIndex = 0;
  let attributesMatch = (cleanTag && REGEX.ATTRIBUTE.exec(cleanTag)) || null;
  const attributes = [];
  while (attributesMatch !== null) {
    const raw = attributesMatch[2];
    const q = raw && raw[0];
    const value = raw === undefined ? undefined
      : (q === '"' || q === "'" || q === '`') ? raw.slice(1, -1) // inner content; constructElement unescapes/decodes
      : raw;                                                      // unquoted token
    attributes.push({ name: attributesMatch[1], value, raw });
    attributesMatch = (cleanTag && REGEX.ATTRIBUTE.exec(cleanTag)) || null;
  }
  return attributes;
}

function parseProps(raw: string): { key: string; value: string }[] {
  const props: { key: string; value: string }[] = [];
  REGEX.PROP.lastIndex = 0;
  let m = REGEX.PROP.exec(raw);
  while (m !== null) {
    props.push({ key: m[1], value: m[2] });
    m = REGEX.PROP.exec(raw);
  }
  return props;
}

function getEvents(tag: string): any[] {
  let eventsMatch = (tag && REGEX.EVENT.exec(tag)) || null;
  const events = [];
  while (eventsMatch !== null) {
    const event = {
      type: eventsMatch[1],
      function: eventsMatch[2],
      props: parseProps(eventsMatch[3]?.trim() || ""),
    };
    events.push(event);
    eventsMatch = (tag && REGEX.EVENT.exec(tag)) || null;
  }
  return events;
}

const tagNameRegExp = /<\/*([\w:]+)/;
function getTagName(tag: string) {
  return tag.match(tagNameRegExp)?.[1];
}

// Single-pass parser: scans `data` with a moving cursor `pos` (no slicing or
// per-token re-copying of the remaining string -> O(n) instead of O(n^2)).
function getElements(data: string, components: any, pos: number, content: any[], stash: any[]): { content: any[]; pos: number } {
  const len = data.length;
  while (pos < len) {
    // Skip whitespace between tokens (replaces the old per-iteration .trim()).
    while (pos < len && isWhitespace(data.charCodeAt(pos))) pos++;
    if (pos >= len) break;

    let elementType: ELEMENT_TYPE;
    let match: RegExpExecArray | null;
    STICKY.SELF_CLOSING.lastIndex = pos;
    if ((match = STICKY.SELF_CLOSING.exec(data))) {
      elementType = ELEMENT_TYPE.SELF_CLOSING;
    } else {
      STICKY.OPEN.lastIndex = pos;
      if ((match = STICKY.OPEN.exec(data))) {
        elementType = ELEMENT_TYPE.OPEN;
      } else {
        STICKY.CLOSE.lastIndex = pos;
        if ((match = STICKY.CLOSE.exec(data))) {
          elementType = ELEMENT_TYPE.CLOSING;
        } else {
          STICKY.TEXT.lastIndex = pos;
          match = STICKY.TEXT.exec(data);
          elementType = ELEMENT_TYPE.TEXT;
        }
      }
    }
    if (!match) { pos++; continue; } // lone unmatched char (e.g. stray '<')
    const elementString = match[0];
    pos += elementString.length;

    if (elementType === ELEMENT_TYPE.SELF_CLOSING) {
      const tagName: string = getTagName(elementString) || '';
      const isComponent = components[tagName.trim()] ? true : false;
      const element: any = {
        type: isComponent ? '_component' : tagName,
        events: getEvents(elementString),
        selfClosing: true,
      };
      if (isComponent) {
        element.componentName = tagName;
        element.componentProperties = getAttributes(elementString).reduce((res, val) => {
          res[val.name] = val.raw;   // raw token (with quotes) so coercion can respect them
          return res;
        }, {});
      } else {
        element.attributes = getAttributes(elementString);
      }
      content.push(element);
      continue;
    }
    if (elementType === ELEMENT_TYPE.OPEN) {
      const tagName = getTagName(elementString);
      const attributes = getAttributes(elementString);
      const events = getEvents(elementString);
      const child = getElements(data, components, pos, [], stash);
      // Raw / RCDATA placeholder: its inner content was stashed verbatim before
      // the comment/whitespace pre-passes (see extractRaw). Restore it here.
      const rawIdx = attributes.findIndex((a: any) => a.name === 'data-ssrawid');
      if (rawIdx !== -1) {
        const entry = stash[Number(attributes[rawIdx].value)];
        attributes.splice(rawIdx, 1);
        const node: any = { type: tagName, attributes, events, content: [entry.inner] };
        if (entry.kind === 'raw') { node.raw = true; node.rawFormatter = entry.formatter; }
        content.push(node);
        pos = child.pos;
        continue;
      }
      const node: any = {
        type: tagName,
        attributes: attributes,
        events: events,
        content: child.content,
      };
      // `:preserve` — reuse this element in place and never rebuild its children
      // (for hosting third-party DOM, or a child State, with no child-State auto-registration).
      if (/(^|\s):preserve\b/i.test(elementString)) node.preserve = true;
      content.push(node);
      pos = child.pos;
      continue;
    }
    if (elementType === ELEMENT_TYPE.CLOSING) {
      return { content, pos };
    }
    content.push(elementString);
  }
  return { content, pos };
}

// Pull raw / RCDATA element bodies out of the template BEFORE the comment-strip
// and whitespace-collapse passes run, so their verbatim content (indentation,
// `<tags>`, `{{braces}}`, even `<!-- comments -->`) is preserved. Each body is
// stashed and the element is replaced with an empty placeholder carrying its
// stash index; getElements restores it. The order matters: an explicit `:raw`
// wins over the default tag tiers, so it runs first.
function extractRaw(data: string, stash: any[]): string {
  let out = data;
  // 1. `:raw` (optionally `:raw=formatter`) on any element.
  out = out.replace(
    /<([a-zA-Z][\w-]*)([^>]*?)\s:raw(?:=(\w+))?([^>]*?)>([\s\S]*?)<\/\1\s*>/g,
    (_m, tag, pre, fmt, post, inner) => {
      const id = stash.length;
      stash.push({ kind: 'raw', inner, formatter: fmt || null });
      const attrs = `${pre} ${post}`.replace(/\s+/g, ' ').trim();
      return `<${tag}${attrs ? ' ' + attrs : ''} data-ssrawid="${id}"></${tag}>`;
    }
  );
  // 2. RAWTEXT tags: verbatim, no child-tag parsing, no interpolation.
  //    (pre is intentionally NOT here so `<pre><code>…</code></pre>` keeps working —
  //    use `<pre :raw>` for a bare verbatim block.)
  out = out.replace(
    /<(script|style|code)(?![^>]*data-ssrawid)((?:\s[^>]*)?)>([\s\S]*?)<\/\1\s*>/gi,
    (_m, tag, attrs, inner) => {
      const id = stash.length;
      stash.push({ kind: 'raw', inner, formatter: null });
      return `<${tag}${attrs} data-ssrawid="${id}"></${tag}>`;
    }
  );
  // 3. RCDATA tags: no child-tag parsing, but interpolation + entity decode kept.
  out = out.replace(
    /<(textarea|title)(?![^>]*data-ssrawid)((?:\s[^>]*)?)>([\s\S]*?)<\/\1\s*>/gi,
    (_m, tag, attrs, inner) => {
      const id = stash.length;
      stash.push({ kind: 'rcdata', inner, formatter: null });
      return `<${tag}${attrs} data-ssrawid="${id}"></${tag}>`;
    }
  );
  return out;
}

function parseSST(data: string, components: any = {}) {
  // Protect raw/RCDATA bodies before any normalization touches them.
  const stash: any[] = [];
  let processed = extractRaw(data, stash);
  // Convert component comments (<!-- Name attrs / -->) to self-closing tags (<Name attrs />)
  processed = processed.replace(
    /<!--\s+([\w]+)((?:\s+[\w]+="[^"]*")*)\s*\/\s*-->/g,
    (_match: string, name: string, attrs: string) => components[name] ? `<${name}${attrs} />` : ''
  );
  // Strip remaining HTML comments
  processed = processed.replace(/<!--[\s\S]*?-->/g, '');
  // Collapse newline-indentation runs once up front (was applied per-token before).
  processed = processed.replace(REGEX.WHITE_SPACE_TRIM, " ");
  const result = getElements(processed, components, 0, [], stash);
  return result.content;
}

export { parseSST };
