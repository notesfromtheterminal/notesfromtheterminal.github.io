// Builds the approval pull request for a Morning Note. The workflow runs it when
// the desk pushes a claude/note-YYYY-MM-DD branch; merging the PR publishes.
//   node scripts/note-pr.mjs 2026-09-24           -> PR body (markdown)
//   node scripts/note-pr.mjs 2026-09-24 --title   -> PR title
import { loadContent } from './validate.mjs';
import { p, readJSON } from './lib/util.mjs';

const [date, flag] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
  console.error('usage: node scripts/note-pr.mjs YYYY-MM-DD [--title]');
  process.exit(1);
}

const note = await readJSON(p('content', 'notes', `${date}.json`));
if (flag === '--title') {
  console.log(`Morning Note ${date}: ${note.title}`);
  process.exit(0);
}

const { briefs, errors } = await loadContent();
const headline = new Map(briefs.map((b) => [b.id, b.headline]));
const ids = [...new Set([note.lead, ...(note.stories ?? [])].filter(Boolean))];

console.log(
  [
    `## ${note.title}`,
    '',
    ...(note.dek ? [`*${note.dek}*`, ''] : []),
    ...note.body.flatMap((para) => [para, '']),
    '---',
    '',
    '**Stories this note connects**',
    '',
    ...ids.map((id) => `- ${headline.get(id) ?? `${id} (not found)`}`),
    '',
    ...(errors.length ? ['**Validation errors (fix before merging)**', '', ...errors.map((e) => `- ${e}`), ''] : []),
    '**Merge this pull request to publish the note. Close it to discard.**',
    `To edit first, change \`content/notes/${date}.json\` on this branch, then merge.`,
  ].join('\n'),
);
