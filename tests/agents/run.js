#!/usr/bin/env node
'use strict';
/**
 * `npm run test:agents`: compiles src/main into a temp dir (never touches dist/), then runs the
 * Electron test harness. Headless on Linux (ozone headless); hidden windows on Windows / macOS.
 *   OWL_TEST_ONLY=regex  run a subset, e.g. OWL_TEST_ONLY=errors npm run test:agents
 */
const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const root = path.resolve(__dirname, '..', '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-agents-dist-'));
const tsc = require.resolve('typescript/bin/tsc', { paths: [root] });

console.log('compiling src/main →', out);
const c = spawnSync(process.execPath, [tsc, '-p', path.join(root, 'tsconfig.main.json'), '--outDir', out], { stdio: 'inherit', cwd: root });
if (c.status !== 0) process.exit(c.status || 1);

const electron = require(require.resolve('electron', { paths: [root] })); // path to the binary
const args = [];
if (process.platform === 'linux') args.push('--ozone-platform=headless', '--ozone-override-screen-size=1600,1000', '--disable-gpu', '--no-sandbox');
args.push(path.join(__dirname, 'harness.js'));
const r = spawnSync(electron, args, {
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: root,
  env: { ...process.env, OWL_TEST_DIST: out, ELECTRON_ENABLE_LOGGING: '', ELECTRON_RUN_AS_NODE: '' },
  timeout: 15 * 60 * 1000,
  maxBuffer: 64 * 1024 * 1024,
});
// Chromium prints dbus / GPU noise on headless Linux; keep test output readable
const noise = /:WARNING:|:INFO:|dbus|Fontconfig|gpu_|viz_main|ozone|libva|sandbox_linux|Exiting GPU|ERROR:.*(bus|gl_|egl|vaapi|angle)/i;
process.stdout.write(String(r.stdout || ''));
const errs = String(r.stderr || '').split('\n').filter((l) => l.trim() && !noise.test(l));
if (errs.length) process.stderr.write(errs.join('\n') + '\n');
try { fs.rmSync(out, { recursive: true, force: true }); } catch {}
if (r.error) { console.error(r.error); process.exit(1); }
process.exit(r.status == null ? 1 : r.status);
