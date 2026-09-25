// Help › Send Feedback…: a small window that POSTs to the BSI Feedback collector (bsi-shop-systems/feedback).
// The collector URL and this app's key live in feedback.json ({ "url": "…", "key": "…" }), which is gitignored:
// never commit it. Contract: bsi-shop-systems/claude/handoff-2026-09-24-feedback.md.
//
// Shared by every BSI desktop app (PatchMap, StandBy, Loader). Source of truth: bsi-app-updates/kit/feedback.js;
// `node tools/sync-kit.js` copies it out together with feedback-preload.js and feedback.html.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');

let fbWin = null, opts = null, macName = null;

// the Mac account's full name ("Tristan Johnson"), used when the app doesn't know who's using it
function accountName() {
  if (macName === null) { try { macName = require('child_process').execFileSync('/usr/bin/id', ['-F'], { encoding: 'utf8', timeout: 2000 }).trim(); } catch { macName = ''; }
    if (!macName) try { macName = os.userInfo().username; } catch { macName = ''; } }
  return macName;
}

function readConfig() {
  for (const d of opts.configDirs()) {
    try { const c = JSON.parse(fs.readFileSync(path.join(d, 'feedback.json'), 'utf8')); if (c && c.url && c.key) return c; } catch {}
  }
  return null;
}

async function send(message, context) {
  const text = String(message || '').trim();
  if (!text) return { ok: false, error: 'Write the feedback first.' };
  const cfg = readConfig();
  if (!cfg) return { ok: false, error: 'Not sent: feedback isn’t set up in this copy of ' + opts.appName + '. Your text is still here.' };
  try {
    const res = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ key: cfg.key, app: opts.app, message: text, context: String(context || '').slice(0, 300),
        from: String((opts.from && opts.from()) || accountName()).slice(0, 200), version: opts.version(), platform: 'macOS ' + process.getSystemVersion() }) });
    const out = await res.json();                     // not JSON (HTML error page) → throws → not sent
    if (out && typeof out.ok === 'boolean') return out;
    throw new Error('unexpected reply');
  } catch (err) {
    const offline = /fetch failed|ENOTFOUND|ENETUNREACH|EAI_AGAIN|ECONNREFUSED|timeout|aborted/i.test(String((err && (err.cause && err.cause.code)) || '') + ' ' + String(err && err.message));
    return { ok: false, error: (offline ? 'Not sent: no connection.' : 'Not sent: ' + ((err && err.message) || 'something went wrong') + '.') + ' Your text is still here.' };
  }
}

// opts: { app: 'patchmap' | 'standby' | 'loader', appName, version: () => string, configDirs: () => [dir…],
//         parent: () => BrowserWindow | null, context: () => Promise<string> | string, from?: () => string,
//         palette?: optional, older style: { bg, panel, ink, muted, line, accent, accentInk, danger, ok } overrides. The
//         window now takes its look from the BSI design system (bsi-tokens.css + bsi-base.css beside this file) and
//         `app` picks the identity hue, so palettes are no longer needed. }
function setupFeedback(o) {
  opts = o;
  ipcMain.handle('feedback:send', (_e, message, context) => send(message, context));
  ipcMain.on('feedback:close', () => { if (fbWin && !fbWin.isDestroyed()) fbWin.close(); });
}

// One-line helper for apps that only need the window: openFeedback({ app, version, configPath, … }) sets up on first use.
async function openFeedback(o) {
  if (o && !opts) setupFeedback(Object.assign({ configDirs: () => [o.configPath ? path.dirname(o.configPath) : __dirname], version: () => String(o.version), parent: () => null, context: () => '' }, o));
  if (fbWin && !fbWin.isDestroyed()) { fbWin.show(); fbWin.focus(); return; }
  let context = '';
  try { context = String((await opts.context()) || ''); } catch {}
  const parent = opts.parent && opts.parent();
  const palette = JSON.stringify({ light: opts.palette || {}, dark: opts.paletteDark || opts.palette || {} });
  fbWin = new BrowserWindow({
    width: 460, height: 360, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    title: 'Send Feedback', show: false, parent: parent || undefined, modal: false,
    webPreferences: { preload: path.join(__dirname, 'feedback-preload.js'), contextIsolation: true, nodeIntegration: false,
      additionalArguments: ['--fb-context=' + encodeURIComponent(context), '--fb-app=' + encodeURIComponent(opts.appName), '--fb-appid=' + encodeURIComponent(opts.app || ''), '--fb-palette=' + encodeURIComponent(palette)] },
  });
  fbWin.setMenuBarVisibility(false);
  fbWin.webContents.on('will-navigate', e => e.preventDefault());
  fbWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  fbWin.once('ready-to-show', () => fbWin.show());
  fbWin.on('closed', () => { fbWin = null; });
  fbWin.loadFile(path.join(__dirname, 'feedback.html'));
}

module.exports = { setupFeedback, openFeedback };
