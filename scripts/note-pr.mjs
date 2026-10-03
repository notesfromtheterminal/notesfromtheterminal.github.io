// Builds the approval pull request for a Morning Note. The workflow runs it when
// the desk pushes a claude/note-YYYY-MM-DD branch; merging the PR publishes.
// Once the newsletter is live, the body ends with the email's HTML block for Kit.
//   node scripts/note-pr.mjs 2026-09-24           -> PR body (markdown)
//   node scripts/note-pr.mjs 2026-09-24 --title   -> PR title
import { execFileSync } from 'node:child_process';
import { untraced } from './lib/grounding.mjs';
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

const site = await readJSON(p('config', 'site.json'));
const SITE = (process.env.SITE_URL || site.url || '').replace(/\/+$/, '');
const { briefs, errors, warnings } = await loadContent();
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
const goesLive =
  Date.parse(note.publishedAt) > Date.now()
    ? `**Goes live ${liveAt}** once merged: the site holds it until then.${site.newsletterLive ? ' Schedule the email for the same time.' : ''}`
    : '**Publishes as soon as you merge.**';


// The email (only while site.newsletterLive): the HTML block scripts/email.mjs builds for Kit;
// the Kit template supplies the frame, unsubscribe link and address.
// This note's own check results: the email is only built from a note that passes.
const mine = (list) => list.filter((m) => m.includes(`content/notes/${date}.json`)).map((m) => m.split('.json: ').slice(1).join('.json: '));
const noteErrors = mine(errors);
const noteWarnings = mine(warnings);

let emailHtml = '';
if (site.newsletterLive && !noteErrors.length) {
  try {
    emailHtml = execFileSync(process.execPath, [p('scripts', 'email.mjs'), date], { encoding: 'utf8', env: { ...process.env, SITE_URL: SITE } }).trim();
  } catch (err) {
    emailHtml = '';
    console.error(`email: could not build the email (${err.message.split('\n')[0]})`);
  }
}
const emailCode = (howTo) =>
  emailHtml
    ? [
        howTo,
        '',
        ...(noteWarnings.length ? ['**Before you schedule, check these against the sources above:**', '', ...noteWarnings.map((w) => `- ${w}`), ''] : []),
        '```html',
        emailHtml,
        '```',
        '',
      ]
    : [
        noteErrors.length
          ? '**No email yet: the note fails its checks (listed above). The code appears here once they pass.**'
          : '**The email could not be built for this note.** Ask Claude to check `scripts/email.mjs`.',
        '',
      ];
const email = !site.newsletterLive
  ? []
  : [
      '## Email for Kit',
      '',
      `**Subject:** ${md(note.title)}`,
      '',
      `**Preview text:** ${md(note.dek ?? '')}`,
      '',
      ...emailCode(
        'In Kit: Send → Broadcasts → New broadcast. Add an **HTML block**, click Edit, paste the code below (copy button at its top right), Save. Set the subject and preview text above, send yourself a test, then schedule it for **07:00 WIB**.',
      ),
    ];

// --changed: the note was corrected on main after its pull request was merged. If its email has
// not gone out yet, the one scheduled in Kit is out of date, so this prints the comment that
// carries the corrected email (nothing once the note has published or the newsletter is off).
if (flag === '--changed') {
  if (site.newsletterLive && Date.parse(note.publishedAt) > Date.now())
    console.log(
      [
        '## This note changed after you merged it',
        '',
        'If you already scheduled the Kit email, open that broadcast, replace everything in its HTML block with the code below, check the subject and preview text, and keep the 07:00 schedule.',
        '',
        `**Subject:** ${md(note.title)}`,
        '',
        `**Preview text:** ${md(note.dek ?? '')}`,
        '',
        ...(noteErrors.length ? ['**The corrected note fails its checks:**', '', ...noteErrors.map((x) => `- ${x}`), ''] : []),
        ...emailCode('The corrected email:'),
      ].join('\n'),
    );
  process.exit(0);
}

console.log(
  [
    `## ${note.title}`,
    '',
    ...(note.dek ? [`*${note.dek}*`, ''] : []),
    // Each section with the evidence it rests on, so a reader can check the two side by side.
    ...note.body.flatMap((x) => {
      if (typeof x === 'string') return [x, ''];
      const sup = Array.isArray(x.support) ? x.support : [];
      const known = stories.flatMap((b) => [...b.sources.map((s) => s.name), b.company ?? '', b.headline]);
      const loose = sup.length ? untraced(x.text, [...sup, ...known]) : [];
      return [
        ...(x.head ? [`### ${x.head}`, ''] : []),
        x.text,
        '',
        ...(sup.length ? [`<details><summary>Sources for this section (${sup.length})</summary>`, '', ...sup.map((s) => `> ${md(s)}`), '', '</details>', ''] : []),
        ...(loose.length ? [`*Words not in its sources, check the meaning: ${loose.join(', ')}*`, ''] : []),
      ];
    }),
    '---',
    '',
    '**Stories this note connects**',
    '',
    ...ids.map((id) => (byId.get(id) ? `- [${md(byId.get(id).headline)}](${SITE}/story/${id}/)` : `- ${id} (not found)`)),
    '',
    ...(errors.length ? ['**Validation errors (fix before merging)**', '', ...errors.map((e) => `- ${e}`), ''] : []),
    goesLive,
    '',
    ...(note.suggestion ? [`**Optional personal touch:** ${md(note.suggestion)} The note publishes fine without it; tell Claude the line if you want it added before you merge.`] : []),
    '',
    'Reviewer: comment **APPROVED** to publish (a workflow merges within minutes), or **CHANGES** with numbered fixes (the desk revises at its next run). The owner can still merge or close this by hand.',
    `To edit first, change \`content/notes/${date}.json\` on this branch, then merge.`,
    '',
    '---',
    '',
    ...email,
    ...(email.length ? ['---', ''] : []),
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n'),
);
