// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01-run-20261122).
// run(input) returns exactly makefun-site's output tree, byte for byte.
// Dependency-free ES module. All per-case caches live inside run() so
// nothing is carried from one case to the next.

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const RESERVED = Object.freeze(['posts', 'tags', 'page']);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

// ---------------------------------------------------------------- text

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/;
const ESC_RE_G = /[&<>"']/g;

/** Single-pass escaper: no special chars -> the string itself, else one regex replace. */
export function escapeHtml(text) {
  if (!ESC_RE.test(text)) return text;
  return text.replace(ESC_RE_G, (c) => ESC[c]);
}

const COMBINING_RE = /\p{M}/gu;

function slugBody(s) {
  let out = '';
  let gap = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let keep = -1;
    if (c >= 65 && c <= 90) keep = c + 32;
    else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
    if (keep === -1) {
      if (out.length > 0) gap = true;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += String.fromCharCode(keep);
  }
  if (out.length > 64) {
    out = out.slice(0, 64);
    let e = out.length;
    while (e > 0 && out.charCodeAt(e - 1) === 45) e--;
    out = out.slice(0, e);
  }
  return out === '' ? 'untitled' : out;
}

/** Memoized slugify with an ASCII fast path (ASCII is already NFKD, has no combining marks). */
function slugify(cx, text) {
  const cached = cx.slug.get(text);
  if (cached !== undefined) return cached;
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) >= 128) { ascii = false; break; }
  }
  const out = ascii ? slugBody(text) : slugBody(text.normalize('NFKD').replace(COMBINING_RE, ''));
  cx.slug.set(text, out);
  return out;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

