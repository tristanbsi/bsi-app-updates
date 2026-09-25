// The shared kit: changelog rendering, the app-updates core, and the sync check.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { renderChangelog, parseChangelog, latestNotes, changelogStyles } = require('../kit/changelog-page');
const { createAppUpdates } = require('../kit/app-updates-core');

const scratchRoot = process.env.CLAUDE_JOB_DIR ? path.join(process.env.CLAUDE_JOB_DIR, 'tmp') : os.tmpdir();
const scratch = () => fs.mkdtempSync(path.join(scratchRoot, 'kit-test-'));

const md = `# Loader changelog\n\n## 0.3.1 · 2026-09-24\n- **Suggest load bars** and straps.\n- Smarter Pack the rest: <b>escaped</b>.\n\n## 0.3.0 · 2026-09-24\n- When it comes off.\n`;
const json = [{ version: '1.14.0', date: '2026-09-24', items: ['New: the manual.'] }, { version: '1.13.1', date: '2026-09-24', items: ['Zooming.'] }];

test('parses CHANGELOG.md and changelog.json to the same shape', () => {
  const a = parseChangelog(md), b = parseChangelog(json), c = parseChangelog(JSON.stringify(json));
  assert.equal(a[0].version, '0.3.1'); assert.equal(a[0].date, '2026-09-24'); assert.equal(a[0].items.length, 2); assert.equal(a[1].items[0], 'When it comes off.');
  assert.deepEqual(b, c); assert.equal(b[0].version, '1.14.0');
});

test('renders headings, items, bold, escaping and the this-version pill', () => {
  const html = renderChangelog(md, { current: '0.3.1' });
  assert.match(html, /<h3 id="v0-3-1"><span class="ver">0\.3\.1<\/span> <span class="date">· 2026-09-24<\/span> <span class="pill new">this version<\/span><\/h3>/);
  assert.match(html, /<li><b>Suggest load bars<\/b> and straps\.<\/li>/);
  assert.match(html, /&lt;b&gt;escaped&lt;\/b&gt;/);
  assert.doesNotMatch(html, /v0-3-0"><span class="ver">0\.3\.0<\/span>[^<]*<span class="date">[^<]*<\/span> <span class="pill/);
  assert.equal(renderChangelog('', {}), '<p>No changes listed.</p>');
  assert.equal((renderChangelog(md, { limit: 1 }).match(/<h3/g) || []).length, 1);
});

test('latestNotes gives one plain line from the newest entry', () => {
  assert.equal(latestNotes(md), 'Suggest load bars and straps. Smarter Pack the rest: <b>escaped</b>.');
  assert.equal(latestNotes(json), 'New: the manual.');
  assert.ok(latestNotes(`## 1.0.0\n- ${'word '.repeat(200)}`, 50).length <= 50);
});

test('the changelog page also works as a browser global', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'kit', 'changelog-page.js'), 'utf8');
  const self = {};
  new Function('self', 'module', src)(self, undefined);
  assert.equal(typeof self.renderChangelog, 'function');
  assert.equal(typeof self.changelogStyles, 'function');
});

test('changelogStyles styles the fragment on the design tokens only', () => {
  const css = changelogStyles();
  assert.match(css, /\.bsi-changelog h3 \.pill/); assert.match(css, /var\(--bsi-accent-soft/);
  assert.deepEqual([...css.matchAll(/#[0-9a-f]{3,6}\b/gi)].map(m => m[0]).filter(c => !/^#(eee|666)$/.test(c)), [], 'only fallbacks');
});

function codeDir(dir, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'main.js'), '// app');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }));
  return dir;
}
function unpacked(root, version, appId = 'loader') {
  const u = path.join(root, `u-${version}`);
  codeDir(path.join(u, 'code'), version);
  fs.writeFileSync(path.join(u, 'manifest.json'), JSON.stringify({ app: appId, version, notes: 'n' }));
  return u;
}

test('app-updates core: install, pick, go back, prune, refuse the wrong app', () => {
  const s = scratch();
  const U = createAppUpdates({ appId: 'loader', appName: 'Loader', dataFolder: 'Loader', devEnv: 'LOADER_DEV_CODE_ROOT' });
  const bundle = codeDir(path.join(s, 'bundle'), '0.1.0');
  const root = path.join(s, 'app-code');
  assert.equal(U.pickCodeDir(root, bundle), bundle);                       // nothing installed
  U.installUnpacked(root, unpacked(s, '0.2.0'), { running: '0.1.0' });
  assert.equal(U.pickCodeDir(root, bundle), path.join(root, '0.2.0'));
  U.installUnpacked(root, unpacked(s, '0.3.0'), { running: '0.2.0' });
  assert.equal(U.readCurrent(root).previous, '0.2.0');
  U.installUnpacked(root, unpacked(s, '0.4.0'), { running: '0.3.0' });
  assert.ok(!fs.existsSync(path.join(root, '0.2.0')), 'pruned the one nobody needs');
  assert.equal(U.goBack(root, bundle), '0.3.0');
  assert.equal(U.pickCodeDir(root, bundle), path.join(root, '0.3.0'));
  assert.equal(U.goBack(root, bundle), 'built-in');
  assert.equal(U.pickCodeDir(root, bundle), bundle);
  assert.throws(() => U.installUnpacked(root, unpacked(s, '0.5.0', 'standby'), { running: '0.1.0' }), /isn’t a complete Loader update/);
  const fakeApp = { isPackaged: true, getPath: () => '/tmp/AS' };
  assert.equal(U.codeRoot(fakeApp), path.join('/tmp/AS', 'Loader', 'app-code'));
  assert.equal(U.codeRoot({ isPackaged: false }), null);
  assert.throws(() => createAppUpdates({ appId: 'x' }), /needs appId/);
});

test('sync-kit --check reports drift and exits 1; a synced copy exits 0', () => {
  const s = scratch();
  const pm = path.join(s, 'pm'); fs.mkdirSync(path.join(pm, 'code', 'web'), { recursive: true });
  const sb = path.join(s, 'sb'); fs.mkdirSync(path.join(sb, 'lib'), { recursive: true }); fs.mkdirSync(path.join(sb, 'web'));
  const ld = path.join(s, 'ld'); fs.mkdirSync(path.join(ld, 'lib'), { recursive: true }); fs.mkdirSync(path.join(ld, 'web'));
  const tool = path.join(__dirname, '..', 'tools', 'sync-kit.js');
  const dirs = ['--patchmap-dir', pm, '--standby-dir', sb, '--loader-dir', ld];
  let r = spawnSync(process.execPath, [tool, '--check', ...dirs], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stdout, /is missing/);
  r = spawnSync(process.execPath, [tool, ...dirs], { encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /added code\/updater\.js/);
  r = spawnSync(process.execPath, [tool, '--check', ...dirs], { encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Every app matches/);
  fs.appendFileSync(path.join(ld, 'lib', 'updater.js'), '\n// drift');
  r = spawnSync(process.execPath, [tool, '--check', 'loader', ...dirs], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stdout, /loader: lib\/updater\.js differs/);
});
