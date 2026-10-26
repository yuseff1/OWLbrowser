/**
 * OWL "computer use": lets AI agents see and drive the Windows desktop.
 *
 * - Screenshots come from Electron's desktopCapturer (no native modules).
 * - Input goes through ONE long-lived hidden PowerShell process that compiles a tiny
 *   C# helper (user32 SendInput / SetCursorPos / EnumWindows ...) via Add-Type.
 *
 * Security model:
 * - No user/model-supplied text is ever interpolated into PowerShell source. Strings are
 *   base64-encoded and decoded inside PowerShell; numbers are validated + rounded integers.
 * - Every command script is itself base64-wrapped so it travels as one safe stdin line.
 * - runApp() is disabled unless the host explicitly allows it (setPolicy / opts).
 */
import { desktopCapturer, screen } from 'electron';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

// ───────────────────────────── types ─────────────────────────────

export type MouseButton = 'left' | 'right' | 'middle';

export interface ScreenshotResult {
  /** data:image/jpeg;base64,... */
  dataUrl: string;
  /** screenshot size in px */
  width: number;
  height: number;
  /** multiply screenshot px by this to get real (physical) screen px */
  scale: number;
}

export interface WindowInfo {
  handle: number;
  pid: number;
  processName: string;
  title: string;
}

export interface ComputerPolicy {
  /** allow computer_open_app / runApp (Start-Process). Default false. */
  allowRunApp: boolean;
}

export interface ComputerToolResult {
  text: string;
  /** data URL of a fresh screenshot, when the action changed the screen */
  image?: string;
}

// ───────────────────────────── constants ─────────────────────────────

const NOT_WINDOWS = 'Computer use is only available on Windows';
const MAX_SHOT_WIDTH = 1280;
const JPEG_QUALITY = 70;
const SETTLE_MS = 400;
const TYPE_CHUNK = 200; // UTF-16 code units per SendInput batch
const MAX_TYPE_LEN = 20000;
const CMD_TIMEOUT_MS = 20000;
const INIT_TIMEOUT_MS = 90000; // Add-Type compiles C# on first use
const SENTINEL = '__OWL_RESULT__';

const policy: ComputerPolicy = { allowRunApp: false };

// ───────────────────────────── C# helper ─────────────────────────────

const CSHARP = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class OwlWin {
  public long Handle; public int Pid; public string Title;
}

