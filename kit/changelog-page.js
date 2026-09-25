// Renders an app's changelog into the HTML fragment its manual shows under "What's new".
// Takes either form BSI apps use: CHANGELOG.md (StandBy, Loader: "## 0.3.1 · 2026-09-24" headings with "- " items)
// or changelog.json (PatchMap: [{version, date, items:[…]}]). Same output either way: <h3> per version with the
// version, the date, a "this version" pill for the running one, then a <ul> of items. **bold** is honoured.
//
// Works in Node (main process hands the HTML to the manual window) and in a page (window.renderChangelog).
// Source of truth: bsi-app-updates/kit/changelog-page.js; `node tools/sync-kit.js` copies it out.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.renderChangelog = factory().renderChangelog;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // CHANGELOG.md → [{version, date, items}]
  function parseMarkdown(md) {
    const out = [];
    let cur = null;
    for (const line of String(md || '').split('\n')) {
      const h = line.match(/^##\s+(.*)/), li = line.match(/^\s*[-*]\s+(.*)/);
      if (h) { const [v, ...rest] = h[1].trim().split(/\s+[·—–-]\s+/); cur = { version: v.trim(), date: rest.join(' · ').trim(), items: [] }; out.push(cur); }
      else if (li && cur) cur.items.push(li[1].trim());
      else if (cur && cur.items.length && /^\s{2,}\S/.test(line)) cur.items[cur.items.length - 1] += ' ' + line.trim();   // wrapped item
    }
    return out;
  }

  // changelog.json (string or parsed) → [{version, date, items}]
  function parseJson(json) {
    const list = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(list)) throw new Error('changelog.json should be a list of releases');
    return list.map(r => ({ version: String(r.version || ''), date: String(r.date || ''), items: Array.isArray(r.items) ? r.items.map(String) : [] }));
  }

  // Accepts { markdown } or { json } (or a bare string: JSON if it starts with "[", else markdown).
  function parseChangelog(src) {
    if (src == null) return [];
    if (typeof src === 'string') return /^\s*\[/.test(src) ? parseJson(src) : parseMarkdown(src);
    if (Array.isArray(src)) return parseJson(src);
    if (src.json != null) return parseJson(src.json);
    return parseMarkdown(src.markdown);
  }

  // → HTML fragment. current: the running version, marked "this version". limit: newest N releases (default all).
  function renderChangelog(src, { current = '', limit = 0, pillClass = 'pill new', verClass = 'ver', dateClass = 'date' } = {}) {
    let releases = parseChangelog(src);
    if (limit > 0) releases = releases.slice(0, limit);
    if (!releases.length) return '<p>No changes listed.</p>';
    return releases.map(r => {
      const pill = r.version && r.version === current ? ` <span class="${pillClass}">this version</span>` : '';
      const date = r.date ? ` <span class="${dateClass}">· ${esc(r.date)}</span>` : '';
      const items = r.items.length ? `<ul>${r.items.map(i => `<li>${inline(i)}</li>`).join('')}</ul>` : '';
      return `<h3 id="v${esc(r.version).replace(/\./g, '-')}"><span class="${verClass}">${esc(r.version)}</span>${date}${pill}</h3>${items}`;
    }).join('\n');
  }

  // The newest release as one plain sentence-ish string (for release notes): items joined, markdown stripped.
  function latestNotes(src, max = 600) {
    const [r] = parseChangelog(src);
    if (!r) return '';
    let text = r.items.map(i => i.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()).join(' ');
    if (text.length > max) text = text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
    return text;
  }

  return { renderChangelog, parseChangelog, parseMarkdown, parseJson, latestNotes };
});
