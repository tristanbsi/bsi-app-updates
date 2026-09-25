// Checks the release command's steps against a pretend app and a pretend feed, without building or publishing.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const R = require('../tools/release');

const scratchRoot = process.env.CLAUDE_JOB_DIR ? path.join(process.env.CLAUDE_JOB_DIR, 'tmp') : os.tmpdir();
fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = () => fs.mkdtempSync(path.join(scratchRoot, 'release-test-'));
const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }) });

// A pretend Loader-shaped app: package.json version, CHANGELOG.md, web/manual.html, README.md, committed
function fakeApp({ version = '0.4.0', changelog = `# Log\n\n## 0.4.0 · 2026-09-25\n- **New:** a thing.\n- Another thing.\n\n## 0.3.1 · 2026-09-24\n- old\n`, manual = '<html>manual v2</html>', test = 'node -e "process.exit(0)"' } = {}) {
  const dir = scratch();
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fake', version, scripts: test ? { test } : {} }));
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog);
  fs.writeFileSync(path.join(dir, 'web', 'manual.html'), manual);
  fs.writeFileSync(path.join(dir, 'README.md'), '# fake');
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'start');
  return dir;
}
const app = Object.assign({}, R.APPS.loader);

test('git check: clean branch passes, dirty tree and detached HEAD stop', () => {
  const dir = fakeApp();
  assert.equal(R.checkGit(dir).ok, true);
  fs.writeFileSync(path.join(dir, 'README.md'), 'changed');
  assert.equal(R.checkGit(dir).ok, false);
  git(dir, 'checkout', '-q', '.');
  git(dir, 'checkout', '-q', '--detach');
  assert.match(R.checkGit(dir).detail, /no branch/);
});

test('version must be newer than the feed', () => {
  const dir = fakeApp({ version: '0.3.1' });
  const feed = { version: '0.3.1' };
  assert.equal(R.checkVersion(app, dir, feed).ok, false);
  assert.equal(R.checkVersion(app, dir, { version: '0.3.0' }).ok, true);
  assert.equal(R.checkVersion(app, dir, null).ok, true);
  const bad = fakeApp({ version: '0.4' });
  assert.match(R.checkVersion(app, bad, null).detail, /look like/);
});

test('changelog must name the version (markdown and json forms)', () => {
  const dir = fakeApp();
  assert.equal(R.checkChangelog(app, dir, '0.4.0').ok, true);
  assert.equal(R.checkChangelog(app, dir, '0.4.1').ok, false);
  const pm = Object.assign({}, R.APPS.patchmap, { changelog: 'changelog.json' });
  const d2 = scratch();
  fs.writeFileSync(path.join(d2, 'changelog.json'), JSON.stringify([{ version: '1.15.0', items: ['x'] }]));
  assert.equal(R.checkChangelog(pm, d2, '1.15.0').ok, true);
  assert.equal(R.checkChangelog(pm, d2, '1.16.0').ok, false);
});

test('manual must differ from the one in the previous package', () => {
  const dir = fakeApp();
  const feed = { app: 'loader', version: '0.3.1', file: 'Loader-0.3.1.ldupdate' };
  const same = () => Buffer.from('<html>manual v2</html>');
  const older = () => Buffer.from('<html>manual v1</html>');
  // the fake feed package doesn't exist on disk → compare is skipped with a warning
  const r0 = R.checkManual(app, dir, { app: 'loader', version: '0.3.1', file: 'nope.ldupdate' });
  assert.equal(r0.ok, true); assert.equal(r0.warn, true);
  // pretend the package exists by pointing at a real feed file, but stub the unzip
  const real = { app: 'loader', version: '0.3.1', file: 'Loader-0.3.1.ldupdate' };
  assert.equal(R.checkManual(app, dir, real, { unzip: same }).ok, false);
  assert.equal(R.checkManual(app, dir, real, { unzip: older }).ok, true);
  assert.equal(R.checkManual(app, dir, null).ok, true);
});

test('README only warns', () => {
  const dir = fakeApp();
  const r = R.checkReadme(app, dir, { version: '0.3.1', released: '2099-01-01T00:00:00Z' });
  assert.equal(r.ok, true); assert.equal(r.warn, true);
});

test('tests: pass, fail, and missing', () => {
  assert.equal(R.runTests(fakeApp()).ok, true);
  assert.equal(R.runTests(fakeApp({ test: 'node -e "process.exit(1)"' })).ok, false);
  const r = R.runTests(fakeApp({ test: '' }));
  assert.equal(r.ok, true); assert.equal(r.warn, true);
});

test('release notes: flag wins, else the newest changelog entry, plain text', () => {
  const dir = fakeApp();
  assert.equal(R.releaseNotes(app, dir, 'Typed notes'), 'Typed notes');
  assert.equal(R.releaseNotes(app, dir, ''), 'New: a thing. Another thing.');
  const pmDir = scratch(); fs.mkdirSync(path.join(pmDir, 'code'));
  fs.writeFileSync(path.join(pmDir, 'code', 'version.json'), JSON.stringify({ version: '1.15.0', notes: 'From version.json' }));
  assert.equal(R.releaseNotes(R.APPS.patchmap, pmDir, ''), 'From version.json');
});

test('the feed in this repo verifies (signature, size, hash)', () => {
  for (const id of ['patchmap', 'standby', 'loader']) assert.equal(R.verifyLocal(id).ok, true, id);
});

test('verify against GitHub: same → ok, different → not ok, unreachable → not ok', async () => {
  const local = R.verifyLocal('loader').release;
  const fetchSame = async (url, opts) => (opts && opts.method === 'HEAD' ? { ok: true, headers: new Map([['content-length', String(local.size)]]) } : { ok: true, json: async () => JSON.parse(JSON.stringify(local)) });
  assert.equal((await R.verifyRemote('loader', fetchSame)).ok, true);
  const older = Object.assign({}, local, { version: '0.0.1' });
  const fetchOld = async () => ({ ok: true, json: async () => older });
  assert.equal((await R.verifyRemote('loader', fetchOld)).ok, false);   // tampered version fails the signature
  const fetchDown = async () => { throw new Error('offline'); };
  assert.match((await R.verifyRemote('loader', fetchDown)).detail, /Couldn’t reach/);
  const fetch404 = async () => ({ ok: false, status: 404 });
  assert.match((await R.verifyRemote('loader', fetch404)).detail, /404/);
});

test('argument parsing', () => {
  const a = R.parseArgs(['standby', '--dir', '/x', '--dry-run', '--notes', 'hi there', '--push']);
  assert.deepEqual(a._, ['standby']);
  assert.equal(a.flags.dir, '/x'); assert.equal(a.flags['dry-run'], true); assert.equal(a.flags.notes, 'hi there'); assert.equal(a.flags.push, true);
});