public static class OwlInput {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);

  const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
  const uint MOVE = 0x0001, LDOWN = 0x0002, LUP = 0x0004, RDOWN = 0x0008, RUP = 0x0010, MDOWN = 0x0020, MUP = 0x0040, WHEEL = 0x0800;
  const uint KEYUP = 0x0002, UNICODE = 0x0004, EXTENDED = 0x0001;

  public static void InitDpi() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch {}
    try { SetProcessDPIAware(); } catch {}
  }

  static INPUT Mouse(uint flags, uint data) {
    INPUT i = new INPUT(); i.type = INPUT_MOUSE; i.u.mi.dwFlags = flags; i.u.mi.mouseData = data; return i;
  }
  static INPUT Key(ushort vk, ushort scan, uint flags) {
    INPUT i = new INPUT(); i.type = INPUT_KEYBOARD; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i;
  }
  static void Send(params INPUT[] inputs) { SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))); }

  public static void Move(int x, int y) { SetCursorPos(x, y); }
  public static POINT Pos() { POINT p; GetCursorPos(out p); return p; }

  static void Flags(string button, out uint down, out uint up) {
    if (button == "right") { down = RDOWN; up = RUP; }
    else if (button == "middle") { down = MDOWN; up = MUP; }
    else { down = LDOWN; up = LUP; }
  }

  public static void Click(int x, int y, string button, int count) {
    uint d, u; Flags(button, out d, out u);
    SetCursorPos(x, y); Thread.Sleep(30);
    for (int k = 0; k < count; k++) { Send(Mouse(d, 0)); Thread.Sleep(15); Send(Mouse(u, 0)); if (k + 1 < count) Thread.Sleep(70); }
  }

  public static void Drag(int x1, int y1, int x2, int y2) {
    SetCursorPos(x1, y1); Thread.Sleep(40);
    Send(Mouse(LDOWN, 0)); Thread.Sleep(60);
    int steps = 20;
    for (int s = 1; s <= steps; s++) {
      SetCursorPos(x1 + (x2 - x1) * s / steps, y1 + (y2 - y1) * s / steps);
      Send(Mouse(MOVE, 0)); Thread.Sleep(12);
    }
    Thread.Sleep(60); Send(Mouse(LUP, 0));
  }

  public static void Scroll(int x, int y, int notches) {
    SetCursorPos(x, y); Thread.Sleep(30);
    int dir = notches > 0 ? -1 : 1; int n = Math.Abs(notches);
    for (int k = 0; k < n; k++) { Send(Mouse(WHEEL, unchecked((uint)(dir * 120)))); Thread.Sleep(20); }
  }

  public static void TypeUnicode(string text) {
    foreach (char c in text) {
      if (c == '\r') continue;
      if (c == '\n') { Send(Key(0x0D, 0, 0), Key(0x0D, 0, KEYUP)); }
      else if (c == '\t') { Send(Key(0x09, 0, 0), Key(0x09, 0, KEYUP)); }
      else { Send(Key(0, c, UNICODE), Key(0, c, UNICODE | KEYUP)); }
      Thread.Sleep(2);
    }
  }

  static bool IsExtended(ushort vk) {
    return (vk >= 0x21 && vk <= 0x28) || vk == 0x2C || vk == 0x2D || vk == 0x2E || vk == 0x5B || vk == 0x5C || vk == 0x5D || vk == 0x6F || vk == 0x90 || vk == 0xA3 || vk == 0xA5;
  }

  public static void Combo(int[] vks) {
    for (int k = 0; k < vks.Length; k++) { ushort v = (ushort)vks[k]; Send(Key(v, 0, IsExtended(v) ? EXTENDED : 0)); Thread.Sleep(15); }
    for (int k = vks.Length - 1; k >= 0; k--) { ushort v = (ushort)vks[k]; Send(Key(v, 0, (IsExtended(v) ? EXTENDED : 0) | KEYUP)); Thread.Sleep(15); }
  }

  public static List<OwlWin> Windows() {
    List<OwlWin> list = new List<OwlWin>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      int len = GetWindowTextLength(h); if (len <= 0) return true;
      StringBuilder sb = new StringBuilder(len + 1); GetWindowText(h, sb, sb.Capacity);
      uint pid; GetWindowThreadProcessId(h, out pid);
      OwlWin w = new OwlWin(); w.Handle = h.ToInt64(); w.Pid = (int)pid; w.Title = sb.ToString();
      list.Add(w); return true;
    }, IntPtr.Zero);
    return list;
  }

  public static string Focus(string needle) {
    string n = needle.ToLowerInvariant();
    foreach (OwlWin w in Windows()) {
      if (w.Title.ToLowerInvariant().Contains(n)) {
        IntPtr h = new IntPtr(w.Handle);
        if (IsIconic(h)) ShowWindow(h, 9);
        keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); // ALT tap unlocks SetForegroundWindow
        BringWindowToTop(h);
        SetForegroundWindow(h);
        return w.Title;
      }
    }
    return null;
  }
}
`;

// ───────────────────────────── PowerShell host ─────────────────────────────

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

/** base64 of a UTF-8 string (safe inside single-quoted PowerShell literals: [A-Za-z0-9+/=]) */
const b64 = (s: string) => Buffer.from(String(s), 'utf8').toString('base64');
/** PowerShell expression that yields the decoded string, never interpolating raw text */
const psStr = (s: string) => `([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(s)}')))`;

/** Validate + round a coordinate / count. Throws on NaN/Infinity/absurd values. */
function int(v: any, name: string, min = -100000, max = 100000): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}: ${v}`);
  if (n < min || n > max) throw new Error(`${name} out of range: ${n}`);
  return n;
}

class PsHost {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  private pending = new Map<number, Pending>();
  private seq = 0;
  private ready: Promise<void> | null = null;
  private stderrTail = '';

  private spawnProc() {
    const p = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = p;
    this.buf = '';
    p.stdout.setEncoding('utf8');
    p.stderr.setEncoding('utf8');
    p.stdout.on('data', (d: string) => this.onData(d));
    p.stderr.on('data', (d: string) => { this.stderrTail = (this.stderrTail + d).slice(-2000); });
    const dead = (why: string) => {
      if (this.proc !== p) return;
      this.proc = null;
      this.ready = null;
      const err = new Error(`Computer input host exited (${why})${this.stderrTail ? ': ' + this.stderrTail.trim().slice(-300) : ''}`);
      for (const [, q] of this.pending) { clearTimeout(q.timer); q.reject(err); }
      this.pending.clear();
    };
    p.on('exit', (code) => dead('code ' + code));
    p.on('error', (e) => dead(e.message));
    p.stdin.on('error', () => { /* handled by exit */ });
  }

  private onData(d: string) {
    this.buf += d;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      if (!line.startsWith(SENTINEL)) continue; // ignore stray output
      // format: __OWL_RESULT__<id>|<ok 1/0>|<base64 utf8 payload>
      const [idS, okS, payload = ''] = line.slice(SENTINEL.length).split('|');
      const q = this.pending.get(Number(idS));
      if (!q) continue;
      this.pending.delete(Number(idS));
      clearTimeout(q.timer);
      const text = Buffer.from(payload, 'base64').toString('utf8');
      if (okS === '1') {
        let v: any = text;
        try { v = text ? JSON.parse(text) : null; } catch { /* plain text */ }
        q.resolve(v);
      } else q.reject(new Error(text || 'PowerShell command failed'));
    }
    if (this.buf.length > 5_000_000) this.buf = ''; // runaway output guard
  }

  /** Send one script. The script's pipeline output is JSON-serialised and returned. */
  private raw(script: string, timeoutMs: number): Promise<any> {
    if (!this.proc) this.spawnProc();
    const id = ++this.seq;
    // The script is base64 → decoded → run via a ScriptBlock. Result → JSON → base64 → sentinel line.
    const line =
      `try { $__r = & ([ScriptBlock]::Create(${psStr(script)})); ` +
      `$__j = if ($null -eq $__r) { 'null' } else { ConvertTo-Json -InputObject $__r -Depth 6 -Compress }; ` +
      `[Console]::Out.WriteLine('${SENTINEL}${id}|1|' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$__j))) } ` +
      `catch { [Console]::Out.WriteLine('${SENTINEL}${id}|0|' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$_.Exception.Message))) }; ` +
      `[Console]::Out.Flush()\n`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Computer input command timed out'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.proc!.stdin.write(line, 'utf8'); }
      catch (e: any) { clearTimeout(timer); this.pending.delete(id); reject(new Error('Failed to write to input host: ' + e?.message)); }
    });
  }

  private init(): Promise<void> {
    if (!this.ready) {
      const setup =
        `if (-not ('OwlInput' -as [type])) { Add-Type -TypeDefinition ${psStr(CSHARP)} -Language CSharp | Out-Null }; ` +
        `[OwlInput]::InitDpi(); 'ok'`;
      this.ready = this.raw(setup, INIT_TIMEOUT_MS).then(() => undefined);
      this.ready.catch(() => { this.ready = null; });
    }
    return this.ready;
  }

  async run<T = any>(script: string, timeoutMs = CMD_TIMEOUT_MS): Promise<T> {
    await this.init();
    return this.raw(script, timeoutMs);
  }

  dispose() {
    const p = this.proc;
    this.proc = null;
    this.ready = null;
    for (const [, q] of this.pending) { clearTimeout(q.timer); q.reject(new Error('Computer input host disposed')); }
    this.pending.clear();
    if (p) { try { p.stdin.end(); } catch {} try { p.kill(); } catch {} }
  }
}

const host = new PsHost();
process.once('exit', () => host.dispose());

// ───────────────────────────── key map ─────────────────────────────

const VK: Record<string, number> = {
  backspace: 0x08, tab: 0x09, enter: 0x0d, return: 0x0d, shift: 0x10, ctrl: 0x11, control: 0x11, alt: 0x12, option: 0x12,
  pause: 0x13, capslock: 0x14, esc: 0x1b, escape: 0x1b, space: 0x20, pageup: 0x21, pgup: 0x21, pagedown: 0x22, pgdn: 0x22,
  end: 0x23, home: 0x24, left: 0x25, up: 0x26, right: 0x27, down: 0x28, arrowleft: 0x25, arrowup: 0x26, arrowright: 0x27,
  arrowdown: 0x28, printscreen: 0x2c, prtsc: 0x2c, insert: 0x2d, ins: 0x2d, delete: 0x2e, del: 0x2e,
  win: 0x5b, windows: 0x5b, meta: 0x5b, cmd: 0x5b, command: 0x5b, super: 0x5b, lwin: 0x5b, rwin: 0x5c, menu: 0x5d, apps: 0x5d,
  numpad0: 0x60, numpad1: 0x61, numpad2: 0x62, numpad3: 0x63, numpad4: 0x64, numpad5: 0x65, numpad6: 0x66, numpad7: 0x67,
  numpad8: 0x68, numpad9: 0x69, multiply: 0x6a, add: 0x6b, separator: 0x6c, subtract: 0x6d, decimal: 0x6e, divide: 0x6f,
  numlock: 0x90, scrolllock: 0x91, lshift: 0xa0, rshift: 0xa1, lctrl: 0xa2, rctrl: 0xa3, lalt: 0xa4, ralt: 0xa5, altgr: 0xa5,
  volumemute: 0xad, volumedown: 0xae, volumeup: 0xaf, medianext: 0xb0, mediaprev: 0xb1, mediastop: 0xb2, mediaplaypause: 0xb3,
  ';': 0xba, semicolon: 0xba, '=': 0xbb, equals: 0xbb, plus: 0xbb, ',': 0xbc, comma: 0xbc, '-': 0xbd, minus: 0xbd,
  '.': 0xbe, period: 0xbe, '/': 0xbf, slash: 0xbf, '`': 0xc0, backquote: 0xc0, '[': 0xdb, '\\': 0xdc, backslash: 0xdc,
  ']': 0xdd, "'": 0xde, quote: 0xde,
};
for (let c = 0; c < 26; c++) VK[String.fromCharCode(97 + c)] = 0x41 + c;
for (let d = 0; d < 10; d++) VK[String(d)] = 0x30 + d;
for (let f = 1; f <= 24; f++) VK['f' + f] = 0x6f + f;

