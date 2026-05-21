import fs from 'node:fs';
import path from 'node:path';

export type ArticleStatus =
  | 'discovered'
  | 'extracting'
  | 'extract_failed'
  | 'script_ready'
  | 'generating'
  | 'ready'
  | 'approved'
  | 'rejected';

export interface NewsArticle {
  id: string;
  source: string;
  sourceUrl: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  fetchedAt: string;
  updatedAt: string;
  heroImage: string | null;
  category: string | null;
  body: string[];
  bodyImages: string[];
  script: string | null;
  videoFile: string | null;
  audioFile: string | null;
  voiceLabel: string | null;
  status: ArticleStatus;
  error: string | null;
}

export interface NewsState {
  version: 1;
  articles: NewsArticle[];
  lastRefreshAt: string | null;
}

const VERSION: NewsState['version'] = 1;

function emptyState(): NewsState {
  return { version: VERSION, articles: [], lastRefreshAt: null };
}

export class NewsStore {
  private state: NewsState = emptyState();
  private writeQueued = false;

  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.load();
  }

  private load() {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as NewsState;
      if (parsed && parsed.version === VERSION && Array.isArray(parsed.articles)) {
        this.state = parsed;
      }
    } catch {
      // corrupted file — keep empty state, will overwrite on next save
    }
  }

  private scheduleWrite() {
    if (this.writeQueued) return;
    this.writeQueued = true;
    setImmediate(() => {
      this.writeQueued = false;
      const tmp = `${this.filePath}.tmp`;
      try {
        fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
        fs.renameSync(tmp, this.filePath);
      } catch {
        // best-effort persistence
      }
    });
  }

  getAll(): NewsArticle[] {
    return [...this.state.articles].sort((a, b) => {
      const t1 = Date.parse(b.publishedAt) || 0;
      const t2 = Date.parse(a.publishedAt) || 0;
      return t1 - t2;
    });
  }

  get(id: string): NewsArticle | undefined {
    return this.state.articles.find((article) => article.id === id);
  }

  getLastRefreshAt(): string | null {
    return this.state.lastRefreshAt;
  }

  setLastRefreshAt(date: string) {
    this.state.lastRefreshAt = date;
    this.scheduleWrite();
  }

  upsert(article: NewsArticle): NewsArticle {
    const index = this.state.articles.findIndex((item) => item.id === article.id);
    if (index >= 0) {
      // merge preserving user edits (script, status, videoFile)
      const existing = this.state.articles[index];
      const merged: NewsArticle = {
        ...existing,
        title: article.title || existing.title,
        excerpt: article.excerpt || existing.excerpt,
        publishedAt: article.publishedAt || existing.publishedAt,
        heroImage: article.heroImage || existing.heroImage,
        category: article.category || existing.category,
        body: article.body.length ? article.body : existing.body,
        bodyImages: article.bodyImages.length ? article.bodyImages : existing.bodyImages,
        updatedAt: new Date().toISOString()
      };
      this.state.articles[index] = merged;
      this.scheduleWrite();
      return merged;
    }
    this.state.articles.push(article);
    // cap to last 200 articles to avoid unbounded growth
    if (this.state.articles.length > 200) {
      this.state.articles.sort((a, b) => Date.parse(b.publishedAt || b.fetchedAt) - Date.parse(a.publishedAt || a.fetchedAt));
      this.state.articles = this.state.articles.slice(0, 200);
    }
    this.scheduleWrite();
    return article;
  }

  update(id: string, patch: Partial<NewsArticle>): NewsArticle | null {
    const index = this.state.articles.findIndex((article) => article.id === id);
    if (index < 0) return null;
    const next: NewsArticle = {
      ...this.state.articles[index],
      ...patch,
      id,
      updatedAt: new Date().toISOString()
    };
    this.state.articles[index] = next;
    this.scheduleWrite();
    return next;
  }

  remove(id: string): boolean {
    const next = this.state.articles.filter((article) => article.id !== id);
    if (next.length === this.state.articles.length) return false;
    this.state.articles = next;
    this.scheduleWrite();
    return true;
  }
}

let singleton: NewsStore | null = null;

export function getNewsStore(filePath: string): NewsStore {
  if (!singleton) singleton = new NewsStore(filePath);
  return singleton;
}
