import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const p = (...parts) => path.join(ROOT, ...parts);

// Browser-like UA so publisher CDNs don't reject us, but still names the bot.
export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/128.0 Safari/537.36 NotesFromTheTerminal/0.1 (+https://x.com/0xNotMarc)';

export async function readJSON(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

export async function writeJSON(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
}

export async function writeText(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

export const hash = (s, n = 12) => createHash('sha1').update(s).digest('hex').slice(0, n);

// Fetch JSON with a timeout; returns undefined instead of throwing.
export async function fetchJSON(url, timeoutMs = 15000) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

// ---------- text ----------

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»',
};

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export function stripHtml(s) {
  if (!s) return '';
  const once = decodeEntities(String(s))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(once).replace(/\s+/g, ' ').trim();
}

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// ---------- urls ----------

const TRACKING = /^(utm_.*|fbclid|gclid|mc_cid|mc_eid|ncid|cmpid|rssid|sr_share|guccounter|ito|smid|ftcamp|at_medium|at_campaign|taid)$/i;

export function cleanUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export function urlKey(url) {
  const u = new URL(url);
  return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + u.search).toLowerCase();
}

// ---------- dates (always rendered in the desk's timezone) ----------

const fmtCache = new Map();
function fmt(tz, opts) {
  const key = tz + JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }));
  return fmtCache.get(key);
}

export const toDate = (v) => (v instanceof Date ? v : new Date(v));
export const timeOf = (d, tz) => fmt(tz, { hour: '2-digit', minute: '2-digit', hour12: false }).format(toDate(d));
export const longDay = (d, tz) =>
  fmt(tz, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(toDate(d));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Built by hand so every locale prints "23 Sep" (en-GB alone prints "23 Sept").
export function shortDay(d, tz) {
  const [y, m, day] = dayKey(d, tz).split('-');
  return `${Number(day)} ${MONTHS[Number(m) - 1]}`;
}

// YYYY-MM-DD in the given timezone
export function dayKey(d, tz) {
  const parts = Object.fromEntries(
    fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(toDate(d))
      .map((x) => [x.type, x.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