/** 'ctrl+shift+t' → [0x11,0x10,0x54]. Throws on unknown keys. */
function parseCombo(combo: string): number[] {
  const parts = combo.trim().toLowerCase().split(/\s*\+\s*/).filter(Boolean);
  if (!parts.length) throw new Error('Empty key combo');
  if (parts.length > 6) throw new Error('Key combo too long');
  return parts.map((p) => {
    const v = VK[p];
    if (v == null) throw new Error(`Unknown key "${p}"`);
    return v;
  });
}

// ───────────────────────────── implementation ─────────────────────────────

const isWin = process.platform === 'win32';
function requireWin() { if (!isWin) throw new Error(NOT_WINDOWS); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastShot: { scaleX: number; scaleY: number; width: number; height: number } | null = null;

async function screenshot(): Promise<ScreenshotResult> {
  requireWin();
  const disp = screen.getPrimaryDisplay();
  const sf = disp.scaleFactor || 1;
  const physW = Math.round(disp.size.width * sf);
  const physH = Math.round(disp.size.height * sf);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: physW, height: physH } });
  if (!sources.length) throw new Error('No screen available to capture');
  const src = sources.find((s) => s.display_id === String(disp.id)) ?? sources[0];
  let img = src.thumbnail;
  if (img.isEmpty()) throw new Error('Screen capture returned an empty image (screen locked or capture blocked?)');
  if (img.getSize().width > MAX_SHOT_WIDTH) img = img.resize({ width: MAX_SHOT_WIDTH, quality: 'good' });
  const { width, height } = img.getSize();
  const scaleX = physW / width;
  const scaleY = physH / height;
  lastShot = { scaleX, scaleY, width, height };
  return {
    dataUrl: 'data:image/jpeg;base64,' + img.toJPEG(JPEG_QUALITY).toString('base64'),
    width,
    height,
    scale: scaleX,
  };
}

