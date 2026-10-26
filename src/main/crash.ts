// Crash safety for the main process.
//
// A packaged Electron app has no console, so an exception thrown during startup used to leave
// OWL.exe alive with no window (an invisible zombie that blocks the NSIS installer from replacing
// files). Everything here makes failures visible and makes sure the process actually exits.
import { app, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

let logFile: string | null = null;
let startupDone = false;
let fatalShown = false;

function logPath(): string | null {
  if (logFile) return logFile;
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, 'main.log');
    // keep the log small: rotate once it passes 2 MB
    try { if (fs.statSync(logFile).size > 2_000_000) fs.renameSync(logFile, logFile + '.1'); } catch { /* no log yet */ }
  } catch {
    logFile = null;
  }
  return logFile;
}

function fmt(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}\n${err.stack || ''}`;
  try { return typeof err === 'string' ? err : JSON.stringify(err); } catch { return String(err); }
}

/** Append a line to userData/logs/main.log (and stderr). Never throws. */
export function logLine(level: 'info' | 'warn' | 'error', msg: string, err?: unknown) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}${err !== undefined ? ' ' + fmt(err) : ''}\n`;
  try { process.stderr.write(line); } catch { /* no stderr in GUI builds */ }
  const f = logPath();
  if (f) try { fs.appendFileSync(f, line); } catch { /* disk full / read-only */ }
}

export function crashLogPath() { return logPath(); }

/** Call once startup has produced a visible window. Errors after this are reported but not fatal. */
export function markStartupDone() { startupDone = true; }

/**
 * Show the error and exit. Used when OWL cannot get a window on screen, so the user sees why
 * instead of being left with a background process.
 */
export function fatal(where: string, err: unknown) {
  logLine('error', `FATAL ${where}`, err);
  if (fatalShown) return;
  fatalShown = true;
  try {
    const detail = `${err instanceof Error ? err.message : String(err)}\n\nDetails were written to:\n${logPath() ?? '(log unavailable)'}`;
    dialog.showErrorBox('OWL could not start', detail); // safe before 'ready' too
  } catch { /* headless */ }
  app.exit(1);
}

let installed = false;
/** Install process-wide handlers. Runs on import (main.ts imports this module first). */
export function installCrashHandlers() {
  if (installed) return;
  installed = true;
  process.on('uncaughtException', (err) => {
    if (!startupDone) return fatal('uncaughtException during startup', err);
    logLine('error', 'uncaughtException', err);
    if (fatalShown) return;
    try {
      // non-blocking: the app keeps running, the user is told something went wrong
      void dialog.showMessageBox({ type: 'error', title: 'OWL', message: 'Something went wrong in OWL', detail: `${err?.message || err}\n\nLog: ${logPath() ?? ''}`, buttons: ['OK'] }).catch(() => {});
    } catch { /* ignore */ }
  });
  process.on('unhandledRejection', (reason) => {
    // Most rejections are harmless (network, a closed tab). Log them; startup failures go through fatal() explicitly.
    logLine('warn', 'unhandledRejection', reason);
  });
  app.on('render-process-gone', (_e, wc, details) => {
    if (details.reason !== 'clean-exit') logLine('warn', `render-process-gone ${details.reason} (${details.exitCode}) ${safeUrl(wc)}`);
  });
  app.on('child-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit') logLine('warn', `child-process-gone ${details.type} ${details.reason} (${details.exitCode})`);
  });
}

function safeUrl(wc: Electron.WebContents) { try { return wc.getURL().slice(0, 200); } catch { return ''; } }

installCrashHandlers();
