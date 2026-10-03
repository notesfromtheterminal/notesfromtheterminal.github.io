// Fails when a Morning Note does not pass its checks, for the note-check status on its pull
// request (auto-merge waits for it). Only the note's own errors count: a broken brief it
// connects shows up as one ("story ... is not a published brief"); unrelated errors elsewhere don't.
//   node scripts/note-check.mjs YYYY-MM-DD
import { loadContent } from './validate.mjs';

const date = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
  console.error('usage: node scripts/note-check.mjs YYYY-MM-DD');
  process.exit(2);
}
const { errors, warnings } = await loadContent();
const mine = (list) => list.filter((m) => m.includes(`content/notes/${date}.json`));
for (const w of mine(warnings)) console.log(`warn  ${w}`);
for (const e of mine(errors)) console.log(`ERROR ${e}`);
console.log(`note-check ${date}: ${mine(errors).length} errors, ${mine(warnings).length} warnings`);
process.exit(mine(errors).length ? 1 : 0);