async function moveMouse(x: number, y: number): Promise<void> {
  requireWin();
  await host.run(`[OwlInput]::Move(${int(x, 'x')}, ${int(y, 'y')}); $null`);
}

function btn(b: any): MouseButton {
  return b === 'right' || b === 'middle' ? b : 'left';
}

async function click(x: number, y: number, button: MouseButton = 'left', double = false): Promise<void> {
  requireWin();
  await host.run(`[OwlInput]::Click(${int(x, 'x')}, ${int(y, 'y')}, ${psStr(btn(button))}, ${double ? 2 : 1}); $null`);
}

async function doubleClick(x: number, y: number, button: MouseButton = 'left'): Promise<void> {
  return click(x, y, button, true);
}

async function drag(x1: number, y1: number, x2: number, y2: number): Promise<void> {
  requireWin();
  await host.run(`[OwlInput]::Drag(${int(x1, 'x1')}, ${int(y1, 'y1')}, ${int(x2, 'x2')}, ${int(y2, 'y2')}); $null`);
}

/** dy = wheel notches; positive scrolls DOWN, negative scrolls UP. */
async function scroll(x: number, y: number, dy: number): Promise<void> {
  requireWin();
  const n = int(dy, 'dy', -100, 100);
  if (!n) return;
  await host.run(`[OwlInput]::Scroll(${int(x, 'x')}, ${int(y, 'y')}, ${n}); $null`);
}

