// The design tokens: tokens.css is built from tokens.json, and every text role clears WCAG AA on every surface it is
// used on, in both themes, for all four app hues.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'kit', 'design');
const tokens = JSON.parse(fs.readFileSync(path.join(dir, 'tokens.json'), 'utf8'));
const { build } = require('../tools/build-tokens');

const lum = hex => { const c = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(c.substr(i, 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * r + .7152 * g + .0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const isHex = v => /^#[0-9a-f]{6}$/i.test(v);

test('tokens.css is exactly what tokens.json builds', () => {
  assert.equal(fs.readFileSync(path.join(dir, 'tokens.css'), 'utf8'), build(tokens));
});

test('every token the CSS declares exists in the JSON and vice versa', () => {
  const css = fs.readFileSync(path.join(dir, 'tokens.css'), 'utf8');
  const declared = new Set([...css.matchAll(/--bsi-([a-z0-9-]+):/g)].map(m => m[1]));
  const expected = new Set([...Object.keys(tokens.static), ...Object.keys(tokens.themes.light), 'accent', 'on-accent', 'accent-ink', 'accent-soft', 'info',
    ...Object.values(tokens.apps).flatMap(a => [...Object.keys(a.light), ...Object.keys(a.dark), ...Object.keys(a.static || {})])]);
  for (const k of expected) assert.ok(declared.has(k), `css lacks --bsi-${k}`);
  for (const k of declared) assert.ok(expected.has(k), `json lacks ${k}`);
  assert.deepEqual(Object.keys(tokens.themes.light).sort(), Object.keys(tokens.themes.dark).sort(), 'light and dark declare the same roles');
});

// Resolve the palette an app sees in a theme: theme roles, then the app's overrides
function palette(app, theme) { return Object.assign({}, tokens.themes[theme], tokens.apps[app][theme]); }

test('text roles pass WCAG AA on every surface, both themes, all four apps', () => {
  const fails = [];
  for (const app of Object.keys(tokens.apps)) for (const theme of ['light', 'dark']) {
    const p = palette(app, theme);
    const surfaces = ['bg-base', 'bg-raised', 'bg-lit'];
    const text = ['fg', 'fg-muted', 'accent-ink', 'ok', 'warn', 'danger', 'done'];
    for (const s of surfaces) for (const t of text) { const c = contrast(p[t], p[s]); if (c < 4.5) fails.push(`${app}/${theme}: ${t} ${p[t]} on ${s} ${p[s]} = ${c.toFixed(2)}`); }
    // faint is for glyphs, so 3:1 on base and raised
    for (const s of ['bg-base', 'bg-raised']) { const c = contrast(p['fg-faint'], p[s]); if (c < 3) fails.push(`${app}/${theme}: fg-faint on ${s} = ${c.toFixed(2)}`); }
    // text on fills
    for (const [fill, on] of [['accent', 'on-accent'], ['ok', 'on-ok'], ['warn', 'on-warn'], ['danger', 'on-danger'], ['done', 'on-done']]) {
      const c = contrast(p[on], p[fill]); if (c < 4.5) fails.push(`${app}/${theme}: ${on} on ${fill} = ${c.toFixed(2)}`);
    }
    // hairlines visible: 1.3:1 at least against the surface they sit on
    for (const [line, s] of [['border', 'bg-base'], ['border-strong', 'bg-raised'], ['border-lit', 'bg-lit']]) { const c = contrast(p[line], p[s]); if (c < 1.15) fails.push(`${app}/${theme}: ${line} on ${s} = ${c.toFixed(2)}`); }
  }
  assert.deepEqual(fails, []);
});

test('tape colours are the shop stock and never change per app or theme', () => {
  const tape = Object.entries(tokens.static).filter(([k]) => k.startsWith('tape-'));
  assert.equal(tape.filter(([k]) => /^tape-(red|yellow|blue|green|orange|purple|black|white)$/.test(k)).length, 8);
  for (const [, v] of tape) assert.ok(isHex(v), v);
  for (const app of Object.values(tokens.apps)) for (const th of ['light', 'dark']) for (const k of Object.keys(app[th])) assert.ok(!k.startsWith('tape-') && !['ok', 'warn', 'danger', 'done'].includes(k), `${app.name} may not override ${k}`);
  // tape tags: the named text colour clears AA on each tape
  for (const t of ['red', 'black']) assert.ok(contrast(tokens.static['tape-fg-light'], tokens.static['tape-' + t]) >= 4.5, t);
  for (const t of ['yellow', 'white', 'orange', 'green', 'blue', 'purple']) assert.ok(contrast(tokens.static['tape-fg-dark'], tokens.static['tape-' + t]) >= 4.5, t);
});

test('base.css only uses --bsi- tokens for colour and the gallery loads both files', () => {
  const base = fs.readFileSync(path.join(dir, 'base.css'), 'utf8');
  const literal = [...base.matchAll(/#[0-9a-f]{3,6}\b/gi)].map(m => m[0]);
  assert.deepEqual(literal, [], 'no literal colours in base.css');
  const gallery = fs.readFileSync(path.join(dir, 'gallery.html'), 'utf8');
  assert.match(gallery, /href="tokens\.css"/); assert.match(gallery, /href="base\.css"/);
  for (const app of Object.keys(tokens.apps)) assert.match(gallery, new RegExp(`data-app="${app}"`));
});
