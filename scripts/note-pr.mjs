// Builds the approval pull request for a Morning Note. The workflow runs it when
// the desk pushes a claude/note-YYYY-MM-DD branch; merging the PR publishes.
// The body ends with a ready-to-paste email version for Kit.
//   node scripts/note-pr.mjs 2026-09-24           -> PR body (markdown)
//   node scripts/note-pr.mjs 2026-09-24 --title   -> PR title
import { loadContent } from './validate.mjs';
import { fetchJSON, p, readJSON } from './lib/util.mjs';

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

const site = await readJSON(p('config', 'site.json'));
const SITE = (process.env.SITE_URL || site.url || '').replace(/\/+$/, '');
const { briefs, errors } = await loadContent();
const byId = new Map(briefs.map((b) => [b.id, b]));
const ids = [...new Set([note.lead, ...(note.stories ?? [])].filter(Boolean))];
const stories = ids.map((id) => byId.get(id)).filter(Boolean);

// Plain text from feeds and briefs must not turn into Markdown formatting.
const md = (s) => String(s ?? '').replace(/([\\*_[\]<>])/g, '\\$1').replace(/^#/, '\\#');

// The site holds a note until its publishedAt, so a note merged at night goes live at 07:00.
const parts = Object.fromEntries(
  new Intl.DateTimeFormat('en-GB', { timeZone: site.timezone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(note.publishedAt))
    .map((x) => [x.type, x.value]),
);
const liveAt = `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} WIB`;
const editionDay = `${parts.weekday}, ${parts.day} ${parts.month}`;
const goesLive =
  Date.parse(note.publishedAt) > Date.now()
    ? `**Goes live ${liveAt}** once merged: the site holds it until then.${site.newsletterLive ? ' Schedule the email for the same time.' : ''}`
    : '**Publishes as soon as you merge.**';

// Also on the wire: three headlines from the last 36 hours that the stories don't cover,
// banking, payments, SEA and rules before deals, and one per publisher.
const covered = new Set(stories.flatMap((b) => b.sources.map((s) => s.url)));
const wire = SITE ? await fetchJSON(`${SITE}/data/wire.json`) : null;
const RANK = ['banking', 'payments', 'sea', 'rules', 'deals'];
const rank = (i) => (RANK.indexOf(i.section) + 1 || RANK.length + 1);
const when = (i) => Date.parse(i.publishedAt ?? i.firstSeen);
const wireItems = [];
for (const i of (wire?.items ?? [])
  .filter((i) => i.display !== false && i.section !== 'models' && !covered.has(i.url) && Date.now() - when(i) < 36 * 3600_000)
  .sort((a, b) => rank(a) - rank(b) || when(b) - when(a))) {
  if (wireItems.length === 3) break;
  if (!wireItems.some((w) => w.source === i.source)) wireItems.push(i);
}

// The email version only appears while the newsletter is sending (site.newsletterLive).
const email = !site.newsletterLive ? [] : [
  '## Email version, ready for Kit',
  '',
  `**Subject:** ${md(note.title)}`,
  '',
  `**Preview text:** ${md(note.dek ?? '')}`,
  '',
  'In Kit: Broadcasts → New broadcast. Copy everything from **Start of email** to **End of email**, paste it in, set the subject and preview text, then schedule it.',
  '',
  '**Start of email**',
  '',
  `**Notes from the Terminal · The Morning Note** · ${editionDay}`,
  '',
  '### Top stories',
  '',
  ...stories.slice(0, 4).flatMap((b) => [
    `**[${md(b.headline)}](${SITE}/story/${b.id}/)**`,
    '',
    md(b.body),
    '',
    ...(b.note ? [`*Why it matters:* ${md(b.note)}`, ''] : []),
  ]),
  `**A note from us:** enjoying the Morning Note? Forward it to a colleague in finance, or follow [@${site.x} on X](https://x.com/${site.x}) for the stories as they land.`,
  '',
  "### Today's idea",
  '',
  `**${md(note.title)}**`,
  '',
  ...(note.dek ? [md(note.dek), ''] : []),
  `[Read the Morning Note →](${SITE}/notes/${date}/)`,
  '',
  ...(wireItems.length
    ? ['### Also on the wire', '', ...wireItems.map((i) => `- [${md(i.title)}](${i.url}) · ${md(i.source)}`), '']
    : []),
  '**End of email**',
  '',
];

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
    ...ids.map((id) => `- ${byId.get(id)?.headline ?? `${id} (not found)`}`),
    '',
    ...(errors.length ? ['**Validation errors (fix before merging)**', '', ...errors.map((e) => `- ${e}`), ''] : []),
    goesLive,
    '',
    'Merge this pull request to publish the note. Close it to discard.',
    `To edit first, change \`content/notes/${date}.json\` on this branch, then merge.`,
    '',
    '---',
    '',
    ...email,
    ...(email.length ? ['---', ''] : []),
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n'),
);
