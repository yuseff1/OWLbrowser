/** true when running in a plain browser with the preview mock (no Electron main process). */
export const isMock = typeof window !== 'undefined' && !!(window as any).__owlMock;

/** The OS OWL runs on, from the preload (`process.platform`). */
export const platform: string = (typeof window !== 'undefined' && (window as any).owl?.platform) || 'win32';
/** Human name of the OS for UI copy ("follows your macOS setting"). */
export const osName = platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform === 'win32' ? 'Windows' : platform;
/** What protects saved passwords/keys on this OS (see src/main/secrets.ts). */
export const keychainName = platform === 'darwin' ? 'your macOS Keychain' : platform === 'linux' ? 'your system keyring' : 'your Windows account';
/** Where the user changes the default browser. */
export const osSettingsName = platform === 'darwin' ? 'System Settings' : platform === 'linux' ? 'your system settings' : 'Windows Settings';
