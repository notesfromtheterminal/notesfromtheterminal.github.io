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
}

console.log(`sources: ${checked} briefs checked, ${pages.size} pages read, ${errors} errors, ${warnings} warnings`);
process.exit(errors ? 1 : 0);
