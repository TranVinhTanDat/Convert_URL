import { parse } from 'node-html-parser';

const FETCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ConvertURL-Studio/1.0';

export interface ExtractedArticle {
  title: string;
  description: string;
  heroImage: string | null;
  body: string[];
  bodyImages: string[];
  publishedAt: string | null;
  author: string | null;
}

async function fetchHtml(url: string, timeoutMs = 20000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': FETCH_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi,en;q=0.8'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching article.`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function textOf(node: ReturnType<typeof parse> | ReturnType<ReturnType<typeof parse>['querySelector']>): string {
  if (!node) return '';
  return (node.text || '').replace(/\s+/g, ' ').trim();
}

function attrOf(node: ReturnType<ReturnType<typeof parse>['querySelector']>, attr: string): string | null {
  if (!node) return null;
  const value = node.getAttribute(attr);
  return value ? value.trim() : null;
}

function pickLargestImage(srcset: string | null): string | null {
  if (!srcset) return null;
  const candidates = srcset.split(',').map((part) => {
    const [url, size] = part.trim().split(/\s+/);
    const width = size && size.endsWith('w') ? parseInt(size, 10) : 0;
    return { url, width };
  });
  candidates.sort((a, b) => b.width - a.width);
  return candidates[0]?.url || null;
}

function normalizeImage(src: string | null, baseUrl: string): string | null {
  if (!src) return null;
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return null;
  }
}

export async function extractVnExpress(url: string): Promise<ExtractedArticle> {
  const html = await fetchHtml(url);
  const root = parse(html);

  // Title preference: og:title > meta title > h1
  const ogTitle = attrOf(root.querySelector('meta[property="og:title"]'), 'content');
  const h1 = textOf(root.querySelector('h1.title-detail, h1.title_news_detail, h1'));
  const title = ogTitle || h1 || '';

  // Description / lead paragraph
  const ogDesc = attrOf(root.querySelector('meta[property="og:description"]'), 'content');
  const lead = textOf(root.querySelector('p.description, .description, .lead_news_detail'));
  const description = ogDesc || lead || '';

  // Hero image: og:image (highest priority on VnExpress)
  const ogImage = attrOf(root.querySelector('meta[property="og:image"]'), 'content');
  const heroFromFig = root.querySelector('article .fig-picture img, .fig-picture img, figure img');
  const heroSrc = ogImage
    || attrOf(heroFromFig, 'data-src')
    || pickLargestImage(attrOf(heroFromFig, 'data-srcset') || attrOf(heroFromFig, 'srcset'))
    || attrOf(heroFromFig, 'src');
  const heroImage = normalizeImage(heroSrc, url);

  // Published time
  const publishedAt = attrOf(root.querySelector('meta[itemprop="datePublished"]'), 'content')
    || attrOf(root.querySelector('meta[property="article:published_time"]'), 'content');

  // Author
  const author = textOf(root.querySelector('.author_mail strong, p.author_mail strong, strong.author, .Author-info p'));

  // Body paragraphs — VnExpress uses article.fck_detail or div.fck_detail
  const articleRoot = root.querySelector('article.fck_detail, div.fck_detail, article[itemprop="articleBody"]');
  const body: string[] = [];
  const bodyImages: string[] = [];

  if (articleRoot) {
    for (const paragraph of articleRoot.querySelectorAll('p.Normal, p')) {
      const text = textOf(paragraph);
      if (text && text.length > 8 && !/^Theo (báo|nguồn)/i.test(text)) {
        body.push(text);
      }
    }
    for (const figure of articleRoot.querySelectorAll('figure, .fig-picture')) {
      const img = figure.querySelector('img');
      if (!img) continue;
      const src = attrOf(img, 'data-src')
        || pickLargestImage(attrOf(img, 'data-srcset') || attrOf(img, 'srcset'))
        || attrOf(img, 'src');
      const normalized = normalizeImage(src, url);
      if (normalized && !bodyImages.includes(normalized)) {
        bodyImages.push(normalized);
      }
    }
  }

  // Fallback: pull paragraphs from anywhere if structured parsing failed
  if (body.length === 0) {
    for (const paragraph of root.querySelectorAll('p')) {
      const text = textOf(paragraph);
      if (text && text.length > 40 && text.length < 1200) {
        body.push(text);
        if (body.length >= 12) break;
      }
    }
  }

  return {
    title,
    description,
    heroImage,
    body,
    bodyImages,
    publishedAt: publishedAt || null,
    author: author || null
  };
}
