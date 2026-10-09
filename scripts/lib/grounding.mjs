// Grounding: read a source page as plain text, and compare what a brief or note says
// (quotes, numbers) with the evidence and sources behind it. Used by validate.mjs
// (offline) and check-sources.mjs (fetches every source).
import { parseEntries } from './feeds.mjs';
import { cleanUrl, decodeEntities, p, readJSON, UA, urlKey } from './util.mjs';

// The form all text is compared in: straight quotes and dashes, one space, lowercase.
export function norm(s) {
  return decodeEntities(String(s ?? ''))
    .normalize('NFKC')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Readable text of an HTML page: scripts, styles and tags removed, entities decoded.
export function pageText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|figcaption)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

// The page itself, never a summary of it. Bot checks and script-only pages count as unreadable,
// and then the publisher's own feed is tried (see fromFeed).
export async function fetchSource(url, timeoutMs = 20_000) {
  const page = await readPage(url, timeoutMs);
  if (page.ok) return page;
  const feed = await fromFeed(url, timeoutMs);
  return feed ? { ok: true, via: 'feed', pageError: page.error, finalUrl: url, ...feed } : page;
}

async function readPage(url, timeoutMs) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    if (/pdf/i.test(res.headers.get('content-type') ?? '')) return { ok: false, error: 'PDF, not a web page' };
    const html = await res.text();
    const text = pageText(html);
    if (text.length < 400) return { ok: false, error: 'almost no readable text (bot check or script-only page)' };
    return { ok: true, text, finalUrl: res.url, published: publishedAt(html) };
  } catch (err) {
    return { ok: false, error: err.name === 'TimeoutError' ? 'timed out' : err.message };
  }
}

// When a page blocks the reader, its publisher's own feed (config/sources.json, same host) may
// still carry the entry: the title and summary the site publishes for machines to read. A bare
// title is not enough to brief from. Nothing here gets past a block: it is a different, public URL.
const feedEntries = new Map();
let feedsByHost;
async function fromFeed(url, timeoutMs) {
  const host = (u) => new URL(u).hostname.replace(/^www\./, '');
  const key = (u) => urlKey(cleanUrl(u) ?? u);
  if (!feedsByHost) {
    feedsByHost = new Map();
    for (const s of await readJSON(p('config', 'sources.json'), [])) {
      if (s.url && s.type !== 'googlenews') feedsByHost.set(host(s.url), [...(feedsByHost.get(host(s.url)) ?? []), s.url]);
    }
  }
  for (const feed of feedsByHost.get(host(url)) ?? []) {
    if (!feedEntries.has(feed))
      feedEntries.set(
        feed,
        fetch(feed, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) })
          .then((res) => (res.ok ? res.text() : ''))
          .then((xml) => (xml ? parseEntries(xml) : []))
          .catch(() => []),
      );
    const entry = (await feedEntries.get(feed)).find((e) => e.link && key(e.link) === key(url));
    if (!entry) continue;
    const body = pageText(entry.content || entry.summary || '');
    if (body.length < 80) return null;
    return { text: `${pageText(entry.title)}\n${body}`, published: Date.parse(entry.date) || null };
  }
  return null;
}

