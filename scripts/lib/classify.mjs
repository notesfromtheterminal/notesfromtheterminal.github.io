// Rule-based tagging for the free wire. Precision only needs to be "good
// enough": the Claude newsroom run does the real editorial selection.

function termToPattern(term) {
  if (term.startsWith('re:')) return { src: term.slice(3), caseSensitive: false };
  // "cs:" forces case-sensitive matching for brand names that are also common words (Grab, Visa, Fed).
  const forced = term.startsWith('cs:');
  if (forced) term = term.slice(3);
  const star = term.endsWith('*');
  const bare = star ? term.slice(0, -1) : term;
  const body = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + (star ? '[\\w-]*' : '');
  // All-caps acronyms (SEC, OJK, MAS, AI) match case-sensitively so "sec" or "mas" don't.
  const caseSensitive = forced || (/^[A-Z0-9&.'-]{2,}$/.test(bare) && /[A-Z]/.test(bare));
  return { src: `(?<![\\w])${body}(?![\\w])`, caseSensitive };
}

export function compileTerms(terms = []) {
  const cs = [];
  const ci = [];
  for (const t of terms) {
    const { src, caseSensitive } = termToPattern(t);
    (caseSensitive ? cs : ci).push(src);
  }
  const res = [];
  if (cs.length) res.push(new RegExp(cs.join('|')));
  if (ci.length) res.push(new RegExp(ci.join('|'), 'i'));
  return (text) => res.some((re) => re.test(text));
}

export function makeClassifier(cfg) {
  const isAI = compileTerms(cfg.aiTerms);
  const isSEA = compileTerms(cfg.seaTerms);
  const isNoise = compileTerms(cfg.excludeTerms);
  const matchers = Object.fromEntries(cfg.sections.map((s) => [s.id, compileTerms(s.terms)]));
  const topical = cfg.priority.filter((id) => id !== 'sea' && id !== 'models');

  return function classify({ title, summary = '' }, source) {
    const text = `${title} ${summary}`;
    if (isNoise(title)) return { keep: false, reason: 'noise' };

    const aiNative = source.kind === 'ai' || source.kind === 'lab';
    const ai = isAI(text);
    if (source.requireAI && !ai) return { keep: false, reason: 'not-ai' };

    // Only SEA-only outlets are SEA by default; everyone else has to mention the region.
    const sea = source.seaOnly === true || isSEA(title) || isSEA(summary);
    const tags = [];
    if (sea) tags.push('sea');
    for (const id of topical) if (matchers[id](text)) tags.push(id);
    if (aiNative || matchers.models(title)) tags.push('models');

    // The title decides the primary section. Finance outlets write terse titles, so
    // their summary may break the tie; AI outlets' summaries are too noisy for that.
    let section = sea
      ? 'sea'
      : topical.find((id) => matchers[id](title)) ??
        (source.kind === 'finance' ? topical.find((id) => matchers[id](summary)) : undefined);
    if (!section) section = 'models';
    return { keep: true, section, tags: [...new Set(tags)], ai: ai || aiNative };
  };
}
