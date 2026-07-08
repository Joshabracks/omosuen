/**
 * highlightSST — dependency-free SST/JS syntax highlighter.
 *
 * Used as a State Street `:raw=highlightSST` formatter: the framework hands it
 * verbatim code text and sets the returned string as the element's innerHTML.
 * Handles JS plus SST template tokens ({{ }}, :click=, <Component/>, etc.).
 */

const KEYWORDS = new Set([
  "import", "export", "from", "default", "const", "let", "var", "new", "return",
  "function", "if", "else", "for", "while", "await", "async", "yield", "class",
  "extends", "typeof", "instanceof", "in", "of", "delete", "void", "this", "super",
  "true", "false", "null", "undefined",
]);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function span(cls: string, text: string): string {
  return `<span class="${cls}">${esc(text)}</span>`;
}

function interp(path: string): string {
  return span("hl-interp", "{{") + span("hl-var", path) + span("hl-interp", "}}");
}

export function highlightSST(code: string): string {
  const src = code;
  const n = src.length;
  let i = 0;
  const out: string[] = [];

  const identStart = (c: string): boolean => /[A-Za-z_$]/.test(c || "");
  const ident = (c: string): boolean => /[A-Za-z0-9_$]/.test(c || "");

  const pushText = (s: string): void => { if (s) out.push(esc(s)); };

  function scanString(quote: string): void {
    let j = i + 1;
    while (j < n) {
      if (src[j] === "\\") { j += 2; continue; }
      if (src[j] === quote) { j++; break; }
      j++;
    }
    out.push(span("hl-string", src.slice(i, j)));
    i = j;
  }

  function scanLineComment(): void {
    let j = i + 2;
    while (j < n && src[j] !== "\n") j++;
    out.push(span("hl-comment", src.slice(i, j)));
    i = j;
  }

  function scanBlockComment(): void {
    let j = i + 2;
    while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
    j = Math.min(n, j + 2);
    out.push(span("hl-comment", src.slice(i, j)));
    i = j;
  }

  function scanNumber(): void {
    let j = i;
    while (j < n && /[0-9._]/.test(src[j])) j++;
    out.push(span("hl-number", src.slice(i, j)));
    i = j;
  }

  function scanIdent(): void {
    let j = i;
    while (j < n && ident(src[j])) j++;
    const word = src.slice(i, j);
    let k = j;
    while (k < n && (src[k] === " " || src[k] === "\t")) k++;
    if (KEYWORDS.has(word)) out.push(span("hl-keyword", word));
    else if (src[k] === "(") out.push(span("hl-fn", word));
    else pushText(word);
    i = j;
  }

  function scanJS(untilBrace: boolean): void {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (untilBrace) {
        if (c === "{") { depth++; pushText(c); i++; continue; }
        if (c === "}") { if (depth === 0) return; depth--; pushText(c); i++; continue; }
      }
      if (c === "/" && src[i + 1] === "/") { scanLineComment(); continue; }
      if (c === "/" && src[i + 1] === "*") { scanBlockComment(); continue; }
      if (c === "'" || c === '"') { scanString(c); continue; }
      if (c === "`") { scanTemplate(); continue; }
      if (identStart(c)) { scanIdent(); continue; }
      if (c >= "0" && c <= "9") { scanNumber(); continue; }
      pushText(c); i++;
    }
  }

  function scanTemplate(): void {
    out.push(span("hl-string", "`"));
    i++;
    let buf = "";
    const flush = (): void => { pushText(buf); buf = ""; };
    while (i < n) {
      const c = src[i];
      if (c === "\\") { buf += src.slice(i, i + 2); i += 2; continue; }
      if (c === "`") { flush(); out.push(span("hl-string", "`")); i++; return; }
      if (c === "$" && src[i + 1] === "{") {
        flush();
        out.push(span("hl-punct", "${")); i += 2;
        scanJS(true);
        if (src[i] === "}") { out.push(span("hl-punct", "}")); i++; }
        continue;
      }
      if (c === "{" && src[i + 1] === "{") {
        const end = src.indexOf("}}", i + 2);
        if (end !== -1) { flush(); out.push(interp(src.slice(i + 2, end))); i = end + 2; continue; }
      }
      if (c === "<" && /[A-Za-z/]/.test(src[i + 1] || "")) {
        flush();
        if (scanTag()) continue;
      }
      buf += c; i++;
    }
    flush();
  }

  function scanTag(): boolean {
    if (!/^<\/?[A-Za-z][\w-]*/.test(src.slice(i, i + 64))) return false;
    const isClose = src[i + 1] === "/";
    let j = i + (isClose ? 2 : 1);
    while (j < n && ident(src[j])) j++;
    const name = src.slice(i + (isClose ? 2 : 1), j);
    out.push(span("hl-tag", isClose ? "</" : "<"));
    out.push(span(/^[A-Z]/.test(name) ? "hl-comp" : "hl-tag", name));
    i = j;
    while (i < n) {
      const c = src[i];
      if (c === ">") { out.push(span("hl-tag", ">")); i++; return true; }
      if (c === "/" && src[i + 1] === ">") { out.push(span("hl-tag", "/>")); i += 2; return true; }
      if (/\s/.test(c)) { pushText(c); i++; continue; }
      if (c === ":" && identStart(src[i + 1])) { scanEvent(); continue; }
      if (c === "$" && src[i + 1] === "{") {
        out.push(span("hl-punct", "${")); i += 2;
        scanJS(true);
        if (src[i] === "}") { out.push(span("hl-punct", "}")); i++; }
        continue;
      }
      if (c === "{" && src[i + 1] === "{") {
        const end = src.indexOf("}}", i + 2);
        if (end !== -1) { out.push(interp(src.slice(i + 2, end))); i = end + 2; continue; }
      }
      if (/[A-Za-z_-]/.test(c)) { scanAttr(); continue; }
      if (c === "'" || c === '"') { scanAttrString(c); continue; }
      pushText(c); i++;
    }
    return true;
  }

  function scanEvent(): void {
    let j = i + 1;
    while (j < n && ident(src[j])) j++;
    out.push(span("hl-event", src.slice(i, j)));
    i = j;
    if (src[i] === "=") { out.push(span("hl-punct", "=")); i++; }
    let k = i;
    while (k < n && ident(src[k])) k++;
    if (k > i) { out.push(span("hl-fn", src.slice(i, k))); i = k; }
    if (src[i] === "(") {
      out.push(span("hl-punct", "(")); i++;
      while (i < n && src[i] !== ")") {
        const c = src[i];
        if (c === "{" && src[i + 1] === "{") {
          const end = src.indexOf("}}", i + 2);
          if (end !== -1) { out.push(interp(src.slice(i + 2, end))); i = end + 2; continue; }
        }
        if (c === "'" || c === '"') { scanAttrString(c); continue; }
        if (identStart(c)) { let a = i; while (i < n && ident(src[i])) i++; out.push(span("hl-attr", src.slice(a, i))); continue; }
        pushText(c); i++;
      }
      if (src[i] === ")") { out.push(span("hl-punct", ")")); i++; }
    }
  }

  function scanAttr(): void {
    let j = i;
    while (j < n && /[\w-]/.test(src[j])) j++;
    if (j === i) { pushText(src[i]); i++; return; }
    out.push(span("hl-attr", src.slice(i, j)));
    i = j;
    if (src[i] === "=") {
      out.push(span("hl-punct", "=")); i++;
      const c = src[i];
      if (c === "'" || c === '"') { scanAttrString(c); }
      else if (c === "{" && src[i + 1] === "{") {
        const end = src.indexOf("}}", i + 2);
        if (end !== -1) { out.push(interp(src.slice(i + 2, end))); i = end + 2; }
      } else {
        let a = i;
        while (i < n && !/[\s/>]/.test(src[i])) i++;
        out.push(span("hl-string", src.slice(a, i)));
      }
    }
  }

  function scanAttrString(quote: string): void {
    out.push(span("hl-string", quote)); i++;
    let buf = "";
    const flush = (): void => { if (buf) { out.push(span("hl-string", buf)); buf = ""; } };
    while (i < n) {
      const c = src[i];
      if (c === "\\") { buf += src.slice(i, i + 2); i += 2; continue; }
      if (c === quote) { flush(); out.push(span("hl-string", quote)); i++; return; }
      if (c === "{" && src[i + 1] === "{") {
        const end = src.indexOf("}}", i + 2);
        if (end !== -1) { flush(); out.push(interp(src.slice(i + 2, end))); i = end + 2; continue; }
      }
      buf += c; i++;
    }
    flush();
  }

  scanJS(false);
  return out.join("");
}