async function typeText(text: string): Promise<void> {
  requireWin();
  const s = String(text ?? '');
  if (s.length > MAX_TYPE_LEN) throw new Error(`Text too long (max ${MAX_TYPE_LEN} chars)`);
  let i = 0;
  while (i < s.length) {
    let end = Math.min(i + TYPE_CHUNK, s.length);
    // don't split a surrogate pair across chunks
    if (end < s.length && /[\uD800-\uDBFF]/.test(s[end - 1])) end++;
    await host.run(`[OwlInput]::TypeUnicode(${psStr(s.slice(i, end))}); $null`, 60000);
    i = end;
  }
}

/** 'ctrl+c', 'alt+tab', 'win+r', 'enter'. Several combos may be space-separated: 'ctrl+a ctrl+c'. */
async function pressKeys(combo: string): Promise<void> {
  requireWin();
  const combos = String(combo ?? '').trim().split(/\s+/).filter(Boolean);
  if (!combos.length) throw new Error('No keys given');
  if (combos.length > 20) throw new Error('Too many key combos (max 20)');
  const parsed = combos.map(parseCombo); // validate all before sending any
  for (const vks of parsed) {
    await host.run(`[OwlInput]::Combo([int[]]@(${vks.join(',')})); $null`);
    await sleep(40);
  }
}

async function cursorPosition(): Promise<{ x: number; y: number }> {
  requireWin();
  const p = await host.run<{ X: number; Y: number }>(`$p = [OwlInput]::Pos(); [pscustomobject]@{ X = $p.X; Y = $p.Y }`);
  return { x: p?.X ?? 0, y: p?.Y ?? 0 };
}

async function listWindows(): Promise<WindowInfo[]> {
  requireWin();
  const rows = await host.run<any>(
    `$names = @{}; Get-Process | ForEach-Object { $names[$_.Id] = $_.ProcessName }; ` +
    `,@([OwlInput]::Windows() | ForEach-Object { [pscustomobject]@{ handle = $_.Handle; pid = $_.Pid; processName = [string]$names[$_.Pid]; title = $_.Title } })`,
  );
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  return list
    .filter((w: any) => w && w.title && w.title !== 'Program Manager')
    .map((w: any) => ({ handle: Number(w.handle), pid: Number(w.pid), processName: String(w.processName || ''), title: String(w.title) }));
}

async function focusWindow(titleSubstring: string): Promise<string> {
  requireWin();
  const needle = String(titleSubstring ?? '').trim();
  if (!needle) throw new Error('Window title is required');
  if (needle.length > 500) throw new Error('Window title too long');
  const title = await host.run<string | null>(
    `$t = [OwlInput]::Focus(${psStr(needle)}); ` +
    `if ($null -eq $t) { if ((New-Object -ComObject WScript.Shell).AppActivate(${psStr(needle)})) { $t = ${psStr(needle)} } }; $t`,
  );
  if (!title) throw new Error(`No window matching "${needle}"`);
  return String(title);
}

/** Split 'notepad C:\a.txt' / '"C:\Program Files\x.exe" --flag' into file + argument string. */
function splitCommand(command: string): { file: string; args: string } {
  const c = command.trim();
  if (c.startsWith('"')) {
    const end = c.indexOf('"', 1);
    if (end < 0) throw new Error('Unbalanced quote in command');
    return { file: c.slice(1, end), args: c.slice(end + 1).trim() };
  }
  const sp = c.search(/\s/);
  return sp < 0 ? { file: c, args: '' } : { file: c.slice(0, sp), args: c.slice(sp + 1).trim() };
}

