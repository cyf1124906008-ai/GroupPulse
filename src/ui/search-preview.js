'use strict';
// Shared by the read-only worker and the local UI. No chat content becomes HTML.
(() => {
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const normalize = (value, loose = false) => {
    const text = String(value ?? '').normalize('NFKC').toLocaleLowerCase();
    return loose ? text.replace(/[\s_-]+/gu, '') : text;
  };
  function terms(value, loose = false) {
    const values = Array.isArray(value) ? value : String(value ?? '').normalize('NFKC').split(loose ? /[\s,、;]+/u : /[,，;；\n]+/u);
    return [...new Set(values.map(value => normalize(String(value).trim(), loose)).filter(Boolean))].slice(0, 100);
  }
  function ranges(value, query, loose = false) {
    const text = String(value ?? ''), needles = terms(query, loose);
    if (!text || !needles.length) return [];
    const start = [], end = [], normalized = [];
    const fallback = []; let offset = 0;
    if (!segmenter) for (const segment of text) { fallback.push({ segment, index: offset }); offset += segment.length; }
    const segments = segmenter ? segmenter.segment(text) : fallback;
    for (const part of segments) {
      const content = normalize(part.segment, loose);
      normalized.push(content);
      for (let n = 0; n < content.length; n++) { start.push(part.index); end.push(part.index + part.segment.length); }
    }
    const whole = normalize(text, loose), pieces = normalized.join('');
    const source = whole.length === start.length ? whole : pieces, found = [];
    for (const [term, needle] of needles.entries()) {
      let from = 0, at, count = 0;
      while ((at = source.indexOf(needle, from)) >= 0 && count++ < 512) {
        found.push({ start: start[at], end: end[at + needle.length - 1], terms: [term] }); from = at + Math.max(1, needle.length);
      }
    }
    const merged = [];
    for (const span of found.sort((a, b) => a.start - b.start || b.end - a.end)) {
      const previous = merged.at(-1);
      if (previous && span.start <= previous.end) { previous.end = Math.max(previous.end, span.end); previous.terms = [...new Set([...previous.terms, ...span.terms])]; }
      else merged.push({ ...span });
    }
    return merged;
  }
  function parts(value, query, loose = false) {
    const text = String(value ?? ''), spans = ranges(text, query, loose), result = []; let from = 0;
    for (const span of spans) {
      if (span.start > from) result.push({ text: text.slice(from, span.start), hit: false });
      result.push({ text: text.slice(span.start, span.end), hit: true }); from = span.end;
    }
    if (from < text.length || !result.length) result.push({ text: text.slice(from), hit: false });
    return result;
  }
  function preview(value, query, options = {}) {
    const text = String(value ?? ''), loose = Boolean(options.loose), spans = ranges(text, query, loose);
    const budget = Math.max(120, Math.min(1800, options.maxChars || 420));
    if (text.length <= budget && text.split('\n').length <= 6) return { fragments: [{ start: 0, end: text.length, text }], hasHit: spans.length > 0, omitted: false, fullLength: text.length };
    if (!spans.length) return { fragments: [{ start: 0, end: Math.min(text.length, budget), text: text.slice(0, budget) }], hasHit: false, omitted: text.length > budget, fullLength: text.length };
    // Include different query terms before spending space on repeated mentions.
    const selected = [], seen = new Set();
    for (const span of spans) if (span.terms.some(term => !seen.has(term))) { selected.push(span); span.terms.forEach(term => seen.add(term)); if (selected.length === 3) break; }
    for (const span of spans) { if (selected.length === 3) break; if (!selected.includes(span)) selected.push(span); }
    const windows = [], perWindow = Math.max(100, Math.floor(budget / selected.length));
    for (const span of selected) {
      let left = Math.max(0, span.start - Math.floor(perWindow * .36)), right = Math.min(text.length, Math.max(span.end, left + perWindow));
      const leftSlice = text.slice(left, span.start), before = [...leftSlice.matchAll(/[。！？!?；;\n]/gu)].at(-1);
      if (before) left += before.index + before[0].length;
      const after = /[。！？!?；;\n]|\.(?=\s|$)/u.exec(text.slice(span.end, right));
      if (after) right = span.end + after.index + after[0].length;
      if (left > 0 && /[\uDC00-\uDFFF]/u.test(text[left])) left--;
      if (right < text.length && /[\uD800-\uDBFF]/u.test(text[right - 1])) right++;
      windows.push({ start: left, end: right });
    }
    const merged = [];
    for (const span of windows.sort((a, b) => a.start - b.start)) {
      const previous = merged.at(-1);
      if (previous && span.start <= previous.end + 16) previous.end = Math.max(previous.end, span.end);
      else merged.push({ ...span });
    }
    const fragments = merged.map(span => ({ ...span, text: text.slice(span.start, span.end) }));
    return { fragments, hasHit: true, omitted: fragments.length > 1 || fragments[0].start > 0 || fragments[0].end < text.length, fullLength: text.length };
  }
  function paint(target, value, query, loose = false) {
    const doc = target.ownerDocument || document;
    target.replaceChildren();
    for (const part of parts(value, query, loose)) {
      const element = doc.createElement(part.hit ? 'mark' : 'span'); element.textContent = part.text;
      if (part.hit) element.className = 'gp-search-hit';
      target.append(element);
    }
    return target;
  }
  function paintPreview(target, value, query, options = {}, prepared = null) {
    const doc = target.ownerDocument || document, result = prepared || preview(value, query, options);
    target.replaceChildren();
    for (const fragment of result.fragments) {
      const line = doc.createElement('span'); line.className = 'gp-preview-fragment';
      if (fragment.start > 0) { const gap = doc.createElement('span'); gap.className = 'gp-preview-ellipsis'; gap.textContent = '… '; line.append(gap); }
      const content = doc.createElement('span'); paint(content, fragment.text, query, options.loose); line.append(content);
      if (fragment.end < result.fullLength) { const gap = doc.createElement('span'); gap.className = 'gp-preview-ellipsis'; gap.textContent = ' …'; line.append(gap); }
      target.append(line);
    }
    return result;
  }
  const api = { normalize, terms, ranges, parts, preview, paint, paintPreview };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.GroupPulseText = api;
})();
