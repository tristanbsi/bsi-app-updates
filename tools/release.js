#!/usr/bin/env node
// One release command for every BSI desktop app.
//
//   node tools/release.js <patchmap|standby|loader> [--dir <app folder>] [--dry-run] [--no-publish]
//                         [--notes "…"] [--min-shell X.Y.Z] [--notarize] [--zip <out folder>] [--push]
//   node tools/release.js status                 each app's version here vs the feed
//   node tools/release.js verify <app>           the feed on GitHub matches this Mac and is properly signed
//   node tools/release.js verify-local           every latest.json in this repo is signed and its file matches
//
// A release walks these steps and stops at the first red one:
//   1. the app folder is on a branch with nothing uncommitted
//   2. the version is newer than the one on the feed
//   3. the changelog names the new version, and the manual changed since the last release (Tristan's rule:
//      every release updates the changelog, the manual and the README; the README only warns)
//   4. the app's tests pass
//   5. the update package is built with the app's own script
//   6. it is signed and added to the feed (tools/publish.js), and the feed is re-checked
//   7. the push commands are printed. Nothing reaches anyone until `git push` runs; --push runs it.
//
// --dry-run stops after step 4 and says what would happen. --no-publish stops after step 5.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { verifyRelease, cmpVer, sha256, FEED } = require('../kit/updater');
const { latestNotes } = require('../kit/changelog-page');

const home = os.homedir();
const repo = path.join(__dirname, '..');

// How each app is laid out. Paths are relative to the app folder (--dir).
const APPS = {
  patchmap: {
    name: 'PatchMap', ext: '.pmupdate', dir: path.join(home, 'patchmap'),
    versionFile: 'code/version.json', changelog: 'code/web/changelog.json', manual: 'code/web/manual.html', readme: 'README.md',
    manualInPackage: 'code/web/manual.html',
    build: [{ cmd: 'tools/build-pmupdate.sh', args: [] }],
    packageFile: v => `dist/PatchMap-${v}.pmupdate`,
    // notes come from code/version.json
    notesFrom: dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'code/version.json'), 'utf8')).notes || ''; } catch { return ''; } },
    app: () => '/Applications/PatchMap.app',   // the shell; the zip bakes the code in (make-drive-zip.sh)
  },
  standby: {
    name: 'StandBy', ext: '.sbupdate', dir: path.join(home, 'bsi-showcall-app', 'host'),
    versionFile: 'package.json', changelog: 'CHANGELOG.md', manual: 'web/manual.html', readme: '../README.md',
    manualInPackage: 'code/web/manual.html',
    outEnv: 'STANDBY_OUT', outDir: 'dist-release',
    build: [{ cmd: 'npm', args: ['run', 'package'] }, { cmd: 'npm', args: ['run', 'update-package', '--'], notes: true }],
    packageFile: v => `dist-updates/StandBy-${v}.sbupdate`,
    app: dir => path.join(dir, 'dist-release', 'StandBy-darwin-arm64', 'StandBy.app'),
  },
  loader: {
    name: 'Loader', ext: '.ldupdate', dir: path.join(home, 'loader'),
    versionFile: 'package.json', changelog: 'CHANGELOG.md', manual: 'web/manual.html', readme: 'README.md',
    manualInPackage: 'code/web/manual.html',
    outEnv: 'LOADER_OUT', outDir: 'dist-release',
    build: [{ cmd: 'npm', args: ['run', 'package'] }, { cmd: 'npm', args: ['run', 'update-package', '--'], notes: true }],
    packageFile: v => `dist-updates/Loader-${v}.ldupdate`,
    app: dir => path.join(dir, 'dist-release', 'Loader-darwin-arm64', 'Loader.app'),
  },
};

