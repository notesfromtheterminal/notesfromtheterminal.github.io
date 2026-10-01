// Feed parsing shared by the wire (fetch-wire.mjs) and the page reader's feed fallback
// (grounding.mjs): RSS, Atom and RDF entries as {title, link, date, summary, publisher}.
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => name === 'item' || name === 'entry',
});

const text = (v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return text(v['#text'] ?? '');
  return String(v);
};

function atomLink(link) {
  const links = Array.isArray(link) ? link : [link];
  const pick = links.find((l) => l && (!l['@_rel'] || l['@_rel'] === 'alternate')) ?? links[0];
  return typeof pick === 'string' ? pick : pick?.['@_href'];
}

function rssLink(it) {
  const link = text(it.link);
  if (link) return link;
  const guid = text(it.guid);
  return /^https?:\/\//.test(guid) ? guid : '';
}

export function parseEntries(xml) {
  const doc = parser.parse(xml);
  if (doc.rss?.channel) {
    const ch = Array.isArray(doc.rss.channel) ? doc.rss.channel[0] : doc.rss.channel;
    return (ch.item ?? []).map((it) => ({
      title: text(it.title),
      link: rssLink(it),
      date: text(it.pubDate) || text(it['dc:date']) || text(it.published) || text(it.updated),
      summary: text(it.description) || text(it['content:encoded']),
      content: text(it['content:encoded']),
      publisher: text(it.source),
    }));
  }
  if (doc.feed) {
    return (doc.feed.entry ?? []).map((e) => ({
      title: text(e.title),
      link: atomLink(e.link),
      date: text(e.published) || text(e.updated),
      summary: text(e.summary) || text(e.content),
      content: text(e.content),
    }));
  }
  const rdf = doc['rdf:RDF'];
  if (rdf) {
    return (rdf.item ?? []).map((it) => ({
      title: text(it.title),
      link: text(it.link),
      date: text(it['dc:date']),
      summary: text(it.description),
    }));
  }
  throw new Error('not an RSS/Atom feed');
}
