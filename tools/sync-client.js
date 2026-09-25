#!/usr/bin/env node
// Copies client/updater.js into each app, so every app checks and verifies updates the same way.
'use strict';

const fs = require('fs');
const path = require('path');
const home = require('os').homedir();

const src = path.join(__dirname, '..', 'client', 'updater.js');
const targets = (process.argv.slice(2).length ? process.argv.slice(2) : [
  path.join(home, 'patchmap', 'code', 'updater.js'),
  path.join(home, 'bsi-showcall-app', 'host', 'lib', 'updater.js'),
  path.join(home, 'loader', 'lib', 'updater.js'),
  path.join(home, 'trusstape', 'lib', 'updater.js'),
]);
for (const t of targets) {
  if (!fs.existsSync(path.dirname(t))) { console.log(`skip ${t} (no folder)`); continue; }
  fs.copyFileSync(src, t);
  console.log(`copied to ${t}`);
}
