/** Join class names, dropping falsy values. */
export function cn(...parts: Array<string | false | null | undefined | 0>) {
  return parts.filter(Boolean).join(' ');
}

/** Platform-aware shortcut label: 'Ctrl+K' → '⌘K' on macOS. */
export function kbdLabel(k: string, platform: string = (globalThis as any).owl?.platform || 'win32') {
  if (platform !== 'darwin') return k;
  return k.replace(/Ctrl\+?/g, '⌘').replace(/Alt\+?/g, '⌥').replace(/Shift\+?/g, '⇧');
}