async function runApp(command: string, opts?: { allowed?: boolean }): Promise<string> {
  requireWin();
  if (!(opts?.allowed ?? policy.allowRunApp)) throw new Error('Opening apps is not allowed by the current computer-use policy');
  const cmd = String(command ?? '');
  if (!cmd.trim()) throw new Error('Command is required');
  if (cmd.length > 2000 || /[\0\r\n]/.test(cmd)) throw new Error('Invalid command');
  const { file, args } = splitCommand(cmd);
  // file/args reach Start-Process as decoded strings (never parsed as PowerShell)
  await host.run(
    `$f = ${psStr(file)}; $a = ${psStr(args)}; ` +
    `if ($a) { Start-Process -FilePath $f -ArgumentList $a } else { Start-Process -FilePath $f }; $null`,
    30000,
  );
  return file;
}

export const computer = {
  available(): boolean { return isWin; },
  setPolicy(p: Partial<ComputerPolicy>) { Object.assign(policy, p); },
  getPolicy(): ComputerPolicy { return { ...policy }; },
  screenshot,
  moveMouse,
  click,
  doubleClick,
  drag,
  scroll,
  typeText,
  pressKeys,
  cursorPosition,
  listWindows,
  focusWindow,
  runApp,
  dispose() { host.dispose(); lastShot = null; },
};

// ───────────────────────────── LLM tools ─────────────────────────────

const XY = {
  x: { type: 'number', description: 'X coordinate in screenshot pixels (from the latest computer_screenshot)' },
  y: { type: 'number', description: 'Y coordinate in screenshot pixels (from the latest computer_screenshot)' },
};

