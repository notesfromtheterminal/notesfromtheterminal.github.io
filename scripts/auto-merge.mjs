// Merges a Morning Note pull request once the reviewer has approved it, so the note publishes
// without the owner merging by hand. The reviewer (the owner's Grok bot, an org member) only
// comments; this script, run by the workflow with its own token, does the merge. All required:
//   - the branch is claude/note-YYYY-MM-DD and the PR changes only content/notes/YYYY-MM-DD.json
//   - the latest verdict comment ("APPROVED ..." or "CHANGES ...") from an owner, member,
//     collaborator or a reviewer named in config/site.json is APPROVED, and it was posted after the branch's last commit
//   - every check on the head commit passed (skipped checks are fine)
//   node scripts/auto-merge.mjs [--dry-run]
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { p, readJSON } from './lib/util.mjs';

const repo = process.env.GITHUB_REPOSITORY || 'notesfromtheterminal/notesfromtheterminal.github.io';
const dry = process.argv.includes('--dry-run');
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const ghJson = (args) => {
  try {
    return JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
  } catch (err) {
    // gh exits non-zero while checks are pending or failing; its JSON is still on stdout.
    if (err.stdout) return JSON.parse(err.stdout.toString() || '[]');
    throw err;
  }
};

// A verdict is a comment that starts with APPROVED or CHANGES, from someone the repo trusts.
export function verdictOf(pr, reviewers = new Set()) {
  const last = Math.max(...pr.commits.map((c) => Date.parse(c.committedDate)));
  const verdicts = pr.comments
    .filter((c) => (TRUSTED.has(c.authorAssociation) || reviewers.has(c.author.login.toLowerCase())) && /^\s*(APPROVED|CHANGES)\b/.test(c.body) && Date.parse(c.createdAt) > last)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const latest = verdicts.at(-1);
  return latest ? { word: latest.body.trim().split(/\s/)[0].replace(/\W+$/, ''), by: latest.author.login } : null;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const site = await readJSON(p('config', 'site.json'));
  const prs = ghJson(['pr', 'list', '--repo', repo, '--state', 'open', '--json', 'number,headRefName,headRefOid,files,commits,comments']);
  const notes = prs.filter((pr) => /^claude\/note-\d{4}-\d{2}-\d{2}$/.test(pr.headRefName));
  if (!notes.length) console.log('auto-merge: no open Morning Note pull request');
  for (const pr of notes) {
    const date = pr.headRefName.slice('claude/note-'.length);
    const files = pr.files.map((f) => f.path);
    if (files.length !== 1 || files[0] !== `content/notes/${date}.json`) {
      console.log(`auto-merge: #${pr.number} changes more than the note (${files.join(', ')}); left for the owner`);
      continue;
    }
    const verdict = verdictOf(pr, new Set((site.reviewers ?? []).map((x) => x.toLowerCase())));
    if (verdict?.word !== 'APPROVED') {
      console.log(`auto-merge: #${pr.number} ${verdict ? `has ${verdict.word} from ${verdict.by}` : 'has no verdict since its last commit'}`);
      continue;
    }
    const checks = ghJson(['pr', 'checks', String(pr.number), '--repo', repo, '--json', 'name,state']);
    const open = checks.filter((c) => !['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(c.state));
    if (!checks.length || open.length) {
      console.log(`auto-merge: #${pr.number} approved, but checks are not all green (${open.map((c) => `${c.name}: ${c.state}`).join(', ') || 'none reported yet'})`);
      continue;
    }
    if (dry) {
      console.log(`auto-merge: #${pr.number} would merge (approved by ${verdict.by})`);
      continue;
    }
    execFileSync('gh', ['pr', 'merge', String(pr.number), '--repo', repo, '--merge', '--match-head-commit', pr.headRefOid], { stdio: 'inherit' });
    console.log(`auto-merge: #${pr.number} merged, approved by ${verdict.by}${site.newsletterLive ? '; the reviewer schedules the email' : ''}`);
  }
}
