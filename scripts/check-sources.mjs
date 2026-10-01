// Fetches every source a brief cites and confirms each evidence sentence is really on
// that page. The desk runs it before every commit (`npm run check`).
//   node scripts/check-sources.mjs                 -> briefs changed vs origin/main, plus the last 6 hours
//   node scripts/check-sources.mjs <file.json>...  -> these briefs
//   node scripts/check-sources.mjs --since <ref>   -> briefs added or changed since a git ref
//   --ci                                           -> an unreadable source is a warning, not an error
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fetchSource, norm } from './lib/grounding.mjs';
import { p, readJSON } from './lib/util.mjs';
import { loadContent } from './validate.mjs';

const args = process.argv.slice(2);
const ci = args.includes('--ci');
const sinceAt = args.indexOf('--since');
const since = sinceAt >= 0 ? args[sinceAt + 1] : null;
const named = args.filter((a, i) => a.endsWith('.json') && !(sinceAt >= 0 && i === sinceAt + 1));

const git = (...a) => {
  try {
    return execFileSync('git', a, { cwd: p(), encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};
const changedSince = (ref) =>
  git('diff', '--name-only', '--diff-filter=AM', ref, '--', 'content/briefs')
    .split('\n')
    .filter((f) => f.endsWith('.json'));

let files;
if (named.length) files = named.map((f) => path.resolve(f));
else {
  const recent = (await loadContent()).briefs
    .filter((b) => Date.now() - Date.parse(b.publishedAt) < 6 * 3600_000)
    .map((b) => b._file)
    .filter(Boolean);
  const changed = [...changedSince(since ?? 'origin/main'), ...git('ls-files', '--others', '--exclude-standard', 'content/briefs').split('\n')]
    .filter((f) => f.endsWith('.json'))
    .map((f) => p(f));
  files = [...new Set([...changed, ...recent])];
}

// Freshness (NEWSROOM.md, Selection), for briefs published from this moment: judged by the
// newest source page that gives a date. Past 2 days the body must say when; past 7 it is not news.
const FRESH_FROM = Date.parse('2026-10-01T18:00:00+07:00');
const DAY = 86_400_000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Does the body say when it happened? A weekday, "last week", or a date on or before the
// news ("on September 28"). A later date, such as a deadline, does not count.
function saysWhen(body, newest, published) {
  if (/\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\blast (?:week|month)\b/i.test(body)) return true;
  const year = new Date(published).getUTCFullYear();
  const re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})\b(?:,? (\d{4}))?|\b(\d{1,2}) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b(?:,? (\d{4}))?/gi;
  return [...String(body).matchAll(re)].some((m) => {
    const [month, day, given] = m[1] ? [m[1], m[2], m[3]] : [m[5], m[4], m[6]];
    const on = (y) => Date.UTC(y, MONTHS.indexOf(month.slice(0, 3).toLowerCase()), Number(day));
    // No year given: the brief's own year, or the year before for a date months ahead (December in January).
    const at = given ? on(Number(given)) : on(year) > published + 183 * DAY ? on(year - 1) : on(year);
    return at <= newest + DAY;
  });
}
const dayOf = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const pages = new Map();
const read = (url) => {
  if (!pages.has(url)) pages.set(url, fetchSource(url));
  return pages.get(url);
};

let errors = 0;
let warnings = 0;
let checked = 0;
for (const file of files) {
  let b;
  try {
    b = await readJSON(file);
  } catch {
    continue;
  }
  if (!Array.isArray(b.evidence) || !b.evidence.length) continue;
  checked++;
  const where = path.relative(p(), file);
  for (const [i, ev] of b.evidence.entries()) {
    const src = b.sources?.[ev.source];
    if (!src) {
      console.log(`ERROR ${where}: evidence[${i}] points to source ${ev.source}, which the brief does not list`);
      errors++;
      continue;
    }
    const page = await read(src.url);
    if (!page.ok) {
      const msg = `${where}: evidence[${i}] cannot be checked, ${src.name} is unreadable (${page.error})`;
      if (ci) {
        console.log(`warn  ${msg}`);
        warnings++;
      } else {
        console.log(`ERROR ${msg}. Use a source that scripts/source.mjs can read, or drop the claim.`);
        errors++;
      }
      continue;
    }
    if (!norm(page.text).includes(norm(ev.text))) {
      console.log(`ERROR ${where}: evidence[${i}] is not on ${src.name}'s page (${src.url}): "${ev.text.slice(0, 90)}${ev.text.length > 90 ? '…' : ''}"`);
      errors++;
    }
  }
  if (Date.parse(b.publishedAt) >= FRESH_FROM) {
    const dates = [];
    for (const s of b.sources ?? []) {
      const page = await read(s.url);
      if (page.ok && page.published) dates.push(page.published);
    }
    // Undated pages are left to the desk's own reading of the page.
    if (dates.length) {
      const newest = Math.max(...dates);
      const days = (Date.parse(b.publishedAt) - newest) / DAY;
      const dated = `its newest source is dated ${dayOf(newest)}, ${Math.floor(days)} days before the brief`;
      if (days > 7) {
        console.log(`ERROR ${where}: ${dated}. That is not news: skip it, or brief what is new from a fresh source.`);
        errors++;
      } else if (days > 2 && !saysWhen(b.body, newest, Date.parse(b.publishedAt))) {
        console.log(`ERROR ${where}: ${dated}. Say when it happened in the body ("on September 28").`);
        errors++;
      }
    }
  }
}

console.log(`sources: ${checked} briefs checked, ${pages.size} pages read, ${errors} errors, ${warnings} warnings`);
process.exit(errors ? 1 : 0);
