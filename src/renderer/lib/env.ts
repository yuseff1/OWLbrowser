/** true when running in a plain browser with the preview mock (no Electron main process). */
export const isMock = typeof window !== 'undefined' && !!(window as any).__owlMock;
