// Delayed quotes for the ticker strip, from free public quote endpoints (no key).
// CNBC covers US names and SGX; Jakarta names only come through when Yahoo
// isn't rate-limiting. A symbol that fails keeps its last quote for 24h, marked stale.
import { UA, fetchJSON, p, readJSON, writeJSON } from './lib/util.mjs';

const tickers = await readJSON(p('config', 'tickers.json'));
const previous =
  (process.env.TICKER_STATE_URL && (await fetchJSON(process.env.TICKER_STATE_URL))) ||
  (await readJSON(p('data', 'ticker.json'), { quotes: [] }));
const prevByLabel = new Map((previous.quotes ?? []).map((q) => [q.label, q]));
const num = (s) => Number(String(s ?? '').replace(/[,%+]/g, ''));

async function fromCnbc(list) {
  const symbols = list.map((t) => t.cnbc).join('|');
  const url =
    'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?' +
    new URLSearchParams({ symbols, requestMethod: 'itv', noform: '1', partnerId: '2', fund: '1', exthrs: '1', output: 'json' });
  const data = await fetchJSON(url);
  const rows = data?.FormattedQuoteResult?.FormattedQuote ?? [];
  const out = new Map();
  for (const r of rows) {
    const t = list.find((x) => x.cnbc === r.symbol);
    const price = num(r.last);
    if (!t || r.code !== 0 || !Number.isFinite(price)) continue;
    const changePct = r.change_pct === 'UNCH' ? 0 : num(r.change_pct);
    out.set(t.label, { label: t.label, price, changePct: Number.isFinite(changePct) ? changePct : 0, currency: r.currencyCode });
  }
  return out;
}

async function fromYahoo(t) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t.yahoo)}?range=1d&interval=15m`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) return null;
    const meta = (await res.json())?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    const prev = meta?.chartPreviousClose ?? meta?.previousClose;
    if (!Number.isFinite(price) || !Number.isFinite(prev) || !prev) return null;
    return { label: t.label, price, changePct: ((price - prev) / prev) * 100, currency: meta.currency };
  } catch {
    return null;
  }
}

const now = Date.now();
const live = await fromCnbc(tickers.filter((t) => t.cnbc));
for (const t of tickers.filter((t) => t.yahoo && !live.has(t.label))) {
  const q = await fromYahoo(t);
  if (q) live.set(t.label, q);
}

const quotes = [];
for (const t of tickers) {
  const q = live.get(t.label);
  if (q) {
    quotes.push({ ...q, decimals: t.decimals ?? 2, asOf: new Date(now).toISOString() });
    continue;
  }
  const last = prevByLabel.get(t.label);
  if (last && now - Date.parse(last.asOf) < 24 * 3600_000) quotes.push({ ...last, stale: true });
}

await writeJSON(p('data', 'ticker.json'), { updatedAt: new Date(now).toISOString(), quotes });
const missing = tickers.filter((t) => !quotes.some((q) => q.label === t.label)).map((t) => t.label);
console.log(`ticker: ${live.size}/${tickers.length} live${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