function longDate(cx, date) {
  const cached = cx.date.get(date);
  if (cached !== undefined) return cached;
  const out = `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
  cx.date.set(date, out);
  return out;
}

/** Whether a UTF-16 code unit is whitespace (JS \s). */
function isWsCode(c) {
  if (c < 128) return c === 32 || (c >= 9 && c <= 13);
  return c === 0xA0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200A) || c === 0x2028 || c === 0x2029 || c === 0x202F || c === 0x205F || c === 0x3000 || c === 0xFEFF;
}

/** Words of the body lines [a, b): runs of non-whitespace, counted with a char scan (no regex, no call per char). */
function countWords(lines, a, b) {
  let total = 0;
  for (let i = a; i < b; i++) {
    const s = lines[i];
    let inWord = false;
    for (let j = 0; j < s.length; j++) {
      const c = s.charCodeAt(j);
      let ws;
      if (c < 128) ws = c === 32 || (c >= 9 && c <= 13);
      else ws = c === 0xA0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200A) || c === 0x2028 || c === 0x2029 || c === 0x202F || c === 0x205F || c === 0x3000 || c === 0xFEFF;
      if (ws) inWord = false;
      else if (!inWord) { total++; inWord = true; }
    }
  }
  return total;
}

// ---------------------------------------------------------------- front matter

const KEYS = new Set(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function hasBadTagChar(t) {
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 34 || c === 91 || c === 93) return true;
  }
  return false;
}

function isNameChar(c) { return (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45; }

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      let ok = raw.length === 10 && raw.charCodeAt(4) === 45 && raw.charCodeAt(7) === 45;
      let y = 0, mo = 0, d = 0;
      if (ok) {
        for (let i = 0; i < 10; i++) {
          if (i === 4 || i === 7) continue;
          const c = raw.charCodeAt(i);
          if (c < 48 || c > 57) { ok = false; break; }
        }
        if (ok) { y = Number(raw.slice(0, 4)); mo = Number(raw.slice(5, 7)); d = Number(raw.slice(8, 10)); }
      }
      if (!ok || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (let i = 0; i < tags.length; i++) {
        if (tags[i] === '' || hasBadTagChar(tags[i])) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout': {
      for (let i = 0; i < raw.length; i++) if (!isNameChar(raw.charCodeAt(i))) return { error: 'key "layout": not a template name' };
      return { value: raw };
    }
    case 'slug': {
      if (raw.length > 64) return { error: 'key "slug": not a slug' };
      let pos = 0;
      const n = raw.length;
      while (pos < n) {
        const s = pos;
        while (pos < n) {
          const c = raw.charCodeAt(pos);
          if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) pos++;
          else break;
        }
        if (pos === s) return { error: 'key "slug": not a slug' };
        if (pos < n) {
          if (raw.charCodeAt(pos) !== 45) return { error: 'key "slug": not a slug' };
          pos++;
          if (pos >= n) return { error: 'key "slug": not a slug' };
        }
      }
      return { value: raw };
    }
    default:
      return { error: `unknown key "${key}"` };
  }
}

function parseFrontMatter(lines) {
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { close = i; break; }
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    let k = 0;
    while (k < line.length && (line.charCodeAt(k) === 32 || line.charCodeAt(k) === 9)) k++;
    if (k === line.length) continue;
    if (line.charCodeAt(0) === 35) continue;
    let ki = 0;
    while (ki < line.length) {
      const c = line.charCodeAt(ki);
      if ((c >= 97 && c <= 122) || c === 95) ki++;
      else break;
    }
    if (ki === 0 || ki >= line.length || line.charCodeAt(ki) !== 58) return { error: `line ${i + 1} is not "key: value"` };
    let raw;
    if (ki + 1 === line.length) raw = '';
    else if (line.charCodeAt(ki + 1) === 32) raw = line.slice(ki + 2);
    else return { error: `line ${i + 1} is not "key: value"` };
    let re = raw.length;
    while (re > 0 && (raw.charCodeAt(re - 1) === 32 || raw.charCodeAt(re - 1) === 9)) re--;
    if (re < raw.length) raw = raw.slice(0, re);
    const key = line.slice(0, ki);
    if (!KEYS.has(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, bodyStart: close + 1 };
}

// ---------------------------------------------------------------- markdown

function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function trimLine(line) {
  let s = 0, e = line.length;
  while (s < e && (line.charCodeAt(s) === 32 || line.charCodeAt(s) === 9)) s++;
  while (e > s && (line.charCodeAt(e - 1) === 32 || line.charCodeAt(e - 1) === 9)) e--;
  return s === 0 && e === line.length ? line : line.slice(s, e);
}

function isLangChar(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45;
}

/** Fence-open language, or null. */
function fenceOpen(line) {
  if (line.length < 3 || line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let j = 3;
  while (j < line.length && isLangChar(line.charCodeAt(j))) j++;
  for (let k = j; k < line.length; k++) {
    const c = line.charCodeAt(k);
    if (c !== 32 && c !== 9) return null;
  }
  return line.slice(3, j);
}

function isFenceClose(line) {
  if (line.length < 3 || line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let k = 3; k < line.length; k++) {
    const c = line.charCodeAt(k);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function headingOf(line) {
  let k = 0;
  while (k < line.length && line.charCodeAt(k) === 35) k++;
  if (k === 0 || k > 6 || k >= line.length) return null;
  let s = k;
  while (s < line.length && (line.charCodeAt(s) === 32 || line.charCodeAt(s) === 9)) s++;
  if (s === k) return null;
  let e = line.length;
  while (e > s && (line.charCodeAt(e - 1) === 32 || line.charCodeAt(e - 1) === 9)) e--;
  if (e === s) return null;
  return { depth: k, text: line.slice(s, e) };
}

function isHr(line) {
  if (line.length < 3) return false;
  const a = line.charCodeAt(0), b = line.charCodeAt(1), c = line.charCodeAt(2);
  if (!((a === 45 && b === 45 && c === 45) || (a === 42 && b === 42 && c === 42))) return false;
  for (let j = 3; j < line.length; j++) {
    const ch = line.charCodeAt(j);
    if (ch !== 32 && ch !== 9) return false;
  }
  return true;
}

function endsParagraph(line) {
  return isBlank(line) || fenceOpen(line) !== null || headingOf(line) !== null || isHr(line);
}

/** Bullet item text, or null. */
function bulletText(line) {
  const c0 = line.charCodeAt(0);
  if ((c0 === 45 || c0 === 42) && line.charCodeAt(1) === 32) return line.slice(2);
  return null;
}

/** Ordered item { start, text }, or null. */
function orderedItem(line) {
  let d = 0;
  while (d < line.length) {
    const c = line.charCodeAt(d);
    if (c >= 48 && c <= 57) d++;
    else break;
  }
  if (d < 1 || d > 9) return null;
  if (line.charCodeAt(d) !== 46 || line.charCodeAt(d + 1) !== 32) return null;
  return { start: Number(line.slice(0, d)), text: line.slice(d + 2) };
}

function isContinued(line) {
  let j = 0;
  while (j < line.length && line.charCodeAt(j) === 32) j++;
  if (j < 2 || j >= line.length) return false;
  return !isWsCode(line.charCodeAt(j));
}

function isEscapable(c) {
  return c === 92 || c === 96 || c === 42 || c === 95 || c === 91 || c === 93 || c === 40 || c === 41 || c === 35 || c === 43 || c === 45 || c === 46 || c === 33 || c === 62;
}

function findDoubleStar(s, from, hi) {
  for (let j = from; j + 1 < hi; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < hi && isEscapable(s.charCodeAt(j + 1))) { j++; continue; }
    if (c === 42 && s.charCodeAt(j + 1) === 42) return j;
  }
  return -1;
}

function findCloseBracket(s, from, hi) {
  for (let j = from; j < hi; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < hi && isEscapable(s.charCodeAt(j + 1))) { j++; continue; }
    if (c === 93) return j;
  }
  return -1;
}

function findSingleStar(s, from, hi) {
  for (let j = from; j < hi; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < hi && isEscapable(s.charCodeAt(j + 1))) { j++; continue; }
    if (c !== 42) continue;
    if (j + 1 < hi && s.charCodeAt(j + 1) === 42) { j++; continue; }
    return j;
  }
  return -1;
}

const INLINE_SPECIAL = /[\\`*\[&<>"']/;
const WS_RE = /\s/;
// One global regex per inline recursion depth: the C regex engine jumps over
// plain runs instead of a JS loop stepping char by char. A recursive call uses
// the next depth's regex, so it cannot clobber the caller's lastIndex.
const INLINE_RE_POOL = [];

// Shared scratch for inlineStr: calls are sequential (recursion goes through
// inlineInto, never inlineStr), so one array can serve every call.
const INLINE_OUT = [];

function inlineStr(s, env) {
  if (!INLINE_SPECIAL.test(s)) return s;
  INLINE_OUT.length = 0;
  inlineInto(s, 0, s.length, env, INLINE_OUT, 0);
  const out = INLINE_OUT.join('');
  INLINE_OUT.length = 0;
  return out;
}

/**
 * Inline rendering over the range [lo, hi) of `s`, without slicing the inner
 * text for recursion: strong/em/link inners are rendered from the same string
 * by range, so no intermediate copy is made for them. Bounds are the slice's
 * bounds, exactly as the baseline's s.slice() would see them.
 */
function inlineInto(s, lo, hi, env, out, depth) {
  let re = INLINE_RE_POOL[depth];
  if (re === undefined) {
    re = /[\\`*\[&<>"']/g;
    INLINE_RE_POOL[depth] = re;
  }
  re.lastIndex = lo;
  let plain = lo;
  let m;
  while ((m = re.exec(s)) !== null) {
    const i = m.index;
    if (i >= hi) break;
    const c = m[0];
    if (c === '&') { if (i > plain) out.push(s.slice(plain, i)); out.push('&amp;'); plain = i + 1; re.lastIndex = plain; continue; }
    if (c === '<') { if (i > plain) out.push(s.slice(plain, i)); out.push('&lt;'); plain = i + 1; re.lastIndex = plain; continue; }
    if (c === '>') { if (i > plain) out.push(s.slice(plain, i)); out.push('&gt;'); plain = i + 1; re.lastIndex = plain; continue; }
    if (c === '"') { if (i > plain) out.push(s.slice(plain, i)); out.push('&quot;'); plain = i + 1; re.lastIndex = plain; continue; }
    if (c === "'") { if (i > plain) out.push(s.slice(plain, i)); out.push('&#39;'); plain = i + 1; re.lastIndex = plain; continue; }
    if (c === '\\') {
      if (i + 1 < hi && isEscapable(s.charCodeAt(i + 1))) {
        if (i > plain) out.push(s.slice(plain, i));
        const nc = s.charCodeAt(i + 1);
        out.push(nc === 62 ? '&gt;' : s[i + 1]);
        plain = i + 2; re.lastIndex = plain;
      } else re.lastIndex = i + 1;
      continue;
    }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1 && j < hi) {
        if (i > plain) out.push(s.slice(plain, i));
        out.push('<code>', escapeHtml(s.slice(i + 1, j)), '</code>');
        plain = j + 1; re.lastIndex = plain;
      } else re.lastIndex = i + 1;
      continue;
    }
    if (c === '*') {
      if (i + 1 < hi && s.charCodeAt(i + 1) === 42) {
        const j = findDoubleStar(s, i + 2, hi);
        if (j > i + 2) {
          if (i > plain) out.push(s.slice(plain, i));
          out.push('<strong>'); inlineInto(s, i + 2, j, env, out, depth + 1); out.push('</strong>');
          plain = j + 2; re.lastIndex = plain;
        } else re.lastIndex = i + 2;
      } else {
        const j = findSingleStar(s, i + 1, hi);
        if (j > i + 1) {
          if (i > plain) out.push(s.slice(plain, i));
          out.push('<em>'); inlineInto(s, i + 1, j, env, out, depth + 1); out.push('</em>');
          plain = j + 1; re.lastIndex = plain;
        } else re.lastIndex = i + 1;
      }
      continue;
    }
    // '['
    const k = findCloseBracket(s, i + 1, hi);
    let mm = -1;
    if (k !== -1 && k + 1 < hi && s.charCodeAt(k + 1) === 40) {
      mm = s.indexOf(')', k + 2);
      if (mm >= hi) mm = -1;
    }
    const target = mm === -1 ? '' : s.slice(k + 2, mm);
    if (target !== '' && !WS_RE.test(target)) {
      if (i > plain) out.push(s.slice(plain, i));
      out.push('<a href="', escapeHtml(env.link(target)), '">');
      inlineInto(s, i + 1, k, env, out, depth + 1);
      out.push('</a>');
      plain = mm + 1; re.lastIndex = plain;
    } else re.lastIndex = i + 1;
  }
  if (hi > plain) out.push(s.slice(plain, hi));
}

/** Fused lex + render over lines [start, end). */
function renderMarkdownLines(lines, start, end, env, cx) {
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let i = start;
  while (i < end) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    const c0 = line.charCodeAt(0);
    if (c0 === 96) {
      const lang = fenceOpen(line);
      if (lang !== null) {
        let j = i + 1;
        while (j < end && !isFenceClose(lines[j])) j++;
        const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
        let s = `<pre><code${cls}>`;
        for (let k = i + 1; k < j; k++) s += escapeHtml(lines[k]) + '\n';
        s += '</code></pre>';
        blocks.push(s);
        i = j + 1;
        continue;
      }
    }
    if (c0 === 35) {
      const h = headingOf(line);
      if (h !== null) {
        const id = uniqueSlug(slugify(cx, h.text), ids);
        const html = inlineStr(h.text, env);
        blocks.push(`<h${h.depth} id="${id}">${html}</h${h.depth}>`);
        if (h.depth === 2 || h.depth === 3) toc.push({ level: h.depth, id, html });
        i++;
        continue;
      }
    }
    if (isHr(line)) { blocks.push('<hr>'); i++; continue; }
    if (c0 === 62) {
      const body = [];
      while (i < end && lines[i].charCodeAt(0) === 62) {
        const l = lines[i++];
        body.push(l.length > 1 && l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1));
      }
      const qb = [];
      for (let k = 0; k < body.length; k++) {
        const t = trimLine(body[k]);
        if (t !== '') qb.push(t);
      }
      blocks.push(qb.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${inlineStr(qb.join('\n'), env)}</p>\n</blockquote>`);
      continue;
    }
    const bt = bulletText(line);
    const oi = bt === null ? orderedItem(line) : null;
    if (bt !== null || oi !== null) {
      const isOrdered = oi !== null;
      const items = [];
      while (i < end) {
        const li = lines[i];
        const m = isOrdered ? orderedItem(li) : bulletText(li);
        if (m !== null) {
          items.push([trimLine(isOrdered ? m.text : m)]);
          i++;
        } else if (isContinued(li)) {
          items[items.length - 1].push(trimLine(li));
          i++;
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && oi.start !== 1 ? `<ol start="${oi.start}">` : `<${tag}>`;
      let s = open + '\n';
      for (let k = 0; k < items.length; k++) s += `<li>${inlineStr(items[k].join('\n'), env)}</li>\n`;
      s += `</${tag}>`;
      blocks.push(s);
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < end && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inlineStr(body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    blocks.push(`<p>${html}</p>`);
  }
  return { html: blocks.length === 0 ? '' : blocks.join('\n') + '\n', toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

class TemplateError extends Error {}

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

/**
 * The free (unbound) first names a template reads, walking its includes in the
 * same scope. A template whose free names are only site/tags/recent renders the
 * same in every page scope (unless an enclosing loop binds one of those three),
 * so its output can be rendered once per depth and reused: the Hugo partialCached
 * idea, proved per template instead of assumed.
 */
function freeOf(templates, name) {
  const free = new Set();
  const stack = new Set([name]);
  const walk = (nodes, bound) => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.kind === 'text') continue;
      if (n.kind === 'var' || n.kind === 'raw') {
        if (!bound.has(n.path[0])) free.add(n.path[0]);
      } else if (n.kind === 'if') {
        if (!bound.has(n.path[0])) free.add(n.path[0]);
        walk(n.then, bound);
        if (n.else !== null) walk(n.else, bound);
      } else if (n.kind === 'for') {
        if (!bound.has(n.path[0])) free.add(n.path[0]);
        const b2 = new Set(bound);
        b2.add(n.name);
        b2.add('loop');
        walk(n.body, b2);
      } else if (n.kind === 'include') {
        const t = templates.get(n.name);
        if (t === undefined) continue;
        if (stack.has(n.name)) { free.add('\0cycle'); continue; }
        stack.add(n.name);
        walk(t, bound);
        stack.delete(n.name);
      }
    }
  };
  walk(templates.get(name), new Set());
  return free;
}

function computeInvariant(templates) {
  const inv = new Set();
  for (const name of templates.keys()) {
    const free = freeOf(templates, name);
    if (free.has('\0cycle')) continue;
    let ok = true;
    for (const f of free) {
      if (f !== 'site' && f !== 'tags' && f !== 'recent') { ok = false; break; }
    }
    if (ok) inv.add(name);
  }
  return inv;
}

function lookup(scope, path) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    let s = '';
    for (let i = 0; i < v.length; i++) {
      if (i > 0) s += ', ';
      s += textOf(v[i]);
    }
    return s;
  }
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

function renderInto(nodes, scope, ctx, depth, out, shadowed) {
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    switch (n.kind) {
      case 'text':
        out.push(n.text);
        break;
      case 'var':
        out.push(escapeHtml(textOf(lookup(scope, n.path))));
        break;
      case 'raw':
        out.push(textOf(lookup(scope, n.path)));
        break;
      case 'if': {
        const v = truthy(lookup(scope, n.path));
        const branch = v !== n.not ? n.then : n.else;
        if (branch !== null) renderInto(branch, scope, ctx, depth, out, shadowed);
        break;
      }
      case 'for': {
        const xs = lookup(scope, n.path);
        if (!Array.isArray(xs)) break;
        const sh = shadowed || n.name === 'site' || n.name === 'tags' || n.name === 'recent';
        // One vars/scope pair per execution, mutated per iteration: rendering is
        // synchronous and depth-first, so no iteration can observe another's
        // values, and a re-entrant execution of this node makes its own pair.
        // `loop` is set after the element, so a loop var named "loop" still
        // resolves to the loop record, as the baseline's literal does.
        const vars = {};
        const loop = { index: 0, first: false, last: false, length: xs.length };
        vars.loop = loop;
        const child = { vars, parent: scope };
        for (let k = 0; k < xs.length; k++) {
          vars[n.name] = xs[k];
          vars.loop = loop;
          loop.index = k + 1;
          loop.first = k === 0;
          loop.last = k === xs.length - 1;
          renderInto(n.body, child, ctx, depth, out, sh);
        }
        break;
      }
      case 'include': {
        const t = ctx.templates.get(n.name);
        if (t === undefined || depth >= 8) break;
        if (ctx.invariant.has(n.name) && !shadowed) {
          const key = n.name + '\n' + (depth + 1);
          let cached = ctx.invCache.get(key);
          if (cached === undefined) {
            const tmp = [];
            renderInto(t, ctx.globalScope, ctx, depth + 1, tmp, false);
            cached = tmp.join('');
            ctx.invCache.set(key, cached);
          }
          out.push(cached);
        } else {
          renderInto(t, scope, ctx, depth + 1, out, shadowed);
        }
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- links

function isScheme(t) {
  const c0 = t.charCodeAt(0);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return false;
  for (let i = 1; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 58) return true;
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) continue;
    return false;
  }
  return false;
}

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

// ---------------------------------------------------------------- pipeline

/** One site's output tree: path -> text. */
export function run(input) {
  const cx = { slug: new Map(), date: new Map() };
  const templates = new Map();
  const rep = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      rep.push(err.message);
    }
  }
  const invariant = computeInvariant(templates);
  const base = input.site.base_url.replace(/\/+$/, '');
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      const text = f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n');
      sources.push({ path: f.path, text });
    } else statics.push({ path: f.path, content: f.content });
  }
  const kept = [];
  for (const s of sources) {
    const lines = s.text.split('\n');
    const fm = parseFrontMatter(lines);
    if ('error' in fm) {
      rep.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.lines = lines;
    s.bodyStart = fm.bodyStart;
    s.post = s.path.startsWith('posts/');
    const own = s.path.startsWith('tags/') ? 'tags' : s.path.startsWith('page/') ? 'page' : undefined;
    if (own !== undefined) {
      rep.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      rep.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      rep.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      rep.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  const taken = new Map();
  const bySource = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugify(cx, s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  for (const s of kept) {
    const dir = dirOf(s.path);
    let linkCache = null;
    const env = {
      link: (target) => {
        if (target.charCodeAt(0) === 47 || target.charCodeAt(0) === 35) return target;
        if (isScheme(target)) return target;
        if (linkCache !== null) {
          const cached = linkCache.get(target);
          if (cached !== undefined) return cached;
        }
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        let result;
        if (path !== null && bySource.has(path)) result = `${bySource.get(path).url}${frag}`;
        else if (path !== null && staticPaths.has(path)) result = `${base}/${path}${frag}`;
        else {
          broken.add(`broken-link ${s.path} -> ${target}`);
          result = target;
        }
        if (linkCache === null) linkCache = new Map();
        linkCache.set(target, result);
        return result;
      },
    };
    const md = renderMarkdownLines(s.lines, s.bodyStart, s.lines.length, env, cx);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
    s.reading = Math.max(1, Math.ceil(countWords(s.lines, s.bodyStart, s.lines.length) / 200));
  }
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of (s.data.tags ?? [])) {
      const slug = slugify(cx, name);
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push(name);
      }
    }
    return out;
  };
  const bySlug = new Map();
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(cx, name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map((name) => {
      const slug = slugify(cx, name);
      const t = bySlug.get(slug);
      return t !== undefined ? t : { name, slug, url: '', posts: [] };
    });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));
  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(cx, s.data.date) });
  const cardOf = (s) => {
    if (s.card !== undefined) return s.card;
    const c = {
      title: s.data.title,
      url: s.url,
      date: s.data.date ?? '',
      date_long: s.data.date === undefined ? '' : longDate(cx, s.data.date),
      summary: s.data.summary ?? '',
      excerpt: s.excerpt,
      reading_minutes: s.reading,
      tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    };
    s.card = c;
    return c;
  };
  const pageOf = (s) => ({
    ...cardOf(s),
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  });
  const cards = new Map(posts.map((p) => [p, cardOf(p)]));
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const tctx = { templates, invariant, invCache: new Map(), globalScope: { vars: { site, tags: allTags, recent }, parent: null } };
  const output = {};
  const render = (name, vars) => {
    const nodes = templates.get(name);
    if (nodes === undefined) return null;
    const out = [];
    renderInto(nodes, { vars: { site, tags: allTags, recent, ...vars }, parent: null }, tctx, 0, out, false);
    return out.join('');
  };
  for (const s of kept) output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) rep.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }
  const lines = [...rep, ...broken].sort(byCodeUnits);
  const pageCount = kept.filter((s) => !s.post).length;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = `${lines.join('\n')}\n`;
  return output;
}
