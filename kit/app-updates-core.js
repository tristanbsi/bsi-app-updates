// Installed code updates (from Check for Updates…): each version gets its own folder under app-code/, and
// current.json says which one starts. Installing never touches a folder a running copy is using; it only changes
// which folder the next start uses. boot.js (inside the app) picks the folder; if an installed update fails to
// start it falls back to the app's own code.
//
// Shared by every BSI desktop app. Each app keeps a tiny lib/app-updates.js that says who it is:
//
//   module.exports = require('./app-updates-core').createAppUpdates({
//     appId: 'standby', appName: 'StandBy', dataFolder: 'ShowCall', devEnv: 'STANDBY_DEV_CODE_ROOT',
//     writeFileDurably: require('./journal').writeFileDurably,
//   });
//
// Source of truth: bsi-app-updates/kit/app-updates-core.js; `node tools/sync-kit.js` copies it out.
'use strict';

const fs = require('fs');
const path = require('path');
const { cmpVer } = require('./updater');

const versionOf = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || null; } catch { return null; } };
const isCode = dir => fs.existsSync(path.join(dir, 'main.js')) && !!versionOf(dir);

// Plain durable write for apps that don't bring their own (write to a side file, fsync, rename into place)
function defaultWriteFileDurably(file, text) {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

// opts: { appId, appName, dataFolder (under ~/Library/Application Support), devEnv (env var that points a dev
//         copy at a test folder), writeFileDurably? }
function createAppUpdates(opts) {
  const { appId, appName, dataFolder, devEnv } = opts;
  if (!appId || !appName || !dataFolder) throw new Error('createAppUpdates needs appId, appName and dataFolder');
  const writeFileDurably = opts.writeFileDurably || defaultWriteFileDurably;

  // Where updates are kept: ~/Library/Application Support/<dataFolder>/app-code.
  // A development copy only uses installed updates when the devEnv variable points it at a test folder.
  function codeRoot(app) {
    if (!app.isPackaged) return (devEnv && process.env[devEnv]) || null;
    return path.join(app.getPath('appData'), dataFolder, 'app-code');
  }

  function readCurrent(root) {
    try { const c = JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8')); return c && c.version ? c : null; } catch { return null; }
  }

  // The folder to start from: the installed update when it's newer than the app's own code, else the app's own
  function pickCodeDir(root, bundleDir) {
    const cur = root && readCurrent(root);
    if (!cur || !/^\d+\.\d+\.\d+$/.test(cur.version)) return bundleDir;
    const dir = path.join(root, cur.version);
    return isCode(dir) && cmpVer(cur.version, versionOf(bundleDir) || '0') > 0 ? dir : bundleDir;
  }

  // Installs an unpacked update (manifest.json + code/). running: the version this copy is running now.
  // Returns the manifest. Keeps the running version and the one before, so Go Back has somewhere to go.
  function installUnpacked(root, unpacked, { running }) {
    let m;
    try { m = JSON.parse(fs.readFileSync(path.join(unpacked, 'manifest.json'), 'utf8')); } catch { throw new Error(`That isn’t a ${appName} update.`); }
    const code = path.join(unpacked, 'code');
    if (m.app !== appId || !/^\d+\.\d+\.\d+$/.test(m.version || '') || !isCode(code)) throw new Error(`That isn’t a complete ${appName} update.`);
    if (versionOf(code) !== m.version) throw new Error(`The update says ${m.version} but its code is ${versionOf(code)}.`);
    fs.mkdirSync(root, { recursive: true });
    const dest = path.join(root, m.version);
    if (!isCode(dest) || versionOf(dest) !== m.version) {
      const staging = `${dest}.new`;
      fs.rmSync(staging, { recursive: true, force: true });
      fs.cpSync(code, staging, { recursive: true, verbatimSymlinks: true });
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(staging, dest);
    }
    const prev = readCurrent(root);
    const previous = running && running !== m.version ? running : (prev && prev.previous) || null;
    writeFileDurably(path.join(root, 'current.json'), JSON.stringify({ version: m.version, previous, installed: new Date().toISOString(), notes: m.notes || '' }, null, 1));
    prune(root, [m.version, previous, running]);
    return m;
  }

  // Go Back: start the previous version next time. Returns that version, or 'built-in' when it's the app's own code.
  function goBack(root, bundleDir) {
    const cur = readCurrent(root);
    if (!cur) return null;
    const prev = cur.previous;
    if (prev && prev !== versionOf(bundleDir) && isCode(path.join(root, prev)) && cmpVer(prev, versionOf(bundleDir) || '0') > 0) {
      writeFileDurably(path.join(root, 'current.json'), JSON.stringify({ version: prev, previous: null, installed: new Date().toISOString(), notes: '' }, null, 1));
      return prev;
    }
    fs.rmSync(path.join(root, 'current.json'), { force: true });
    return 'built-in';
  }

  // Removes version folders nobody needs any more
  function prune(root, keep) {
    for (const f of fs.readdirSync(root)) {
      if (!/^\d+\.\d+\.\d+(\.new)?$/.test(f) || keep.includes(f)) continue;
      fs.rmSync(path.join(root, f), { recursive: true, force: true });
    }
  }

  return { codeRoot, pickCodeDir, installUnpacked, goBack, readCurrent, versionOf, appId, appName };
}

module.exports = { createAppUpdates, versionOf, isCode };