export const COMPUTER_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'computer_screenshot',
      description: 'Take a screenshot of the primary screen of the user\'s Windows desktop. Coordinates for all other computer_* tools are in this screenshot\'s pixel space.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_click',
      description: 'Move the mouse to (x, y) and click. Returns a new screenshot.',
      parameters: {
        type: 'object',
        properties: { ...XY, button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default left)' } },
        required: ['x', 'y'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_double_click',
      description: 'Double-click with the left mouse button at (x, y). Returns a new screenshot.',
      parameters: { type: 'object', properties: { ...XY }, required: ['x', 'y'], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_move',
      description: 'Move the mouse cursor to (x, y) without clicking (e.g. to hover). Returns a new screenshot.',
      parameters: { type: 'object', properties: { ...XY }, required: ['x', 'y'], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_drag',
      description: 'Press the left mouse button at (x1, y1), drag to (x2, y2) and release. Returns a new screenshot.',
      parameters: {
        type: 'object',
        properties: {
          x1: { type: 'number', description: 'Start X (screenshot px)' },
          y1: { type: 'number', description: 'Start Y (screenshot px)' },
          x2: { type: 'number', description: 'End X (screenshot px)' },
          y2: { type: 'number', description: 'End Y (screenshot px)' },
        },
        required: ['x1', 'y1', 'x2', 'y2'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_scroll',
      description: 'Scroll the mouse wheel at (x, y). Positive amount scrolls down, negative scrolls up (1 = one wheel notch, ~3 lines). Returns a new screenshot.',
      parameters: {
        type: 'object',
        properties: { ...XY, amount: { type: 'number', description: 'Wheel notches; positive = down, negative = up (e.g. 5 or -5)' } },
        required: ['x', 'y', 'amount'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_type',
      description: 'Type text into the focused control (any Unicode; \\n presses Enter). Click the target field first. Returns a new screenshot.',
      parameters: { type: 'object', properties: { text: { type: 'string', description: 'Text to type' } }, required: ['text'], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_key',
      description: 'Press a key or key combination, e.g. "enter", "ctrl+c", "ctrl+shift+t", "alt+tab", "win+r", "f5". Several combos may be separated by spaces ("ctrl+a ctrl+c"). Returns a new screenshot.',
      parameters: { type: 'object', properties: { keys: { type: 'string', description: 'Key combo(s) joined with +' } }, required: ['keys'], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_list_windows',
      description: 'List visible top-level windows (title, process name, pid).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_focus_window',
      description: 'Bring the first window whose title contains the given text (case-insensitive) to the foreground. Returns a new screenshot.',
      parameters: { type: 'object', properties: { title: { type: 'string', description: 'Part of the window title' } }, required: ['title'], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_open_app',
      description: 'Launch an application, file or URL with Windows Start-Process, e.g. "notepad", "calc", "explorer C:\\\\Users", "https://example.com". Only works if the user allowed opening apps. Returns a new screenshot.',
      parameters: { type: 'object', properties: { command: { type: 'string', description: 'Program (optionally quoted path) followed by arguments' } }, required: ['command'], additionalProperties: false },
    },
  },
];

/** screenshot-space → physical screen px using the latest screenshot (takes one if none yet). */
async function toScreen(x: any, y: any): Promise<{ x: number; y: number }> {
  if (!lastShot) await screenshot();
  const s = lastShot!;
  const sx = Number(x), sy = Number(y);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) throw new Error('x and y must be numbers');
  const cx = Math.min(Math.max(sx, 0), s.width - 1);
  const cy = Math.min(Math.max(sy, 0), s.height - 1);
  return { x: Math.round(cx * s.scaleX), y: Math.round(cy * s.scaleY) };
}

async function after(text: string, waitMs = SETTLE_MS): Promise<ComputerToolResult> {
  await sleep(waitMs);
  try {
    const shot = await screenshot();
    return { text: `${text}\nNew screenshot attached (${shot.width}x${shot.height}).`, image: shot.dataUrl };
  } catch (e: any) {
    return { text: `${text}\n(Screenshot failed: ${e?.message || e})` };
  }
}

export async function runComputerTool(name: string, args: any, opts?: { allowRunApp?: boolean }): Promise<ComputerToolResult> {
  const a = args && typeof args === 'object' ? args : {};
  if (!isWin) return { text: `Error: ${NOT_WINDOWS}` };
  try {
    switch (name) {
      case 'computer_screenshot': {
        const s = await screenshot();
        return { text: `Screenshot of the primary display, ${s.width}x${s.height} px. Use these pixel coordinates for other computer tools.`, image: s.dataUrl };
      }
      case 'computer_click': {
        const p = await toScreen(a.x, a.y);
        const b = btn(a.button);
        await click(p.x, p.y, b);
        return after(`Clicked ${b} at (${Math.round(a.x)}, ${Math.round(a.y)}).`);
      }
      case 'computer_double_click': {
        const p = await toScreen(a.x, a.y);
        await click(p.x, p.y, 'left', true);
        return after(`Double-clicked at (${Math.round(a.x)}, ${Math.round(a.y)}).`);
      }
      case 'computer_move': {
        const p = await toScreen(a.x, a.y);
        await moveMouse(p.x, p.y);
        return after(`Moved mouse to (${Math.round(a.x)}, ${Math.round(a.y)}).`);
      }
      case 'computer_drag': {
        const p1 = await toScreen(a.x1, a.y1);
        const p2 = await toScreen(a.x2, a.y2);
        await drag(p1.x, p1.y, p2.x, p2.y);
        return after(`Dragged from (${Math.round(a.x1)}, ${Math.round(a.y1)}) to (${Math.round(a.x2)}, ${Math.round(a.y2)}).`);
      }
      case 'computer_scroll': {
        const p = await toScreen(a.x, a.y);
        const amt = Math.max(-50, Math.min(50, Math.round(Number(a.amount ?? a.dy ?? 3)) || 0));
        await scroll(p.x, p.y, amt);
        return after(`Scrolled ${amt >= 0 ? 'down' : 'up'} ${Math.abs(amt)} at (${Math.round(a.x)}, ${Math.round(a.y)}).`);
      }
      case 'computer_type': {
        const t = String(a.text ?? '');
        await typeText(t);
        return after(`Typed ${t.length} characters.`);
      }
      case 'computer_key': {
        const k = String(a.keys ?? a.key ?? '');
        await pressKeys(k);
        return after(`Pressed ${k}.`);
      }
      case 'computer_list_windows': {
        const wins = await listWindows();
        if (!wins.length) return { text: 'No visible windows.' };
        return { text: wins.map((w) => `- "${w.title}" (${w.processName || 'unknown'}, pid ${w.pid})`).join('\n') };
      }
      case 'computer_focus_window': {
        const t = await focusWindow(String(a.title ?? ''));
        return after(`Focused window "${t}".`);
      }
      case 'computer_open_app': {
        const allowed = opts?.allowRunApp ?? policy.allowRunApp;
        if (!allowed) return { text: 'Error: Opening apps is not allowed. Ask the user to enable it, or open the app another way (e.g. win key + typing its name).' };
        const f = await runApp(String(a.command ?? ''), { allowed });
        return after(`Started "${f}".`, 1500);
      }
      default:
        return { text: `Error: unknown computer tool "${name}"` };
    }
  } catch (e: any) {
    return { text: `Error: ${e?.message || String(e)}` };
  }
}
