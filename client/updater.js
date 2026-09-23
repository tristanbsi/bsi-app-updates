// BSI app updates: checks the public feed (github.com/tristanbsi/bsi-app-updates) for a newer version of this app's
// code and downloads it. Every release is signed with BSI's key (kept on the release Mac, never in a repo); anything
// unsigned, altered or for another app is refused before it's used.
//
// The same file is copied into each app (PatchMap code/updater.js, StandBy host/lib/updater.js). The source of truth
// is bsi-app-updates/client/updater.js; `node tools/sync-client.js` copies it out.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FEED = 'https://raw.githubusercontent.com/tristanbsi/bsi-app-updates/main';
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAxedJrtHX7PJ2/O5Zh0z2L/EfxUiNWAcPOoaY9feLPKs=
-----END PUBLIC KEY-----
`;

const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

// Exactly what a release's signature covers: everything in latest.json that the app acts on
const signedText = m => JSON.stringify([m.app, m.version, m.file, m.sha256, m.size, m.minShell || '', m.notes || '']);

function verifyRelease(m, appId, publicKey = PUBLIC_KEY) {
  if (!m || m.app !== appId) throw new Error(`The update feed doesn’t have a ${appId} release.`);
  if (!/^\d+\.\d+\.\d+$/.test(m.version || '') || !/^[\w.-]+$/.test(m.file || '') || !/^[0-9a-f]{64}$/.test(m.sha256 || '') || !Number.isInteger(m.size)) {
    throw new Error('The published update is incomplete. It was ignored.');
  }
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(signedText(m)), publicKey, Buffer.from(String(m.sig || ''), 'base64')); } catch { ok = false; }
  if (!ok) throw new Error('The published update isn’t signed by BSI. It was ignored.');
  return m;
}

// appId: 'patchmap' | 'standby'. currentVersion: the code running now. shellVersion: the installed app itself.
// fetch: Electron's net.fetch (follows the Mac's proxy settings). BSI_UPDATE_FEED points a test at a local feed;
// releases there still have to carry a valid signature.
function createUpdater({ appId, currentVersion, shellVersion, fetch, feed = process.env.BSI_UPDATE_FEED || FEED, publicKey = PUBLIC_KEY }) {
  const get = async (url, what) => {
    let res;
    try { res = await fetch(url, { cache: 'no-store' }); } catch { throw new Error('Couldn’t reach the update server. Check this Mac’s internet connection.'); }
    if (!res.ok) throw new Error(`The update server couldn’t send the ${what} (${res.status}).`);
    return res;
  };
  return {
    // { newer, needsFullApp, release }. needsFullApp: the release needs a newer copy of the app itself
    async check() {
      const res = await get(`${feed}/${appId}/latest.json?t=${Date.now()}`, 'release list');
      let m; try { m = await res.json(); } catch { throw new Error('The update feed couldn’t be read.'); }
      verifyRelease(m, appId, publicKey);
      return { newer: cmpVer(m.version, currentVersion) > 0, needsFullApp: !!m.minShell && cmpVer(shellVersion, m.minShell) < 0, release: m };
    },
    // Downloads a checked release into dir and returns the file. Its size and hash must match the signed release.
    async download(m, dir) {
      verifyRelease(m, appId, publicKey);
      const buf = Buffer.from(await (await get(`${feed}/${appId}/${encodeURIComponent(m.file)}`, 'update')).arrayBuffer());
      if (buf.length !== m.size || sha256(buf) !== m.sha256) throw new Error('The download didn’t match the published update, so nothing was changed. Try again.');
      const file = path.join(dir, m.file);
      fs.writeFileSync(file, buf);
      return file;
    },
  };
}

module.exports = { createUpdater, verifyRelease, signedText, cmpVer, sha256, FEED, PUBLIC_KEY };
