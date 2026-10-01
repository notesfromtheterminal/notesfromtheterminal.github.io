// Grounding: read a source page as plain text, and compare what a brief or note says
// (quotes, numbers) with the evidence and sources behind it. Used by validate.mjs
// (offline) and check-sources.mjs (fetches every source).
import { decodeEntities, UA } from './util.mjs';

// The form all text is compared in: straight quotes and dashes, one space, lowercase.
export function norm(s) {
  return decodeEntities(String(s ?? ''))
    .normalize('NFKC')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Readable text of an HTML page: scripts, styles and tags removed, entities decoded.
export function pageText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|figcaption)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

// The page itself, never a summary of it. Bot checks and script-only pages count as unreadable.
export async function fetchSource(url, timeoutMs = 20_000) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    if (/pdf/i.test(res.headers.get('content-type') ?? '')) return { ok: false, error: 'PDF, not a web page' };
    const text = pageText(await res.text());
    if (text.length < 400) return { ok: false, error: 'almost no readable text (bot check or script-only page)' };
    return { ok: true, text, finalUrl: res.url };
  } catch (err) {
    return { ok: false, error: err.name === 'TimeoutError' ? 'timed out' : err.message };
  }
}

// Words in double quotes, two words or more: "a closed loop", "unequivocally yes".
export function quotesIn(s) {
  return [...String(s ?? '').matchAll(/["“]([^"“”]{3,}?)["”]/g)]
    .map((m) => m[1].trim().replace(/[.,;:!?]+$/, ''))
    .filter((q) => /\s/.test(q));
}

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
// Numbers as digit strings ("9,920" -> "9920", "2.2%" -> "2.2"). Years and the day in a
// date ("September 29") are left out: they are checked by people, not pattern matching.
export function numbersIn(s) {
  const text = String(s ?? '')
    .replace(new RegExp(`\\b${MONTH}\\s+\\d{1,2}\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b\\d{1,2}\\s+${MONTH}`, 'gi'), ' ');
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => m[0].replace(/,(?=\d{3}(?!\d))/g, '').replace(/[.,]$/, ''))
    .filter((n) => !/^(19|20)\d\d$/.test(n));
}

// Every quote and number in `text` that the reference texts do not contain.
export function ungrounded(text, refs) {
  const hay = norm(refs.join(' \n '));
  const have = new Set(refs.flatMap(numbersIn));
  return {
    quotes: quotesIn(text).filter((q) => !hay.includes(norm(q))),
    numbers: [...new Set(numbersIn(text))].filter((n) => !have.has(n)),
  };
}

const STOP = new Set(
  'about after again against along among around because before being below between could during every first from have their there these those through under until where which while would should since still other others whose shall might about'.split(' '),
);
const stem = (w) => (w.length >= 7 ? w.slice(0, -2) : w);
const contentWords = (s) =>
  [...new Set(norm(s).replace(/[^a-z0-9$%' -]/g, ' ').split(/\s+/).map((w) => w.replace(/^'+|'+$/g, '')))].filter((w) => w.length >= 5 && !STOP.has(w));

// Sentences of `text` whose key words (five letters or more) are mostly missing from the
// evidence: a claim with nothing behind it, even when it is paraphrased.
export function unsupported(text, refs, share = 0.6) {
  const pool = norm(refs.join(' '));
  return String(text ?? '')
    .split(/(?<=[.!?]["\u201D]?)\s+(?=["\u201C]?[A-Z0-9])/)
    .filter((sentence) => {
      const words = contentWords(sentence);
      if (words.length < 4) return false;
      const found = words.filter((w) => pool.includes(stem(w))).length;
      return found / words.length < share;
    });
}

