#!/usr/bin/env node
// Copies the shared kit (kit/) into each app, so every app checks updates, sends feedback and shows its
// changelog the same way.
//
//   node tools/sync-kit.js            copy kit files into PatchMap, StandBy and Loader
//   node tools/sync-kit.js --check    only report which app copies differ from the kit (exit 1 if any do)
//   node tools/sync-kit.js patchmap   one app (patchmap | standby | loader)
//   --patchmap-dir / --standby-dir / --loader-dir <path>   where an app lives, if not the usual place
//
// Loader usually lives in ~/loader; while its work sits in a worktree, pass --loader-dir or set BSI_LOADER_DIR.
'use strict';

const fs = require('fs');
const path = require('path');
const home = require('os').homedir();

const kit = path.join(__dirname, '..', 'kit');
const args = process.argv.slice(2);
const check = args.includes('--check');
const dirFlag = name => { const i = args.indexOf(`--${name}-dir`); return i >= 0 ? path.resolve(args[i + 1]) : null; };

// Loader: ~/loader, unless it holds no app code and the 0.1 worktree does
function loaderDir() {
  const env = process.env.BSI_LOADER_DIR && path.resolve(process.env.BSI_LOADER_DIR);
  const main = path.join(home, 'loader'), wt = path.join(home, 'loader', '.claude', 'worktrees', 'loader-0.1');
  if (env) return env;
  if (fs.existsSync(path.join(main, 'lib'))) return main;
  return fs.existsSync(path.join(wt, 'lib')) ? wt : main;
}

// Where each kit file goes in each app. `web` files live next to the manual.
const APPS = {
  patchmap: { dir: dirFlag('patchmap') || path.join(home, 'patchmap'), lib: 'code', web: 'code/web' },
  standby: { dir: dirFlag('standby') || path.join(home, 'bsi-showcall-app', 'host'), lib: 'lib', web: 'web' },
  loader: { dir: dirFlag('loader') || loaderDir(), lib: 'lib', web: 'web' },
};
const FILES = [
  { src: 'updater.js', to: 'lib' },
  { src: 'app-updates-core.js', to: 'lib' },
  { src: 'feedback.js', to: 'lib' },
  { src: 'feedback-preload.js', to: 'lib' },
  { src: 'feedback.html', to: 'lib' },
  { src: 'changelog-page.js', to: 'web' },
  // the design system: beside the feedback window (it links them) and beside the manual (for its What's new)
  { src: 'design/tokens.css', to: 'lib', as: 'bsi-tokens.css' },
  { src: 'design/base.css', to: 'lib', as: 'bsi-base.css' },
  { src: 'design/tokens.css', to: 'web', as: 'bsi-tokens.css' },
  { src: 'design/base.css', to: 'web', as: 'bsi-base.css' },
];

const wanted = args.filter(a => APPS[a]);
const apps = wanted.length ? wanted : Object.keys(APPS);
let drift = 0;
for (const id of apps) {
  const app = APPS[id];
  if (!fs.existsSync(app.dir)) { console.log(`${id}: no app at ${app.dir}, skipped`); continue; }
  for (const f of FILES) {
    const src = path.join(kit, f.src), dest = path.join(app.dir, app[f.to], f.as || f.src);
    const have = fs.existsSync(dest) ? fs.readFileSync(src).equals(fs.readFileSync(dest)) : null;
    if (check) {
      if (have === true) continue;
      drift++;
      console.log(`${id}: ${path.relative(app.dir, dest)} ${have === null ? 'is missing' : 'differs from the kit'}`);
      continue;
    }
    if (!fs.existsSync(path.dirname(dest))) { console.log(`${id}: no folder ${path.dirname(dest)}, skipped ${f.src}`); continue; }
    if (have === true) continue;
    fs.copyFileSync(src, dest);
    console.log(`${id}: ${have === null ? 'added' : 'updated'} ${path.relative(app.dir, dest)}`);
  }
}
if (check) { console.log(drift ? `${drift} file(s) differ. Run node tools/sync-kit.js to copy the kit out.` : 'Every app matches the kit.'); process.exit(drift ? 1 : 0); }