// When a page says it was published, in ms: its meta tags, then its structured data, then
// the first element styled as a date ("September 16, 2026"). Null when it does not say.
const DATE_KEYS = 'article:published_time|og:published_time|datepublished|pubdate|publish-date|dc\\.date(?:\\.issued)?|date';
const DATE_META = [
  new RegExp(`<meta[^>]+(?:property|name|itemprop)=["'](?:${DATE_KEYS})["'][^>]*content=["']([^"']+)["']`, 'i'),
  new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["'](?:${DATE_KEYS})["']`, 'i'),
  /"datePublished"\s*:\s*"([^"]+)"/,
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
// A date written out in text: "30 September 2026", "September 30, 2026" or "2026-09-30".
function dateInText(text) {
  let m = text.match(new RegExp(`\\b(\\d{1,2})\\s+${MON}\\s+((?:19|20)\\d\\d)\\b`, 'i'));
  if (m) return Date.UTC(Number(m[3]), MONTHS.indexOf(m[2].toLowerCase()), Number(m[1]));
  m = text.match(new RegExp(`\\b${MON}\\s+(\\d{1,2}),?\\s+((?:19|20)\\d\\d)\\b`, 'i'));
  if (m) return Date.UTC(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()), Number(m[2]));
  m = text.match(/\b((?:19|20)\d\d)-(\d{2})-(\d{2})/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
// When a page says it was published, in ms: its meta tags, then its structured data, then the
// first element styled as a date that holds one ("Published on 30 September 2026"), and only
// then a <time> tag, which on many sites belongs to a sidebar. Null when it does not say.
export function publishedAt(html) {
  const page = String(html);
  for (const re of DATE_META) {
    const raw = page.match(re)?.[1]?.trim() ?? '';
    const t = /\b(?:19|20)\d\d\b/.test(raw) ? Date.parse(raw) : NaN;
    if (t > Date.parse('2000-01-01')) return t;
  }
  for (const m of page.matchAll(/<[a-z]+[^>]+class=["'][^"']*(?:date|published|timestamp)[^"']*["'][^>]*>([\s\S]{0,200}?)<\/(?:div|span|p|time|li|small)>/gi)) {
    const t = dateInText(m[1].replace(/<[^>]+>/g, ' '));
    if (t) return t;
  }
  const time = page.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
  const t = time && /\b(?:19|20)\d\d\b/.test(time) ? Date.parse(time) : NaN;
  return t > Date.parse('2000-01-01') ? t : null;
}

// Words that report or connect without adding a fact, which a brief may use freely, plus
// the function words of five letters or more.
const GENERIC = new Set(
  `said saying says added adding announced announces announcing launched launches launching plans planned planning
  expects expected expecting reported reports reporting according including included includes nearly roughly almost
  already released releases cited cites warned warns warning noted notes stated states told telling called calls named
  using based across alongside amid despite although though unless whether without within toward towards instead rather
  another several latest recently earlier later itself themselves currently previously following follows follow makes
  taken gives given comes moved moves first second third total plus least every either neither other others about after
  again against along among around because before being below between could during their there these those through under
  until where which while would should since still whose shall might also into than then them they this that with were
  what when will your just only even more most less many much some such each both very really here today`.split(/\s+/),
);
const root = (w) => {
  const r = w.replace(/(?:ations?|ings?|ions?|ments?|ers?|ies|es|ed|ly|s)$/, '');
  return r.length >= 4 ? r : w;
};

// The words of a text that carry facts: five letters or more and not generic. Quoted words are
// left out, because quotes are checked word for word.
export function factWords(text) {
  const plain = norm(String(text ?? '').replace(/["“][^"“”]*["”]/g, ' '));
  const out = new Set();
  for (const raw of plain.replace(/[^a-z0-9'\- ]/g, ' ').split(/\s+/)) {
    const w = raw.replace(/^['-]+|['-]+$/g, '').replace(/'s$/, '');
    if (w.length >= 5 && /[a-z]/.test(w) && !GENERIC.has(w)) out.add(w);
  }
  return [...out];
}

// Fact words of `text` found in none of `refs`, compared by root ("violation" finds "violates");
// a hyphenated word passes when each long part is found.
export function untraced(text, refs) {
  const pool = norm(refs.join(' \n '));
  const found = (w) => pool.includes(root(w)) || (w.includes('-') && w.split('-').every((part) => part.length < 5 || pool.includes(root(part))));
  return factWords(text).filter((w) => !found(w));
}

// Capitalized words after the first word of a sentence: the names of people, firms, places and months.
const NOT_NAMES = new Set(['The', 'This', 'That', 'These', 'Those', 'It', 'Its', 'We', 'Our', 'And', 'But', 'So', 'Watch']);
export function namesIn(text) {
  const out = new Set();
  for (const sentence of String(text ?? '').split(/(?<=[.!?:;])\s+/))
    for (const tok of sentence.split(/\s+/).slice(1)) {
      const w = tok.replace(/^[^A-Za-z]+|[^A-Za-z0-9]+$/g, '').replace(/['’]s$/, '');
      if (/^[A-Z][a-z]{2,}/.test(w) && !NOT_NAMES.has(w)) out.add(w);
    }
  return [...out];
}

// Attribution. "X said ..." must not carry words the evidence gives only to someone else: the
// error behind "Shinhan said AI-assisted hackers" when the Korea Herald's sources said it.
const SAY = /^(?:said|says|told|added|noted|warned|expects|expected|reported|announced|estimated|estimates|wrote)$/;
const STOP_BACK = /^(?:and|but|while|so|that|which|who|as|because|whereas|than|if|when)$/;
const NEUTRAL = /^(?:he|she|they|it|we|i|you|this|that|these|those|the (?:bank|company|lender|firm|report|release|statement|filing|regulator|agency|group|paper|study|survey|article|story|source|sources?))$/;
const quietQuotes = (s) => String(s).replace(/["“][^"“”]*["”]/g, ' ');
// A sentence's clauses: split before ", and/but/while ..." and at semicolons.
const clausesOf = (sentence) => quietQuotes(sentence).split(/;\s*|,\s+(?=(?:and|but|while|whereas)\s)/);
// Who a clause says is talking: "according to X", or the words just before "said" (up to five,
// stopping at a comma or a joining word). Unknown when the subject is not right there.
export function speakersOf(clause) {
  const out = [];
  for (const m of String(clause).matchAll(/according to ([^,.;:]{2,60})/gi)) out.push(norm(m[1]));
  const words = String(clause).split(/\s+/);
  const abbreviation = (w) => /^(?:\(?[A-Z][a-z]{0,3}\.|(?:[A-Z]\.){2,})$/.test(w);
  const named = (w) => /^[A-Z(]/.test(w ?? '');
  words.forEach((w, i) => {
    if (!SAY.test(w.toLowerCase().replace(/[^a-z]/g, ''))) return;
    const who = [];
    // An appositive name right before the verb: "Verisk's head of claims, Tim Rayner, said".
    if (/,$/.test(words[i - 1] ?? '') && named(words[i - 1])) {
      for (let j = i - 1; j >= 0 && who.length < 4; j--) {
        if (j < i - 1 && /[,;:.!?]$/.test(words[j])) break;
        if (!named(words[j])) break;
        who.unshift(words[j].replace(/,$/, ''));
      }
      // Only between two commas: "claims, Tim Rayner, said", not "claims at Verisk, says".
      const before = words[i - 1 - who.length];
      if (who.length && /,$/.test(before ?? '')) {
        out.push(norm(who.join(' ')));
        return;
      }
      who.length = 0;
    }
    for (let j = i - 1; j >= 0 && who.length < 9; j--) {
      const raw = words[j];
      if (/[,;:]$/.test(raw) || (/[.!?]$/.test(raw) && !abbreviation(raw))) break;
      // "Josh Hawley (R-Mo.) and Chris Murphy announced": joint speakers, both named.
      if (raw.toLowerCase() === 'and' && who.length && named(who[0]) && named(words[j - 1])) {
        who.unshift(raw);
        continue;
      }
      if (STOP_BACK.test(raw.toLowerCase()) || (who.length >= 5 && !named(raw))) break;
      who.unshift(raw);
    }
    if (who.length) out.push(norm(who.join(' ').replace(/^(?:and|but|while|so)\s+/i, '')));
  });
  return out.filter(Boolean);
}
const speakerWords = (sp) => sp.split(/\s+/).map((w) => w.replace(/[^a-z0-9-]/g, '')).filter((w) => w.length >= 3 && !['the', 'and', 'its', 'his', 'her', 'who', 'that'].includes(w));
const sameSpeaker = (a, b) => speakerWords(a).some((w) => b.includes(w));
// The clauses of a text that say who is talking ("X said ..."), for checks stricter than prose.
export function attributedClauses(text) {
  return String(text ?? '')
    .split(/(?<=[.!?]["\u201D]?)\s+(?=[A-Z"\u201C])/)
    .flatMap(clausesOf)
    .filter((c) => speakersOf(c).some((sp) => !NEUTRAL.test(sp)));
}
const sentencesOf = (t) => String(t).split(/(?<=[.!?]["\u201D]?)\s+(?=[A-Z"\u201C])/);
// `owners[i]` names who published evidence[i] (a company's own release speaks for the company).
export function misattributed(text, evidence, owners = []) {
  const ev = evidence.flatMap((t, i) => sentencesOf(t).map((x, k) => ({ item: i, k, text: norm(x), speakers: clausesOf(x).flatMap(speakersOf), owner: norm(owners[i] ?? '') })));
  // Where in its evidence item a speaker is first named: words before that are the outlet's framing.
  const firstNamed = (x, m) => {
    const hit = ev.find((y) => y.item === x.item && speakerWords(m).some((sw) => y.text.includes(sw)));
    return hit ? hit.k : -1;
  };
  const out = [];
  for (const sentence of String(text ?? '').split(/(?<=[.!?]["”]?)\s+(?=[A-Z"“])/))
    for (const clause of clausesOf(sentence)) {
      const mine = speakersOf(clause).filter((sp) => !NEUTRAL.test(sp));
      if (!mine.length) continue;
      const claim = factWords(clause).filter((w) => !mine.some((sp) => sp.includes(w)));
      for (const w of claim) {
        const holders = ev.filter((x) => x.text.includes(root(w)));
        if (!holders.length) continue;
        const others = (x) => x.speakers.length && x.speakers.every((sp) => !NEUTRAL.test(sp) && !mine.some((m) => sameSpeaker(sp, m) || sameSpeaker(m, sp)));
        if (holders.every(others)) out.push({ sentence, word: w, speaker: mine[0], source: holders[0].speakers[0] });
        // The outlet says it in its own voice before it names the speaker at all: "Rayner said the
        // Hugging Face hack is driving the shift" when that came from the sentence before Rayner's.
        else if (holders.every((x) => !x.speakers.length && mine.every((m) => !speakerWords(m).some((sw) => x.owner.includes(sw)) && firstNamed(x, m) > x.k)))
          out.push({ sentence, word: w, speaker: mine[0], source: 'the outlet in its own voice' });
      }
    }
  return out;
}

// Words in double quotes, two words or more: "a closed loop", "unequivocally yes".
export function quotesIn(s) {
  return [...String(s ?? '').matchAll(/["“]([^"“”]{3,}?)["”]/g)]
    .map((m) => m[1].trim().replace(/[.,;:!?]+$/, ''))
    .filter((q) => /\s/.test(q));
}

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
// Numbers as digit strings ("9,920" -> "9920", "2.2%" -> "2.2"). Years and the day in a
// date ("September 29") are left out: they are checked by people, not pattern matching.
export function numbersIn(s) {
  const text = String(s ?? '')
    .replace(new RegExp(`\\b${MONTH}\\s+\\d{1,2}\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b\\d{1,2}\\s+${MONTH}`, 'gi'), ' ');
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => m[0].replace(/,(?=\d{3}(?!\d))/g, '').replace(/[.,]$/, ''))
    .filter((n) => !/^(19|20)\d\d$/.test(n));
}

// Every quote and number in `text` that the reference texts do not contain.
export function ungrounded(text, refs) {
  const hay = norm(refs.join(' \n '));
  const have = new Set(refs.flatMap(numbersIn));
  return {
    quotes: quotesIn(text).filter((q) => !hay.includes(norm(q))),
    numbers: [...new Set(numbersIn(text))].filter((n) => !have.has(n)),
  };
}

const STOP = new Set(
  'about after again against along among around because before being below between could during every first from have their there these those through under until where which while would should since still other others whose shall might about'.split(' '),
);
const stem = (w) => (w.length >= 7 ? w.slice(0, -2) : w);
const contentWords = (s) =>
  [...new Set(norm(s).replace(/[^a-z0-9$%' -]/g, ' ').split(/\s+/).map((w) => w.replace(/^'+|'+$/g, '')))].filter((w) => w.length >= 5 && !STOP.has(w));

// Sentences of `text` whose key words (five letters or more) are mostly missing from the
// evidence: a claim with nothing behind it, even when it is paraphrased.
export function unsupported(text, refs, share = 0.6) {
  const pool = norm(refs.join(' '));
  return String(text ?? '')
    .split(/(?<=[.!?]["\u201D]?)\s+(?=["\u201C]?[A-Z0-9])/)
    .filter((sentence) => {
      const words = contentWords(sentence);
      if (words.length < 4) return false;
      const found = words.filter((w) => pool.includes(stem(w))).length;
      return found / words.length < share;
    });
}


// Hardening: words of obligation or certainty the source does not use. "MAS expects firms to keep
// inventories" must not become "firms must keep inventories".
const HARD = /\b(must|required|requires|require|mandatory|mandates?|mandated|obliged|obligated|compels?|compelled|forced|forces|bans?|banned|prohibits?|prohibited|guarantees?|guaranteed|confirms?|confirmed|proves?|proved|proven)\b/gi;
export function hardened(text, refs) {
  const pool = norm(refs.join(' \n '));
  const found = new Set();
  for (const m of quietQuotes(text).matchAll(HARD)) {
    const w = m[1].toLowerCase();
    const same = w === 'must' ? /\b(?:must|ha(?:d|s|ve) to|needs? to|required)\b/ : null;
    if (!pool.includes(root(w)) && !pool.includes(w) && !(same && same.test(pool))) found.add(w);
  }
  return [...found];
}

// Links: words that make one fact the cause or consequence of another. The note may join facts,
// but a cause, a consequence or a "this means" needs a source that says so.
const LINK = /\b(which means|this means|that means|meaning that|because|as a result|which is why|that is why|that's why|so that|leads? to|led to|driven by|driving|drives|fuel(?:s|ed|ing)?|caus(?:e|es|ed|ing)|in response to|thanks to|due to)\b|(?:^|[.!?]\s+)(So)\b|,\s+(so)\s/g;
export function linked(text, refs) {
  const pool = norm(refs.join(' \n '));
  const found = new Set();
  for (const m of quietQuotes(text).matchAll(LINK)) {
    const w = (m[1] ?? m[2] ?? m[3]).toLowerCase();
    if (w === 'so' || !pool.includes(w)) found.add(w);
  }
  return [...found];
}

// A headline that states a reported number as settled: every evidence sentence that gives the
// number hedges it ("reportedly sought to raise $5 billion"), but the headline does not.
const HEDGE = /\b(reported(?:ly)?|reports?|sought|seeks?|plans?|planned|aims?|could|may|might|expects?|expected|estimates?|estimated|according to|people familiar|said to|up to|about|roughly|around|nearly|almost|approaching|proposed|considering|in talks)\b/i;
// In the headline only words that hedge the figure itself count: "its planned $5 billion IPO"
// still states the size as fact.
const HEAD_HEDGE = /\b((?:plans?|planning|aims?|intends?|wants?|hopes?|targets?) to|reported(?:ly)?|sought|seeks?|aims?|could|may|might|expects?|expected|estimates?|estimated|said to|up to|about|roughly|around|nearly|almost|approaching|as much as)\b/i;
export function unhedgedNumbers(headline, evidence) {
  if (HEAD_HEDGE.test(headline)) return [];
  const sentences = evidence.flatMap(sentencesOf);
  return numbersIn(headline).filter((n) => {
    const holders = sentences.filter((t) => numbersIn(t).includes(n));
    return holders.length && holders.every((t) => HEDGE.test(t));
  });
}

// The SEA Desk is for Southeast Asia: a brief filed there must name a place in it.
const SEA = /\b(UOB|DBS|OCBC|MAS|OJK|Bank Indonesia|BSP|BNM|Bank Negara|Maybank|CIMB|NSRC|Grab|GoTo|Gojek|Shopee|BCA|Bank Mandiri|BRI|Southeast Asia|South-?East Asia|ASEAN|Indonesia|Indonesian|Jakarta|Singapore|Singaporean|Malaysia|Malaysian|Kuala Lumpur|Philippines|Philippine|Filipino|Manila|Thailand|Thai|Bangkok|Vietnam|Vietnamese|Hanoi|Ho Chi Minh|Brunei|Cambodia|Laos|Myanmar|Timor)\b/;
export const namesSea = (text) => SEA.test(String(text ?? ''));

// A note that comments on the sources instead of the news ("the sources do not describe how it
// would work") makes a claim about the source that is easy to get wrong and adds nothing.
export const aboutSources = (text) => /\b(?:the |its |our )?(?:sources?|reports?|articles?|release|coverage)\s+(?:do|does|did)(?: not|n['’]t)\b/i.test(String(text ?? ''));
