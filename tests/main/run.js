#!/usr/bin/env node
'use strict';
/**
 * `npm run test:main`: compiles src/main + preload into a temp dir (never touches dist/), links the
 * built UI (dist/renderer, from `npm run build:renderer`) next to it, then boots the REAL main process
 * (dist/main/main.js) inside tests/main/harness.js and drives it through window.owl in the UI.
 * Headless on Linux (ozone headless); hidden-ish windows on Windows / macOS.
 *   OWL_TEST_ONLY=regex  run a subset, e.g. OWL_TEST_ONLY=download npm run test:main
 */
const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const root = path.resolve(__dirname, '..', '..');
const renderer = path.join(root, 'dist', 'renderer');
if (!fs.existsSync(path.join(renderer, 'index.html'))) { console.error('dist/renderer missing: run `npm run build:renderer` first'); process.exit(2); }
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-main-dist-'));
const tsc = require.resolve('typescript/bin/tsc', { paths: [root] });

console.log('compiling src/main →', out);
const c = spawnSync(process.execPath, [tsc, '-p', path.join(root, 'tsconfig.main.json'), '--outDir', out], { stdio: 'inherit', cwd: root });
if (c.status !== 0) process.exit(c.status || 1);
try { fs.symlinkSync(renderer, path.join(out, 'renderer'), process.platform === 'win32' ? 'junction' : 'dir'); }
catch { fs.cpSync(renderer, path.join(out, 'renderer'), { recursive: true }); }
// the compiled main requires runtime deps (adblocker, sql.js) by package name
fs.symlinkSync(path.join(root, 'node_modules'), path.join(out, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');

const electron = require(require.resolve('electron', { paths: [root] }));
const args = [];
if (process.platform === 'linux') args.push('--ozone-platform=headless', '--ozone-override-screen-size=1600,1000', '--disable-gpu', '--no-sandbox', '--no-zygote', '--in-process-gpu');
args.push(path.join(__dirname, 'harness.js'));
const r = spawnSync(electron, args, {
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: root,
  env: { ...process.env, OWL_TEST_DIST: out, ELECTRON_ENABLE_LOGGING: '', ELECTRON_RUN_AS_NODE: '' },
  timeout: Number(process.env.OWL_TEST_TIMEOUT_MS) || 10 * 60 * 1000,
  maxBuffer: 64 * 1024 * 1024,
});
const noise = /:WARNING:|:INFO:|dbus|Fontconfig|gpu_|viz_main|ozone|libva|sandbox_linux|Exiting GPU|ERROR:.*(bus|gl_|egl|vaapi|angle)/i;
process.stdout.write(String(r.stdout || ''));
const errs = String(r.stderr || '').split('\n').filter((l) => l.trim() && !noise.test(l));
if (errs.length) process.stderr.write(errs.join('\n') + '\n');
try { fs.rmSync(out, { recursive: true, force: true }); } catch {}
if (r.error) { console.error(r.error); process.exit(1); }
process.exit(r.status == null ? 1 : r.status);
