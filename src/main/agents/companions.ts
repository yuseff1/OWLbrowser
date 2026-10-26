import { dataFor } from '../data';
import { uid } from '../store';
import type { Companion } from '../../shared/types';

/** OWL's official companions — an original owl crew. Art lives in renderer/public/art/companions/<id>.png */
export const OFFICIAL: Companion[] = [
  {
    id: 'hoot', name: 'Hoot', role: 'Research Scout', official: true, hired: true, createdAt: 0,
    tagline: 'Digs through the web and comes back with sourced answers.',
    instructions: 'You are a meticulous researcher. Open several sources in parallel tabs, cross-check facts, and always cite URLs. Prefer primary sources. Finish with a crisp summary and a list of sources.',
    look: { body: '#4C6FFF', belly: '#DCE4FF', accent: '#1B2A6B', shape: 'round', ears: 'tufts', eyes: 'glasses', prop: 'none' },
    tools: ['browser', 'memory', 'artifacts'],
  },
  {
    id: 'nova', name: 'Nova', role: 'Lead Hunter', official: true, hired: false, createdAt: 0,
    tagline: 'Finds qualified leads and drafts outreach in your voice.',
    instructions: 'You source B2B leads. Use LinkedIn, company sites, directories and Google. For each lead capture name, role, company, website, public email if published (never guess emails), and why they fit. Put results in a table or a Google Sheet when asked. Draft outreach but never send without approval.',
    look: { body: '#FF9A3D', belly: '#FFE7CF', accent: '#7A3A00', shape: 'wide', ears: 'tufts', eyes: 'big', prop: 'headset' },
    tools: ['browser', 'memory', 'artifacts', 'apps'],
  },
  {
    id: 'pip', name: 'Pip', role: 'Inbox & Calendar', official: true, hired: false, createdAt: 0,
    tagline: 'Morning brief, triaged inbox, replies drafted, follow-ups kept.',
    instructions: 'You manage email and calendar in the user\'s signed-in web apps (Gmail, Outlook, Google Calendar). Summarise what needs attention, draft replies in the user\'s voice, propose times. Never send or accept invites without approval.',
    look: { body: '#2FCB94', belly: '#D8F7EA', accent: '#0D5A3F', shape: 'bean', ears: 'none', eyes: 'sleepy', prop: 'bowtie' },
    tools: ['browser', 'memory', 'apps'],
  },
  {
    id: 'echo', name: 'Echo', role: 'Social & Marketing', official: true, hired: false, createdAt: 0,
    tagline: 'Learns what works for you and writes posts for every channel.',
    instructions: 'You help with marketing: analyse what performed on the user\'s channels, study competitors, and draft posts in the user\'s voice for X, LinkedIn, Instagram and newsletters. Publishing requires approval.',
    look: { body: '#FF6F91', belly: '#FFE0E8', accent: '#7A1630', shape: 'drop', ears: 'leaf', eyes: 'wink', prop: 'scarf' },
    tools: ['browser', 'memory', 'artifacts'],
  },
  {
    id: 'atlas', name: 'Atlas', role: 'Data Analyst', official: true, hired: false, createdAt: 0,
    tagline: 'Pulls data from any site into clean tables, charts and dashboards.',
    instructions: 'You extract structured data from websites and turn it into tables (CSV), charts and dashboards. Be exact with numbers and units, note the source and date for every dataset, and build visual artifacts when useful.',
    look: { body: '#8B5CF6', belly: '#EDE4FF', accent: '#3B1C7A', shape: 'tall', ears: 'horns', eyes: 'big', prop: 'monocle' },
    tools: ['browser', 'memory', 'artifacts', 'apps'],
  },
  {
    id: 'byte', name: 'Byte', role: 'Dev & QA', official: true, hired: false, createdAt: 0,
    tagline: 'Tests your web apps, files bugs and automates the boring stuff.',
    instructions: 'You are a QA engineer and automation dev. Explore web apps systematically, try edge cases, note bugs with exact repro steps and screenshots. You can drive the whole computer when computer use is enabled.',
    look: { body: '#14B8C4', belly: '#D4F6F8', accent: '#0A4D52', shape: 'square', ears: 'antenna', eyes: 'visor', prop: 'cap' },
    tools: ['browser', 'memory', 'computer', 'artifacts'],
  },
];

export const companions = {
  list(profileId: string): Companion[] {
    const custom = dataFor(profileId).companions.get();
    const merged = OFFICIAL.map((o) => ({ ...o, ...(custom.find((c) => c.id === o.id) || {}) }));
    return [...merged, ...custom.filter((c) => !OFFICIAL.some((o) => o.id === c.id))];
  },
  get(profileId: string, id: string): Companion {
    return this.list(profileId).find((c) => c.id === id) || this.list(profileId)[0];
  },
  hired(profileId: string) { return this.list(profileId).filter((c) => c.hired); },
  save(profileId: string, c: Partial<Companion> & { id?: string }): Companion {
    const store = dataFor(profileId).companions;
    const id = c.id || uid('c_');
    const base = this.list(profileId).find((x) => x.id === id);
    const next: Companion = {
      id,
      name: c.name ?? base?.name ?? 'New companion',
      role: c.role ?? base?.role ?? 'Generalist',
      tagline: c.tagline ?? base?.tagline ?? '',
      instructions: c.instructions ?? base?.instructions ?? '',
      look: c.look ?? base?.look ?? { body: '#9AA3B5', belly: '#EEF0F5', accent: '#3A4150', shape: 'round', ears: 'tufts', eyes: 'big', prop: 'none' },
      model: c.model ?? base?.model ?? null,
      tools: c.tools ?? base?.tools ?? ['browser', 'memory', 'artifacts'],
      official: base?.official ?? false,
      hired: c.hired ?? base?.hired ?? true,
      createdAt: base?.createdAt || Date.now(),
    };
    store.update((l) => { const i = l.findIndex((x) => x.id === id); if (i >= 0) l[i] = next; else l.push(next); });
    return next;
  },
  remove(profileId: string, id: string) {
    if (OFFICIAL.some((o) => o.id === id)) { this.save(profileId, { id, hired: false }); return; }
    dataFor(profileId).companions.update((l) => l.filter((c) => c.id !== id));
  },
};
