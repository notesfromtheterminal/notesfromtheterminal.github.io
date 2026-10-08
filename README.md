# Notes from the Terminal

AI in finance. A live news site with a Southeast Asia desk, run by [@0xNotMarc](https://x.com/0xNotMarc).

## How it works

The site has two layers, and neither one pays per story.

| Layer | What it does | Runs | Cost |
|---|---|---|---|
| **The wire** | Pulls headlines from about 30 feeds, filters for AI in finance, tags sections, merges duplicates, fetches delayed quotes | GitHub Actions, every 5 min | Free on a public repo |
| **The desk** | Reads the wire, verifies the stories that matter and writes short briefs; the morning run also drafts the Morning Note | A scheduled routine, five runs a day | Included in the owner's existing plan |

Briefs publish on their own. The Morning Note never does: the desk pushes it to its own branch, a workflow opens a pull request with the full text, and merging that pull request is the approval.

The site itself is static HTML on GitHub Pages. A small script in the page refreshes the clock, the wire rail and a "new stories" prompt without a reload.

## Layout

```
config/      site.json, sources.json (feeds), sections.json (tagging rules), tickers.json, publishers.json
content/     briefs/YYYY-MM-DD/*.json and notes/YYYY-MM-DD.json, written by the desk
scripts/     fetch-wire, desk-digest, fetch-ticker, validate, build, serve
src/         templates.mjs, site.css, app.js
public/      favicon, share card (og.png)
NEWSROOM.md  the desk's operating manual (read it before writing a brief)
```

## Run it locally

```bash
npm ci
npm run refresh   # wire + ticker + build
npm run serve     # http://localhost:4321
```

`npm run validate` checks every brief and note against the schema and house style.

## Deploy

1. Push this repo to GitHub (public, so Actions and Pages are free).
2. Settings → Pages → Source: **GitHub Actions**.
3. Settings → Actions → General → Workflow permissions: tick **Allow GitHub Actions to create and approve pull requests** (the Morning Note approval flow needs it).
4. The `Update site` workflow runs on every push and every 5 minutes.

The site runs on its custom domain, [notesfromtheterminal.com](https://notesfromtheterminal.com), set under Settings → Pages. The build reads `SITE_URL` and `BASE_PATH` from the Pages configuration, so links follow automatically.

## Notes

- Delayed quotes come from free public endpoints. Jakarta-listed names show up only when Yahoo isn't rate-limiting, and a missing quote simply drops out of the strip.
- Google News results only reach the public wire when the publisher is on the trusted list in `config/publishers.json`.
- Nothing on the site is investment advice.
