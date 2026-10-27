import { REGULAR, FILLED, type IconName } from './icons.generated';
export type { IconName };

/** Fluent art for a name: 16px drawing up to 17px, 20px drawing above (crisper strokes at small sizes). */
export function iconArt(name: IconName, size: number, filled = false): { box: number; d: string[] } {
  const art = (filled && FILLED[name]) || REGULAR[name] || REGULAR['question-circle'];
  const a = art as { 16?: string[]; 20: string[] };
  return size <= 17 && a[16] ? { box: 16, d: a[16] } : { box: 20, d: a[20] };
}

/** Static SVG markup, for surfaces that take HTML strings (the native popup layer). */
export function iconSvg(name: IconName | undefined, size = 16, filled = false): string | undefined {
  if (!name) return undefined;
  const { box, d } = iconArt(name, size, filled);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${box} ${box}" fill="currentColor" aria-hidden="true" class="owl-icon">${d.map((p) => `<path d="${p}"/>`).join('')}</svg>`;
}
