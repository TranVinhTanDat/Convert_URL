import { createHash } from 'node:crypto';
import RssParser from 'rss-parser';

export interface FeedItem {
  source: string;
  sourceUrl: string;
  title: string;
  link: string;
  excerpt: string;
  publishedAt: string;
  category: string | null;
  heroImage: string | null;
  guid: string;
}

interface VnExpressFeed {
  slug: string;
  name: string;
  url: string;
}

const VNEXPRESS_FEEDS: VnExpressFeed[] = [
  { slug: 'home', name: 'Trang chủ', url: 'https://vnexpress.net/rss/tin-moi-nhat.rss' },
  { slug: 'thoi-su', name: 'Thời sự', url: 'https://vnexpress.net/rss/thoi-su.rss' },
  { slug: 'kinh-doanh', name: 'Kinh doanh', url: 'https://vnexpress.net/rss/kinh-doanh.rss' },
  { slug: 'the-thao', name: 'Thể thao', url: 'https://vnexpress.net/rss/the-thao.rss' },
  { slug: 'giai-tri', name: 'Giải trí', url: 'https://vnexpress.net/rss/giai-tri.rss' },
  { slug: 'phap-luat', name: 'Pháp luật', url: 'https://vnexpress.net/rss/phap-luat.rss' },
  { slug: 'giao-duc', name: 'Giáo dục', url: 'https://vnexpress.net/rss/giao-duc.rss' },
  { slug: 'suc-khoe', name: 'Sức khỏe', url: 'https://vnexpress.net/rss/suc-khoe.rss' },
  { slug: 'the-gioi', name: 'Thế giới', url: 'https://vnexpress.net/rss/the-gioi.rss' },
  { slug: 'so-hoa', name: 'Số hóa', url: 'https://vnexpress.net/rss/so-hoa.rss' }
];

const VNEXPRESS_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ConvertURL-Studio/1.0';

interface VnExpressRssItem {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  isoDate?: string;
  enclosure?: { url?: string };
}

interface VnExpressRssFeed {
  items?: VnExpressRssItem[];
}

const parser: RssParser<VnExpressRssFeed, VnExpressRssItem> = new RssParser({
  timeout: 15000,
  headers: { 'User-Agent': VNEXPRESS_USER_AGENT }
});

function hashId(link: string): string {
  return createHash('sha1').update(link).digest('hex').slice(0, 16);
}

function extractFirstImageFromHtml(html: string | undefined): string | null {
  if (!html) return null;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function stripHtml(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFeedItem(feed: VnExpressFeed, item: VnExpressRssItem): FeedItem | null {
  const link = (item.link || item.guid || '').trim();
  if (!link || !/^https?:\/\//.test(link)) return null;
  const title = (item.title || '').trim();
  if (!title) return null;

  return {
    source: 'VnExpress',
    sourceUrl: link,
    title,
    link,
    excerpt: stripHtml(item.contentSnippet || item.content).slice(0, 400),
    publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
    category: feed.name,
    heroImage: item.enclosure?.url || extractFirstImageFromHtml(item.content),
    guid: hashId(link)
  };
}

async function fetchFeed(feed: VnExpressFeed): Promise<FeedItem[]> {
  try {
    const parsed = await parser.parseURL(feed.url);
    if (!parsed.items) return [];
    return parsed.items
      .map((item) => buildFeedItem(feed, item))
      .filter((entry): entry is FeedItem => entry !== null);
  } catch {
    return [];
  }
}

export async function fetchVnExpressHot(maxPerCategory = 6): Promise<FeedItem[]> {
  const all = await Promise.all(VNEXPRESS_FEEDS.map(async (feed) => {
    const items = await fetchFeed(feed);
    return items.slice(0, maxPerCategory);
  }));

  const dedup = new Map<string, FeedItem>();
  for (const items of all) {
    for (const item of items) {
      const existing = dedup.get(item.guid);
      if (!existing) {
        dedup.set(item.guid, item);
        continue;
      }
      // Prefer entry with hero image
      if (!existing.heroImage && item.heroImage) {
        dedup.set(item.guid, item);
      }
    }
  }

  return Array.from(dedup.values()).sort((a, b) => {
    return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  });
}
