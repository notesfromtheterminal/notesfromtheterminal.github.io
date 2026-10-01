// Prints a source page's own text, so quotes and numbers come from the page and not
// from a summary of it.
//   node scripts/source.mjs <url>                   -> the page text
//   node scripts/source.mjs <url> --find "phrase"   -> is this exact phrase on the page?
import { fetchSource, norm } from './lib/grounding.mjs';

const [url, flag, phrase] = process.argv.slice(2);
if (!/^https?:\/\//.test(url ?? '') || (flag && (flag !== '--find' || !phrase))) {
  console.error('usage: node scripts/source.mjs <url> [--find "exact phrase"]');
  process.exit(2);
}

const page = await fetchSource(url);
if (!page.ok) {
  console.error(`UNREADABLE ${url}: ${page.error}`);
  console.error('You cannot quote this page or take numbers from it. Find a source you can read, or skip the claim.');
  process.exit(1);
}

if (flag === '--find') {
  const hit = norm(page.text).includes(norm(phrase));
  console.log(hit ? `FOUND on the page: "${phrase}"` : `NOT on the page: "${phrase}"`);
  if (hit) {
    const line = page.text.split('\n').find((l) => norm(l).includes(norm(phrase)));
    if (line) console.log(`\n${line.trim()}`);
  }
  process.exit(hit ? 0 : 1);
}

console.log(page.text);
