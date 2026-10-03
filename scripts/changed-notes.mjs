// Morning Notes whose email has not gone out yet but whose content changed in a push: the note
// file itself, or any brief it connects. Prints one date per line, for the note-changed job.
//   node scripts/changed-notes.mjs <before-sha> <after-sha>
import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { p, readJSON } from './lib/util.mjs';

const [before, after = 'HEAD'] = process.argv.slice(2);
const changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=M', before, after, '--', 'content/notes', 'content/briefs'], { cwd: p(), encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.json'));
const changedNotes = new Set(changed.filter((f) => f.startsWith('content/notes/')).map((f) => f.slice('content/notes/'.length, -'.json'.length)));
const changedBriefs = new Set();
for (const f of changed.filter((f) => f.startsWith('content/briefs/'))) changedBriefs.add((await readJSON(p(f))).id);

for (const file of (await readdir(p('content', 'notes'))).filter((f) => f.endsWith('.json'))) {
  const n = await readJSON(p('content', 'notes', file));
  if (Date.parse(n.publishedAt) <= Date.now()) continue;
  const cites = [n.lead, ...(n.stories ?? [])];
  if (changedNotes.has(n.date) || cites.some((id) => changedBriefs.has(id))) console.log(n.date);
}