// Loader: ~/loader, unless it holds no app code and the 0.1 worktree does
function defaultDir(id) {
  if (id !== 'loader') return APPS[id].dir;
  const env = process.env.BSI_LOADER_DIR && path.resolve(process.env.BSI_LOADER_DIR);
  const main = APPS.loader.dir, wt = path.join(main, '.claude', 'worktrees', 'loader-0.1');
  if (env) return env;
  if (fs.existsSync(path.join(main, 'lib'))) return main;
  return fs.existsSync(path.join(wt, 'lib')) ? wt : main;
}

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', RESET = '\x1b[0m';
const tty = process.stdout.isTTY;
const paint = (c, s) => (tty ? c + s + RESET : s);
const say = {
  ok: (what, detail) => console.log(`${paint(GREEN, '✓')} ${what}${detail ? paint(DIM, '  ' + detail) : ''}`),
  warn: (what, detail) => console.log(`${paint(YELLOW, '!')} ${what}${detail ? paint(DIM, '  ' + detail) : ''}`),
  bad: (what, detail) => console.log(`${paint(RED, '✗')} ${what}${detail ? '\n  ' + detail : ''}`),
  step: title => console.log(`\n${paint(DIM, '—')} ${title}`),
};
class Stop extends Error {}

const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const feedFile = id => path.join(repo, id, 'latest.json');
const feedRelease = id => (fs.existsSync(feedFile(id)) ? readJson(feedFile(id)) : null);

// ----------------------------------------------------------------------------------------------- checks
// Each check returns { ok, warn?, detail } and never throws for an ordinary "no"; the caller turns ok:false into a stop.

function localVersion(app, dir) {
  const f = path.join(dir, app.versionFile);
  if (!fs.existsSync(f)) return null;
  return readJson(f).version || null;
}

function checkGit(dir) {
  let branch, status;
  try { branch = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'); status = git(dir, 'status', '--porcelain', '--untracked-files=no'); }
  catch (e) { return { ok: false, detail: `${dir} isn’t a git checkout.` }; }
  if (branch === 'HEAD') return { ok: false, detail: 'The app folder is on no branch (detached HEAD). Check out a branch first.' };
  if (status) return { ok: false, detail: `Uncommitted changes in the app folder. Commit them first:\n${status.split('\n').map(l => '    ' + l).join('\n')}` };
  return { ok: true, detail: `branch ${branch}` };
}

function checkVersion(app, dir, feed) {
  const v = localVersion(app, dir);
  if (!v) return { ok: false, detail: `No version in ${app.versionFile}.` };
  if (!/^\d+\.\d+\.\d+$/.test(v)) return { ok: false, detail: `The version ${v} should look like 1.2.3.` };
  if (feed && cmpVer(v, feed.version) <= 0) return { ok: false, detail: `${app.name} is ${v} here but the feed already has ${feed.version}. Bump the version in ${app.versionFile}.` };
  return { ok: true, detail: feed ? `${v} (feed has ${feed.version})` : `${v} (first release on the feed)`, version: v };
}

function checkChangelog(app, dir, version) {
  const f = path.join(dir, app.changelog);
  if (!fs.existsSync(f)) return { ok: false, detail: `No changelog at ${app.changelog}.` };
  const text = fs.readFileSync(f, 'utf8');
  let has;
  if (f.endsWith('.json')) { try { has = readJson(f).some(r => String(r.version) === version); } catch { return { ok: false, detail: `${app.changelog} isn’t valid JSON.` }; } }
  else has = new RegExp(`^##\\s+${version.replace(/\./g, '\\.')}(\\s|$)`, 'm').test(text);
  if (!has) return { ok: false, detail: `${app.changelog} has no entry for ${version}. Add what changed (newest first).` };
  return { ok: true, detail: `${app.changelog} has ${version}` };
}

// The manual must differ from the one inside the previous published package (the feed keeps every package).
function checkManual(app, dir, feed, { unzip = defaultUnzip } = {}) {
  const f = path.join(dir, app.manual);
  if (!fs.existsSync(f)) return { ok: false, detail: `No manual at ${app.manual}.` };
  if (!feed) return { ok: true, detail: 'first release, nothing to compare with' };
  const prevPkg = path.join(repo, feed.app, feed.file);
  if (!fs.existsSync(prevPkg)) return { ok: true, warn: true, detail: `couldn’t compare: the previous package ${feed.file} isn’t in this repo` };
  let prev;
  try { prev = unzip(prevPkg, app.manualInPackage); } catch { return { ok: true, warn: true, detail: `the previous package has no ${app.manualInPackage} to compare with` }; }
  if (prev.equals(fs.readFileSync(f))) return { ok: false, detail: `${app.manual} is the same as in ${feed.version}. Every release updates the manual (at least the What’s new list). Pass --allow-same-manual if this release truly changes nothing a user sees.` };
  return { ok: true, detail: `${app.manual} changed since ${feed.version}` };
}

function checkReadme(app, dir, feed) {
  const f = path.resolve(dir, app.readme);
  if (!fs.existsSync(f)) return { ok: true, warn: true, detail: `no README at ${app.readme}` };
  if (!feed || !feed.released) return { ok: true, detail: 'first release' };
  let log = '';
  try { log = git(path.dirname(f), 'log', '-1', '--format=%h', `--since=${feed.released}`, '--', path.basename(f)); } catch {}
  if (!log) return { ok: true, warn: true, detail: `${path.basename(f)} hasn’t changed since ${feed.version} was released. Tristan’s rule: update the README each release (skip if nothing there needs it).` };
  return { ok: true, detail: `${path.basename(f)} changed since ${feed.version}` };
}

function runTests(dir) {
  const pkg = path.join(dir, 'package.json');
  const hasTest = fs.existsSync(pkg) && !!(readJson(pkg).scripts || {}).test;
  if (!hasTest) return { ok: true, warn: true, detail: 'this app has no test script yet, so nothing was run' };
  const r = spawnSync('npm', ['test'], { cwd: dir, stdio: 'inherit' });
  return r.status === 0 ? { ok: true, detail: 'npm test passed' } : { ok: false, detail: 'npm test failed. Fix the tests before releasing.' };
}

function defaultUnzip(zip, entry) {
  return execFileSync('/usr/bin/unzip', ['-p', zip, entry], { maxBuffer: 64 * 1024 * 1024 });
}

function packageManifest(pkgFile) {
  return JSON.parse(defaultUnzip(pkgFile, 'manifest.json').toString('utf8'));
}

function releaseNotes(app, dir, notesFlag) {
  if (notesFlag) return notesFlag;
  if (app.notesFrom) return app.notesFrom(dir);
  return latestNotes(fs.readFileSync(path.join(dir, app.changelog), 'utf8'));
}

// ----------------------------------------------------------------------------------------------- steps that do things

function build(app, dir, notes) {
  const env = Object.assign({}, process.env);
  if (app.outEnv) env[app.outEnv] = app.outDir;
  for (const step of app.build) {
    const args = step.notes ? [...step.args, notes] : step.args;
    const cmd = step.cmd.startsWith('tools/') ? path.join(dir, step.cmd) : step.cmd;
    console.log(paint(DIM, `  $ ${step.cmd} ${args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`));
    const r = spawnSync(cmd, args, { cwd: dir, env, stdio: 'inherit' });
    if (r.status !== 0) throw new Stop(`${step.cmd} failed (exit ${r.status}).`);
  }
}

function publish(id, pkgFile, minShell) {
  const args = [path.join(__dirname, 'publish.js'), id, pkgFile];
  if (minShell) args.push('--min-shell', minShell);
  const r = spawnSync(process.execPath, args, { cwd: repo, stdio: 'inherit' });
  if (r.status !== 0) throw new Stop('publish.js refused the package (see above).');
}

// The feed entry is signed, the file is there, and its hash and size match
function verifyLocal(id) {
  const m = feedRelease(id);
  if (!m) return { ok: false, detail: `no ${id}/latest.json` };
  try { verifyRelease(m, id); } catch (e) { return { ok: false, detail: e.message }; }
  const file = path.join(repo, id, m.file);
  if (!fs.existsSync(file)) return { ok: false, detail: `${m.file} is missing from ${id}/` };
  const buf = fs.readFileSync(file);
  if (buf.length !== m.size || sha256(buf) !== m.sha256) return { ok: false, detail: `${m.file} doesn’t match its published size or hash` };
  return { ok: true, detail: `${m.version}, ${m.file}, signed`, release: m };
}

async function verifyRemote(id, fetchFn = globalThis.fetch) {
  const local = verifyLocal(id);
  if (!local.ok) return local;
  let remote;
  try {
    const res = await fetchFn(`${FEED}/${id}/latest.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return { ok: false, detail: `GitHub answered ${res.status} for ${id}/latest.json. Has the feed been pushed?` };
    remote = await res.json();
  } catch (e) { return { ok: false, detail: `Couldn’t reach GitHub: ${e.message}` }; }
  try { verifyRelease(remote, id); } catch (e) { return { ok: false, detail: `The published feed isn’t properly signed: ${e.message}` }; }
  const same = JSON.stringify(remote) === JSON.stringify(local.release);
  if (!same) return { ok: false, detail: `GitHub has ${remote.version} (${remote.file}); this Mac has ${local.release.version}. Push the feed (or pull it) so they match.` };
  let head = null;
  try { head = await fetchFn(`${FEED}/${id}/${encodeURIComponent(remote.file)}`, { method: 'HEAD', cache: 'no-store' }); } catch {}
  if (head && head.ok) {
    const len = Number(head.headers.get('content-length') || 0);
    if (len && len !== remote.size) return { ok: false, detail: `${remote.file} on GitHub is ${len} bytes, not the published ${remote.size}.` };
  }
  return { ok: true, detail: `GitHub has ${remote.version}, signed, same as this Mac`, release: remote };
}

// ----------------------------------------------------------------------------------------------- commands

function parseArgs(argv) {
  const o = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    if (['dir', 'notes', 'min-shell', 'zip'].includes(k)) { o.flags[k] = argv[++i]; if (o.flags[k] == null) throw new Stop(`--${k} needs a value`); }
    else o.flags[k] = true;
  }
  return o;
}

async function release(id, flags) {
  const app = APPS[id];
  const dir = flags.dir ? path.resolve(flags.dir) : defaultDir(id);
  const feed = feedRelease(id);
  console.log(`Releasing ${app.name} from ${dir}`);
  const need = (r, what) => { if (!r.ok) { say.bad(what, r.detail); throw new Stop(); } (r.warn ? say.warn : say.ok)(what, r.detail); return r; };

  say.step('1 · the app folder is committed and on a branch');
  need(checkGit(dir), 'Nothing uncommitted');

  say.step('2 · the version is new');
  const { version } = need(checkVersion(app, dir, feed), 'Version bumped');

  say.step('3 · changelog, manual and README');
  need(checkChangelog(app, dir, version), 'Changelog names this version');
  const manual = checkManual(app, dir, feed);
  if (!manual.ok && flags['allow-same-manual']) { say.warn('Manual unchanged (allowed by --allow-same-manual)'); }
  else need(manual, 'Manual updated');
  need(checkReadme(app, dir, feed), 'README');
  const notes = releaseNotes(app, dir, flags.notes);
  if (!notes) { say.bad('Release notes', 'No notes: pass --notes "…" or put them in the changelog.'); throw new Stop(); }
  say.ok('Release notes', notes.length > 90 ? notes.slice(0, 90) + '…' : notes);

  say.step('4 · tests');
  need(runTests(dir), 'Tests');

  if (flags['dry-run']) { console.log(`\nDry run: ${app.name} ${version} would be built, signed and added to the feed. Nothing was changed.`); return; }

  say.step('5 · build the update package');
  build(app, dir, notes);
  const pkgFile = path.join(dir, app.packageFile(version));
  if (!fs.existsSync(pkgFile)) { say.bad('Package', `Expected ${pkgFile} but the build didn’t make it.`); throw new Stop(); }
  const man = packageManifest(pkgFile);
  if (man.app !== id || man.version !== version) { say.bad('Package', `${path.basename(pkgFile)} says ${man.app} ${man.version}, expected ${id} ${version}.`); throw new Stop(); }
  say.ok('Package built', `${path.relative(dir, pkgFile)} (${Math.round(fs.statSync(pkgFile).size / 1024)} KB)`);

  if (flags.notarize || flags.zip) {
    say.step('5b · the app itself (Developer ID and first-install zip)');
    const appPath = app.app(dir);
    if (!fs.existsSync(appPath)) { say.bad('App', `No app at ${appPath}.`); throw new Stop(); }
    if (flags.notarize) {
      const r = spawnSync(path.join(__dirname, 'notarize.sh'), [appPath], { stdio: 'inherit' });
      if (r.status !== 0) throw new Stop('notarize.sh failed (see above).');
      say.ok('Notarized', appPath);
    }
    if (flags.zip) {
      const r = spawnSync(path.join(__dirname, 'make-drive-zip.sh'), [id, appPath, flags.zip], { stdio: 'inherit', env: Object.assign({ BSI_APP_DIR: dir }, process.env) });
      if (r.status !== 0) throw new Stop('make-drive-zip.sh failed (see above).');
      say.ok('First-install zip', `in ${flags.zip}`);
    }
  }

  if (flags['no-publish']) { console.log(`\nBuilt but not published: ${pkgFile}. Run without --no-publish to sign and add it to the feed.`); return; }

  say.step('6 · sign and add to the feed');
  publish(id, pkgFile, flags['min-shell']);
  need(verifyLocal(id), 'Feed entry checked');

  say.step('7 · release it');
  const appRepo = git(dir, 'rev-parse', '--show-toplevel');
  const cmds = [`git -C ${JSON.stringify(repo)} push`, `git -C ${JSON.stringify(appRepo)} push`];
  if (flags.push) {
    execFileSync('git', ['push'], { cwd: repo, stdio: 'inherit' });
    say.ok('Feed pushed', `${app.name} ${version} is live for everyone who checks for updates`);
    console.log(`Also push the app’s own repo when you’re ready:\n  ${cmds[1]}`);
    console.log(`Then check it from any Mac:  node tools/release.js verify ${id}`);
  } else {
    console.log(`${app.name} ${version} is signed and committed to the feed but NOT pushed. Nobody sees it until:\n  ${cmds[0]}\nThen push the app’s repo too:\n  ${cmds[1]}\nAnd check it landed:  node tools/release.js verify ${id}`);
  }
}

function status(flags) {
  const rows = [];
  for (const id of Object.keys(APPS)) {
    const app = APPS[id], dir = flags.dir ? path.resolve(flags.dir) : defaultDir(id);
    const local = fs.existsSync(dir) ? localVersion(app, dir) : null;
    const feed = feedRelease(id);
    let note = '';
    if (!local) note = `no app at ${dir}`;
    else if (!feed) note = 'not on the feed yet';
    else if (cmpVer(local, feed.version) > 0) note = 'newer here: ready to release';
    else if (cmpVer(local, feed.version) < 0) note = 'this Mac is behind the feed';
    else note = 'same as the feed';
    rows.push([app.name, local || '—', feed ? feed.version : '—', feed && feed.released ? feed.released.slice(0, 10) : '', note]);
  }
  const w = [0, 0, 0, 0].map((_, i) => Math.max(...rows.map(r => String(r[i]).length), ['App', 'Here', 'Feed', 'Released'][i].length));
  const line = r => r.map((c, i) => (i < 4 ? String(c).padEnd(w[i]) : c)).join('  ');
  console.log(line(['App', 'Here', 'Feed', 'Released', '']));
  for (const r of rows) console.log(line(r));
}

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const [cmd, arg] = _;
  if (cmd === 'status') return status(flags);
  if (cmd === 'verify-local') {
    let bad = 0;
    for (const id of Object.keys(APPS)) { const r = verifyLocal(id); (r.ok ? say.ok : say.bad)(`${APPS[id].name}`, r.detail); if (!r.ok) bad++; }
    if (bad) throw new Stop();
    return;
  }
  if (cmd === 'verify') {
    if (!APPS[arg]) throw new Stop('usage: node tools/release.js verify <patchmap|standby|loader>');
    const r = await verifyRemote(arg);
    (r.ok ? say.ok : say.bad)(`${APPS[arg].name} on GitHub`, r.detail);
    if (!r.ok) throw new Stop();
    return;
  }
  if (APPS[cmd]) return release(cmd, flags);
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith('//')).slice(0, 19).map(l => l.slice(3)).join('\n'));
  process.exit(cmd ? 1 : 0);
}

module.exports = { APPS, checkGit, checkVersion, checkChangelog, checkManual, checkReadme, runTests, releaseNotes, verifyLocal, verifyRemote, parseArgs, defaultDir, localVersion, feedRelease };

if (require.main === module) {
  main().catch(e => { if (e instanceof Stop) { if (e.message) console.error(paint(RED, e.message)); console.error('\nStopped. Nothing was released.'); process.exit(1); } console.error(e); process.exit(1); });
}
