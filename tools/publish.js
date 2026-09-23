#!/usr/bin/env node
// Adds a release to the feed: node tools/publish.js <patchmap|standby> <package file> [--min-shell X.Y.Z]
//
// Reads the version + notes from the package's own manifest.json, copies the package into <app>/, signs it with
// the key in ~/.config/bsi-updates/signing-key.pem and rewrites <app>/latest.json, then commits. It doesn't push:
// the apps see the release once `git push` runs.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { signedText, verifyRelease, sha256, cmpVer } = require('../client/updater');

const APPS = { patchmap: { ext: '.pmupdate', name: 'PatchMap' }, standby: { ext: '.sbupdate', name: 'StandBy' } };
const KEY = process.env.BSI_SIGNING_KEY || path.join(require('os').homedir(), '.config', 'bsi-updates', 'signing-key.pem');
const repo = path.join(__dirname, '..');

const args = process.argv.slice(2);
const fail = msg => { console.error(msg); process.exit(1); };
const flag = name => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const minShell = flag('--min-shell');
const noCommit = args.includes('--no-commit'); if (noCommit) args.splice(args.indexOf('--no-commit'), 1);
const [appId, pkg] = args;
if (!APPS[appId] || !pkg) fail('usage: node tools/publish.js <patchmap|standby> <package file> [--min-shell X.Y.Z] [--no-commit]');
if (!fs.existsSync(KEY)) fail(`No signing key at ${KEY}`);
if (minShell && !/^\d+\.\d+\.\d+$/.test(minShell)) fail('--min-shell must look like 1.2.3');

let man;
try { man = JSON.parse(execFileSync('/usr/bin/unzip', ['-p', pkg, 'manifest.json'], { encoding: 'utf8' })); } catch { fail(`${pkg} has no manifest.json at its top level`); }
if (man.app !== appId) fail(`${pkg} is a ${man.app} package, not ${appId}`);
if (!/^\d+\.\d+\.\d+$/.test(man.version || '')) fail(`bad version in ${pkg}: ${man.version}`);

const dir = path.join(repo, appId);
fs.mkdirSync(dir, { recursive: true });
const latestFile = path.join(dir, 'latest.json');
const prev = fs.existsSync(latestFile) ? JSON.parse(fs.readFileSync(latestFile, 'utf8')) : null;
if (prev && cmpVer(man.version, prev.version) <= 0) fail(`${man.version} isn’t newer than the published ${prev.version}`);

const file = `${APPS[appId].name}-${man.version}${APPS[appId].ext}`;
const buf = fs.readFileSync(pkg);
fs.writeFileSync(path.join(dir, file), buf);
const release = { app: appId, version: man.version, notes: man.notes || '', file, sha256: sha256(buf), size: buf.length, released: new Date().toISOString() };
if (minShell || man.minShell) release.minShell = minShell || man.minShell;
release.sig = crypto.sign(null, Buffer.from(signedText(release)), fs.readFileSync(KEY)).toString('base64');
verifyRelease(release, appId);   // the key baked into the apps accepts it
fs.writeFileSync(latestFile, JSON.stringify(release, null, 2) + '\n');
console.log(`${APPS[appId].name} ${man.version}: ${file} (${Math.round(buf.length / 1024)} KB)${release.minShell ? `, needs app ${release.minShell}+` : ''}`);

if (!noCommit) {
  execFileSync('git', ['add', appId], { cwd: repo, stdio: 'inherit' });
  execFileSync('git', ['commit', '-q', '-m', `${APPS[appId].name} ${man.version}\n\n${man.notes || ''}`.trim()], { cwd: repo, stdio: 'inherit' });
  console.log('Committed. Run `git push` in bsi-app-updates to release it.');
}
