/**
 * Small URL / host policy helpers shared by the agent tools, LLM providers and the IPC layer.
 * Pure functions (plus one async DNS lookup) so they are easy to reason about and test.
 */
import * as dns from 'dns';
import * as net from 'net';

/** Hostname as URL gives it, without IPv6 brackets, lower-cased. */
function bare(host: string): string {
  return String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
}

export function isLoopbackHost(host: string): boolean {
  const h = bare(host);
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (net.isIPv4(h)) return h.startsWith('127.');
  if (net.isIPv6(h)) return h === '::1' || h === '0:0:0:0:0:0:0:1';
  return false;
}

/** Loopback, RFC1918, link-local, CGNAT, unique-local IPv6, unspecified, `.local` / `.internal` names. */
export function isPrivateHost(host: string): boolean {
  const h = bare(host);
  if (!h) return true;
  if (isLoopbackHost(h)) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home.arpa') || !h.includes('.') && !net.isIP(h)) return true;
  if (net.isIPv4(h)) {
    const [a, b] = h.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(h)) {
    if (h === '::' || h === '::1') return true;
    const m = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateHost(m[1]);
    const hx = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/); // URL() normalises ::ffff:127.0.0.1 to ::ffff:7f00:1
    if (hx) { const a = parseInt(hx[1], 16), b = parseInt(hx[2], 16); return isPrivateHost(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`); }
    return /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
  }
  return false;
}

/** Resolves the host and reports whether any address it points to is private/loopback (DNS-rebinding aware enough for a prompt). */
export async function resolvesToPrivate(host: string): Promise<boolean> {
  const h = bare(host);
  if (isPrivateHost(h)) return true;
  if (net.isIP(h)) return false;
  try {
    const addrs = await dns.promises.lookup(h, { all: true, verbatim: true });
    return addrs.some((a) => isPrivateHost(a.address));
  } catch {
    return false; // unresolvable: the request itself will fail
  }
}

/**
 * Model provider endpoints: https anywhere; plain http only for loopback / private-network hosts
 * (Ollama, LM Studio, llama.cpp on this machine or the LAN).
 */
export function checkProviderUrl(raw: string): { ok: boolean; url?: URL; reason?: string } {
  let u: URL;
  try { u = new URL(String(raw || '').trim()); } catch { return { ok: false, reason: 'Invalid provider URL' }; }
  if (u.username || u.password) return { ok: false, reason: 'Do not put credentials in the provider URL; use the API key field' };
  if (u.protocol === 'https:') return { ok: true, url: u };
  if (u.protocol === 'http:' && isPrivateHost(u.hostname)) return { ok: true, url: u };
  return { ok: false, reason: 'Provider URL must use https:// (http:// is only allowed for local / private-network model servers)' };
}

/** May an API key be sent to this URL? Only over https, or over http to this machine. */
export function maySendKey(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || (u.protocol === 'http:' && isLoopbackHost(u.hostname));
  } catch { return false; }
}

/** URLs an agent may load or fetch at all. Everything else (file:, chrome:, owl:, devtools:, view-source:, data:, javascript:) is refused. */
export function isWebUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}
