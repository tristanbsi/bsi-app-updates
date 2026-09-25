#!/usr/bin/env node
// Builds kit/design/tokens.css from kit/design/tokens.json (the source of truth), so scripts and stylesheets
// can never disagree. `node tools/build-tokens.js` writes the file; `--check` only says whether it is current.
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'kit', 'design');
const tokens = JSON.parse(fs.readFileSync(path.join(dir, 'tokens.json'), 'utf8'));

const decl = (obj, indent = '  ') => Object.entries(obj).map(([k, v]) => `${indent}--bsi-${k}: ${v};`).join('\n');

function build(t) {
  const out = [];
  out.push('/* BSI design tokens — GENERATED from tokens.json by tools/build-tokens.js. Edit the JSON, not this file. */');
  out.push('/* Light is the base; dark follows the Mac unless [data-theme] says otherwise. [data-app] sets the identity hue only. */');
  out.push(`:root {\n  color-scheme: light dark;\n${decl(t.static)}\n${decl(t.themes.light)}\n  --bsi-accent: ${t.apps.shopcall.light.accent}; --bsi-on-accent: ${t.apps.shopcall.light['on-accent']}; --bsi-accent-ink: ${t.apps.shopcall.light['accent-ink']}; --bsi-accent-soft: ${t.apps.shopcall.light['accent-soft']};\n  --bsi-info: var(--bsi-accent);\n}`);
  out.push(`@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n${decl(t.themes.dark, '    ')}\n    --bsi-accent: ${t.apps.shopcall.dark.accent}; --bsi-on-accent: ${t.apps.shopcall.dark['on-accent']}; --bsi-accent-ink: ${t.apps.shopcall.dark['accent-ink']}; --bsi-accent-soft: ${t.apps.shopcall.dark['accent-soft']};\n  }\n}`);
  out.push(`:root[data-theme="dark"] {\n${decl(t.themes.dark)}\n  --bsi-accent: ${t.apps.shopcall.dark.accent}; --bsi-on-accent: ${t.apps.shopcall.dark['on-accent']}; --bsi-accent-ink: ${t.apps.shopcall.dark['accent-ink']}; --bsi-accent-soft: ${t.apps.shopcall.dark['accent-soft']};\n}`);
  for (const [id, app] of Object.entries(t.apps)) {
    out.push(`\n/* ${app.name}: ${app.identity} */`);
    const light = Object.assign({}, app.static || {}, app.light);
    out.push(`[data-app="${id}"] {\n${decl(light)}\n}`);
    out.push(`@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) [data-app="${id}"], :root:not([data-theme="light"])[data-app="${id}"] {\n${decl(app.dark, '    ')}\n  }\n}`);
    out.push(`:root[data-theme="dark"] [data-app="${id}"], :root[data-theme="dark"][data-app="${id}"] {\n${decl(app.dark)}\n}`);
  }
  out.push('\n@media (prefers-reduced-motion: reduce) { :root { --bsi-dur-fast: 0ms; --bsi-dur-base: 0ms; --bsi-dur-slow: 0ms; } }');
  return out.join('\n') + '\n';
}

const css = build(tokens);
const target = path.join(dir, 'tokens.css');
if (process.argv.includes('--check')) {
  const have = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (have === css) { console.log('tokens.css is current.'); process.exit(0); }
  console.log('tokens.css is out of date: run node tools/build-tokens.js'); process.exit(1);
}
fs.writeFileSync(target, css);
console.log('wrote ' + path.relative(process.cwd(), target));
module.exports = { build };
