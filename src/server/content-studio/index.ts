import { extractVnExpress } from './extractor.js';
import { fetchVnExpressHot, FeedItem } from './sources.js';
import { getNewsStore, NewsArticle, NewsStore } from './storage.js';

export type { NewsArticle, NewsStore, ArticleStatus } from './storage.js';

let refreshInFlight: Promise<{ added: number; updated: number; total: number }> | null = null;
const enrichmentInFlight = new Set<string>();

function freshArticle(item: FeedItem): NewsArticle {
  const now = new Date().toISOString();
  return {
    id: item.guid,
    source: item.source,
    sourceUrl: item.sourceUrl,
    title: item.title,
    excerpt: item.excerpt,
    publishedAt: item.publishedAt,
    fetchedAt: now,
    updatedAt: now,
    heroImage: item.heroImage,
    category: item.category,
    body: [],
    bodyImages: [],
    script: null,
    videoFile: null,
    audioFile: null,
    voiceLabel: null,
    status: 'discovered',
    error: null
  };
}

async function enrichArticle(store: NewsStore, article: NewsArticle): Promise<void> {
  if (enrichmentInFlight.has(article.id)) return;
  enrichmentInFlight.add(article.id);
  store.update(article.id, { status: 'extracting', error: null });

  try {
    const extracted = await extractVnExpress(article.sourceUrl);
    store.update(article.id, {
      title: extracted.title || article.title,
      excerpt: extracted.description || article.excerpt,
      heroImage: extracted.heroImage || article.heroImage,
      body: extracted.body,
      bodyImages: extracted.bodyImages,
      status: extracted.body.length ? 'script_ready' : 'extract_failed',
      error: extracted.body.length ? null : 'Không lấy được nội dung bài viết.'
    });
  } catch (error) {
    store.update(article.id, {
      status: 'extract_failed',
      error: error instanceof Error ? error.message : 'Trích xuất bài viết thất bại.'
    });
  } finally {
    enrichmentInFlight.delete(article.id);
  }
}

export async function refreshNewsFeed(store: NewsStore): Promise<{ added: number; updated: number; total: number }> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const items = await fetchVnExpressHot(8);
    let added = 0;
    let updated = 0;

    for (const item of items) {
      const existing = store.get(item.guid);
      if (existing) {
        store.upsert({
          ...existing,
          title: item.title || existing.title,
          excerpt: item.excerpt || existing.excerpt,
          publishedAt: item.publishedAt || existing.publishedAt,
          heroImage: existing.heroImage || item.heroImage,
          category: item.category || existing.category,
          body: existing.body,
          bodyImages: existing.bodyImages,
          updatedAt: new Date().toISOString()
        });
        updated += 1;
      } else {
        store.upsert(freshArticle(item));
        added += 1;
      }
    }

    store.setLastRefreshAt(new Date().toISOString());

    // Enrich freshly discovered articles in background, max 4 concurrent
    const toEnrich = store.getAll().filter((article) => article.status === 'discovered').slice(0, 12);
    for (const article of toEnrich) {
      void enrichArticle(store, article);
    }

    return { added, updated, total: items.length };
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function reenrichArticle(store: NewsStore, articleId: string): Promise<NewsArticle | null> {
  const article = store.get(articleId);
  if (!article) return null;
  await enrichArticle(store, article);
  return store.get(articleId) || null;
}

export function publicArticle(article: NewsArticle) {
  return {
    id: article.id,
    source: article.source,
    sourceUrl: article.sourceUrl,
    title: article.title,
    excerpt: article.excerpt,
    publishedAt: article.publishedAt,
    fetchedAt: article.fetchedAt,
    updatedAt: article.updatedAt,
    heroImage: article.heroImage,
    category: article.category,
    bodyParagraphs: article.body.length,
    body: article.body,
    bodyImages: article.bodyImages,
    script: article.script,
    videoFile: article.videoFile,
    audioFile: article.audioFile,
    voiceLabel: article.voiceLabel,
    status: article.status,
    error: article.error
  };
}

export { getNewsStore };
