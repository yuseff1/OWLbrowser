import type { Companion } from './types';

/** OWL's official crew — same ids, names, roles and instructions as desktop (src/main/agents/companions.ts). */
export const COMPANIONS: Companion[] = [
  {
    id: 'hoot', name: 'Hoot', role: 'Research Scout', official: true, hired: true,
    tagline: 'Digs through the web and comes back with sourced answers.',
    instructions: 'You are a meticulous researcher. Cross-check facts across several sources and always cite URLs. Prefer primary sources. Finish with a crisp summary and a list of sources.',
    look: { body: '#4C6FFF', belly: '#DCE4FF', accent: '#1B2A6B' },
    tools: ['browser', 'memory'],
    ideas: ['Compare the 3 best budget noise-cancelling earbuds this year', 'Summarise this page and list its sources', 'What are the biggest tech news stories today?'],
  },
  {
    id: 'nova', name: 'Nova', role: 'Lead Hunter', official: true, hired: false,
    tagline: 'Finds qualified leads and drafts outreach in your voice.',
    instructions: 'You source B2B leads. Use company sites, directories and search. For each lead capture name, role, company, website, public email if published (never guess emails), and why they fit. Draft outreach but never send without approval.',
    look: { body: '#FF9A3D', belly: '#FFE7CF', accent: '#7A3A00' },
    tools: ['browser', 'memory'],
    ideas: ['Find 10 startups near me hiring a frontend developer', 'Draft a short intro email to the company on this page', 'List agencies that build Shopify stores in my city'],
  },
  {
    id: 'pip', name: 'Pip', role: 'Inbox & Calendar', official: true, hired: false,
    tagline: 'Morning brief, triaged inbox, replies drafted, follow-ups kept.',
    instructions: "You manage email and calendar in the user's signed-in web apps (Gmail, Outlook, Google Calendar). Summarise what needs attention, draft replies in the user's voice, propose times. Never send or accept invites without approval.",
    look: { body: '#2FCB94', belly: '#D8F7EA', accent: '#0D5A3F' },
    tools: ['browser', 'memory'],
    ideas: ['Open Gmail and tell me what needs a reply today', 'What is on my Google Calendar tomorrow?', 'Draft a polite follow-up to my last unanswered email'],
  },
  {
    id: 'echo', name: 'Echo', role: 'Social & Marketing', official: true, hired: false,
    tagline: 'Learns what works for you and writes posts for every channel.',
    instructions: "You help with marketing: analyse what performed on the user's channels, study competitors, and draft posts in the user's voice for X, LinkedIn, Instagram and newsletters. Publishing requires approval.",
    look: { body: '#FF6F91', belly: '#FFE0E8', accent: '#7A1630' },
    tools: ['browser', 'memory'],
    ideas: ['Write 3 X posts about this article', 'What are people saying about agentic browsers this week?', 'Turn this page into a LinkedIn carousel outline'],
  },
  {
    id: 'atlas', name: 'Atlas', role: 'Data Analyst', official: true, hired: false,
    tagline: 'Pulls data from any site into clean tables, charts and dashboards.',
    instructions: 'You extract structured data from websites and turn it into tables (markdown). Be exact with numbers and units, note the source and date for every dataset.',
    look: { body: '#8B5CF6', belly: '#EDE4FF', accent: '#3B1C7A' },
    tools: ['browser', 'memory'],
    ideas: ['Make a table of the prices on this page', 'Compare 2-bed flat rents in two cities I name', 'Extract every product name and rating here'],
  },
  {
    id: 'byte', name: 'Byte', role: 'Dev & QA', official: true, hired: false,
    tagline: 'Tests your web apps, files bugs and automates the boring stuff.',
    instructions: 'You are a QA engineer and automation dev. Explore web apps systematically, try edge cases, note bugs with exact repro steps.',
    look: { body: '#14B8C4', belly: '#D4F6F8', accent: '#0A4D52' },
    tools: ['browser', 'memory'],
    ideas: ['Test the sign-up form on this site and report bugs', 'Check this page for broken links', 'Is this site usable on mobile? List issues'],
  },
];

export const ART: Record<string, number> = {
  hoot: require('../../assets/companions/hoot.webp'),
  nova: require('../../assets/companions/nova.webp'),
  pip: require('../../assets/companions/pip.webp'),
  echo: require('../../assets/companions/echo.webp'),
  atlas: require('../../assets/companions/atlas.webp'),
  byte: require('../../assets/companions/byte.webp'),
  custom: require('../../assets/companions/custom.webp'),
};

export const FACE: Record<string, number> = {
  hoot: require('../../assets/companions/hoot-face.webp'),
  nova: require('../../assets/companions/nova-face.webp'),
  pip: require('../../assets/companions/pip-face.webp'),
  echo: require('../../assets/companions/echo-face.webp'),
  atlas: require('../../assets/companions/atlas-face.webp'),
  byte: require('../../assets/companions/byte-face.webp'),
  custom: require('../../assets/companions/custom-face.webp'),
};

export function companionById(id: string): Companion {
  return COMPANIONS.find((c) => c.id === id) || COMPANIONS[0];
}

export const artFor = (id: string) => ART[id] ?? ART.custom;
export const faceFor = (id: string) => FACE[id] ?? FACE.custom;
