import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface TranscriptSegment {
  index: number;
  startSeconds: number;
  endSeconds: number;
  startLabel: string;
  endLabel: string;
  text: string;
}

export type ContentType = 'music' | 'talk' | 'tutorial' | 'news' | 'vlog' | 'gaming' | 'short' | 'video';

export interface VideoMeta {
  title: string;
  duration: number;
  durationLabel: string;
  uploader: string | null;
  channel: string | null;
  uploadDate: string | null;
  thumbnail: string | null;
  webpageUrl: string;
  viewCount: number | null;
  host: string;
  contentType: ContentType;
  contentTypeLabel: string;
  categories: string[];
}

export interface TranscriptResult {
  video: VideoMeta;
  language: string;
  languageLabel: string;
  source: 'manual' | 'auto' | 'whisper' | 'none';
  hasSubtitles: boolean;
  availableLanguages: Array<{ code: string; label: string; auto: boolean }>;
  segments: TranscriptSegment[];
  qualityWarning: string | null;
  plainText: string;
  paragraphsMarkdown: string;
  srt: string;
  vtt: string;
  message?: string;
  warning?: string;
}

const LANGUAGE_LABELS: Record<string, string> = {
  vi: 'Tiếng Việt',
  en: 'Tiếng Anh',
  ja: 'Tiếng Nhật',
  ko: 'Tiếng Hàn',
  zh: 'Tiếng Trung',
  fr: 'Tiếng Pháp',
  es: 'Tiếng Tây Ban Nha',
  de: 'Tiếng Đức',
  ru: 'Tiếng Nga',
  th: 'Tiếng Thái'
};

export function languageLabel(code: string): string {
  if (!code) return 'Không rõ';
  const base = code.toLowerCase().split('-')[0];
  return LANGUAGE_LABELS[base] || code.toUpperCase();
}

export function secondsToTimecode(totalSeconds: number, separator: '.' | ',' = '.'): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const ms = Math.round((totalSeconds % 1) * 1000);
  const total = Math.floor(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(ms).padStart(3, '0')}`;
}

export function secondsToShort(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const total = Math.floor(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function timecodeToSeconds(code: string): number {
  const cleaned = code.trim().replace(',', '.');
  // Raw seconds (faster-whisper-cli): "0.00" or "5.43"
  if (/^\d+(\.\d+)?$/.test(cleaned)) {
    return Number(cleaned);
  }
  // HH:MM:SS(.mmm)
  const hms = cleaned.match(/^(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/);
  if (hms) {
    const [, h, m, s, ms] = hms;
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + (ms ? Number(`0.${ms.padEnd(3, '0').slice(0, 3)}`) : 0);
  }
  // MM:SS(.mmm)
  const ms = cleaned.match(/^(\d+):(\d{1,2})(?:\.(\d+))?$/);
  if (ms) {
    const [, m, s, frac] = ms;
    return Number(m) * 60 + Number(s) + (frac ? Number(`0.${frac.padEnd(3, '0').slice(0, 3)}`) : 0);
  }
  return 0;
}

function cleanCueText(raw: string): string {
  return raw
    .replace(/<c[.\w-]*>/g, '')
    .replace(/<\/c>/g, '')
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseVtt(vtt: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  if (!vtt) return segments;

  const normalized = vtt.replace(/\r\n/g, '\n');
  const blocks = normalized.split(/\n\n+/);
  let lastText = '';

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim().length > 0);
    if (!lines.length) continue;
    const timingIndex = lines.findIndex((line) => /-->/.test(line));
    if (timingIndex < 0) continue;
    const timingLine = lines[timingIndex];
    const match = timingLine.match(/(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3}|\d+(?:\.\d+)?)\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3}|\d+(?:\.\d+)?)/);
    if (!match) continue;

    const start = timecodeToSeconds(match[1]);
    const end = timecodeToSeconds(match[2]);

    // YouTube karaoke-style cues have 2+ text lines:
    //   line A: previous-cue text still visible (rolling, plain text, NO <c> tags)
    //   line B: the NEW words being sung with word-level timing (<c> tags)
    // We only want the NEW words → keep only lines containing word-timing markers.
    const cueLines = lines.slice(timingIndex + 1);
    const taggedLines = cueLines.filter((line) => /<\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}>/.test(line) || /<c[.\s>]/.test(line));
    const useLines = taggedLines.length > 0 ? taggedLines : cueLines;
    const textRaw = useLines.join(' ');
    const text = cleanCueText(textRaw);
    if (!text) continue;
    if (text === lastText) continue; // dedupe YouTube auto-sub stutter
    lastText = text;
    segments.push({
      index: segments.length + 1,
      startSeconds: start,
      endSeconds: end,
      startLabel: secondsToShort(start),
      endLabel: secondsToShort(end),
      text
    });
  }

  // Second pass: merge cues with same start time (YouTube auto-sub progressive cues)
  const sameStartMerged: TranscriptSegment[] = [];
  for (const segment of segments) {
    const last = sameStartMerged[sameStartMerged.length - 1];
    if (last && Math.abs(last.startSeconds - segment.startSeconds) < 0.05) {
      if (segment.text.length > last.text.length) {
        last.text = segment.text;
        last.endSeconds = Math.max(last.endSeconds, segment.endSeconds);
        last.endLabel = secondsToShort(last.endSeconds);
      }
      continue;
    }
    sameStartMerged.push({ ...segment, index: sameStartMerged.length + 1 });
  }

  // Third pass: word-overlap dedup for "rolling captions" (common in YouTube auto-sub for music)
  // Each new cue often repeats the tail of the previous + adds new words.
  // We trim out the overlap so only the NEW words remain.
  const dedupRolling = (input: TranscriptSegment[]): TranscriptSegment[] => {
    if (input.length < 2) return input;
    const tokenize = (text: string): string[] => text.toLowerCase().match(/\p{L}[\p{L}\p{N}']*|\p{N}+/gu) || [];
    const result: TranscriptSegment[] = [];

    for (const seg of input) {
      const last = result[result.length - 1];
      if (!last) { result.push({ ...seg }); continue; }

      const lastTokens = tokenize(last.text);
      const curTokens = tokenize(seg.text);
      if (!lastTokens.length || !curTokens.length) { result.push({ ...seg }); continue; }

      // Case A: current text fully contains/equals previous — extend previous
      if (curTokens.length >= lastTokens.length &&
        lastTokens.every((t, i) => curTokens[i] === t)) {
        // current starts with all of previous — replace with current's text (extends last)
        last.text = seg.text;
        last.endSeconds = Math.max(last.endSeconds, seg.endSeconds);
        last.endLabel = secondsToShort(last.endSeconds);
        continue;
      }
      // Case B: previous text fully contains current — skip current (subset)
      if (lastTokens.length >= curTokens.length &&
        curTokens.every((t, i) => lastTokens[lastTokens.length - curTokens.length + i] === t)) {
        last.endSeconds = Math.max(last.endSeconds, seg.endSeconds);
        last.endLabel = secondsToShort(last.endSeconds);
        continue;
      }
      // Case C: find longest suffix of last's tokens that matches prefix of current's tokens
      let overlap = 0;
      const maxOverlap = Math.min(lastTokens.length, curTokens.length);
      for (let len = maxOverlap; len > 0; len--) {
        let match = true;
        for (let j = 0; j < len; j++) {
          if (lastTokens[lastTokens.length - len + j] !== curTokens[j]) { match = false; break; }
        }
        if (match) { overlap = len; break; }
      }
      if (overlap > 0) {
        // Reconstruct current text from non-overlapping tokens, preserving original casing/punctuation
        const sourceWords = seg.text.split(/\s+/).filter(Boolean);
        // overlap is in normalized tokens; approximate by skipping the first `overlap` original whitespace-words
        const newText = sourceWords.slice(overlap).join(' ').trim();
        if (newText) {
          result.push({ ...seg, text: newText });
        } else {
          // entirely overlap — just extend last
          last.endSeconds = Math.max(last.endSeconds, seg.endSeconds);
          last.endLabel = secondsToShort(last.endSeconds);
        }
        continue;
      }
      // No overlap — push as-is
      result.push({ ...seg });
    }
    return result.map((s, i) => ({ ...s, index: i + 1 }));
  };

  return dedupRolling(sameStartMerged);
}

export function parseSrt(srt: string): TranscriptSegment[] {
  const vtt = `WEBVTT\n\n${srt
    .replace(/\r\n/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`;
  return parseVtt(vtt);
}

export function segmentsToVtt(segments: TranscriptSegment[]): string {
  const lines = ['WEBVTT', ''];
  for (const seg of segments) {
    lines.push(`${secondsToTimecode(seg.startSeconds, '.')} --> ${secondsToTimecode(seg.endSeconds, '.')}`);
    lines.push(seg.text);
    lines.push('');
  }
  return lines.join('\n');
}

export function segmentsToSrt(segments: TranscriptSegment[]): string {
  return segments.map((seg, idx) => {
    return `${idx + 1}\n${secondsToTimecode(seg.startSeconds, ',')} --> ${secondsToTimecode(seg.endSeconds, ',')}\n${seg.text}`;
  }).join('\n\n') + '\n';
}

export function segmentsToPlainText(segments: TranscriptSegment[]): string {
  // Use newlines between segments — natural for lyrics (each line on its own)
  // and still readable for talks (each cue ≈ one phrase/sentence chunk).
  return segments
    .map((seg) => seg.text.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

export function segmentsToMarkdownParagraphs(segments: TranscriptSegment[]): string {
  if (!segments.length) return '';
  const paragraphs: string[] = [];
  let current: TranscriptSegment[] = [];

  for (const seg of segments) {
    const last = current[current.length - 1];
    const gap = last ? seg.startSeconds - last.endSeconds : 0;
    const charCount = current.reduce((sum, s) => sum + s.text.length, 0);
    const shouldBreak = (gap > 1.4 && charCount > 120) || charCount > 360;
    if (shouldBreak && current.length) {
      paragraphs.push(buildParagraph(current));
      current = [];
    }
    current.push(seg);
  }
  if (current.length) paragraphs.push(buildParagraph(current));

  return paragraphs.join('\n\n');
}

function buildParagraph(segments: TranscriptSegment[]): string {
  const start = secondsToShort(segments[0].startSeconds);
  const text = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
  return `**[${start}]** ${text}`;
}

interface YtdlpInfo {
  id?: string;
  title?: string;
  duration?: number;
  uploader?: string;
  channel?: string;
  upload_date?: string;
  thumbnail?: string;
  webpage_url?: string;
  view_count?: number;
  categories?: string[];
  tags?: string[];
  genre?: string;
  artist?: string;
  track?: string;
  subtitles?: Record<string, Array<{ ext: string; url: string }>>;
  automatic_captions?: Record<string, Array<{ ext: string; url: string }>>;
}

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  music: '🎵 Âm nhạc',
  talk: '🎤 Talk / Podcast',
  tutorial: '🎓 Hướng dẫn',
  news: '📰 Tin tức',
  vlog: '📹 Vlog',
  gaming: '🎮 Gaming',
  short: '⚡ Short / Reel',
  video: '📺 Video'
};

export function contentTypeLabel(type: ContentType): string {
  return CONTENT_TYPE_LABELS[type] || CONTENT_TYPE_LABELS.video;
}

export function detectContentType(info: YtdlpInfo): ContentType {
  const title = (info.title || '').toLowerCase();
  const categories = (info.categories || []).map((c) => c.toLowerCase());
  const tags = (info.tags || []).map((t) => t.toLowerCase());
  const channel = (info.channel || info.uploader || '').toLowerCase();
  const duration = info.duration || 0;

  // Strongest signal: yt-dlp categories
  if (categories.includes('music')) return 'music';
  if (categories.includes('news & politics')) return 'news';
  if (categories.includes('gaming')) return 'gaming';

  // Music: artist/track/genre fields exist
  if (info.artist || info.track || info.genre) return 'music';

  // Music keywords in title (Vietnamese + English)
  const musicPatterns = /\b(official\s+(music\s+)?video|official\s+lyric|m\/v|mv\b|lyric video|lyrics video|official audio|ost\b|theme song|nhạc phim|ca khúc|bài hát|cover\b|remix|karaoke|feat\.|ft\.|prod\.|hatsune|ed\d+|op\d+|opening|ending\s+theme|m-v)/i;
  if (musicPatterns.test(info.title || '')) return 'music';

  // Music tags
  if (tags.some((t) => /^(music|song|lyric|ost|kpop|vpop|cpop|hiphop|rap|edm|ballad|rock|pop|indie|acoustic|piano|guitar)$/.test(t))) return 'music';

  // News / Talk
  if (categories.includes('education') || categories.includes('howto & style') || categories.includes('science & technology')) {
    if (/\b(how to|tutorial|hướng dẫn|cách|guide|learn|dạy|tips|fix|setup|install)\b/i.test(info.title || '')) return 'tutorial';
  }
  if (/\b(news|tin tức|bản tin|thời sự|breaking|update|today show)\b/i.test(title)) return 'news';
  if (/\b(ted|tedx|podcast|interview|talk show|phỏng vấn|trò chuyện|chuyện trò)\b/i.test(title)) return 'talk';
  if (channel.includes('ted') || channel.includes('podcast')) return 'talk';

  // Tutorial broader patterns
  if (/\b(how to|tutorial|hướng dẫn|cách|step by step|step-by-step|walkthrough|crash course)\b/i.test(title)) return 'tutorial';

  // Vlog
  if (/\bvlog|day in (my|the) life|behind the scenes|haul|review\b/i.test(title)) return 'vlog';

  // Short (<60s typically TikTok/Reel/Shorts)
  if (duration > 0 && duration <= 60) return 'short';

  return 'video';
}

function buildQualityWarning(contentType: ContentType, source: 'manual' | 'auto' | 'whisper' | 'none', hasWhisper: boolean): string | null {
  if (contentType === 'music' && source === 'auto') {
    const suffix = hasWhisper ? ' Bấm "Re-run với Whisper" bên dưới để có lyrics chính xác hơn.' : ' Cài Whisper (python -m pip install faster-whisper-cli) để có transcript chính xác hơn.';
    return `Đây là video âm nhạc, transcript hiện tại là YouTube auto-caption nhận diện tiếng hát (thường sai chính tả nhiều).${suffix}`;
  }
  if (contentType === 'music' && source === 'manual') {
    return 'Lyrics từ caption gốc của video. Một số kênh upload caption tự động sinh → vẫn có thể sai chính tả.';
  }
  if (source === 'auto') {
    return 'Transcript này là YouTube auto-caption (ASR). Độ chính xác trung bình ~80-90% với speech rõ.';
  }
  if (source === 'whisper') {
    return null;
  }
  return null;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function humanizeYtdlpError(rawMessage: string): string {
  const lower = rawMessage.toLowerCase();
  if (lower.includes('429') || lower.includes('too many requests')) {
    return 'YouTube đang rate-limit IP của bạn (HTTP 429). Đợi 2-5 phút rồi thử lại, hoặc đổi sang URL khác.';
  }
  if (lower.includes('sign in to confirm') || lower.includes('age')) {
    return 'Video bị giới hạn độ tuổi — yt-dlp không lấy được nếu không đăng nhập. Thử URL công khai khác.';
  }
  if (lower.includes('private video') || lower.includes('this video is private')) {
    return 'Video riêng tư — không lấy được phụ đề.';
  }
  if (lower.includes('removed') || lower.includes('not available') || lower.includes('unavailable')) {
    return 'Video đã bị xoá hoặc không khả dụng ở khu vực này.';
  }
  if (lower.includes('unsupported url') || lower.includes('no video formats') || lower.includes('no suitable')) {
    return 'URL không được yt-dlp hỗ trợ. Thử YouTube/TikTok/Facebook/Vimeo… (1800+ site).';
  }
  if (lower.includes('http error 403')) {
    return 'YouTube từ chối request (403). Update yt-dlp: pip install -U yt-dlp, hoặc thử lại sau.';
  }
  if (lower.includes('http error 404')) {
    return 'URL không tồn tại (404). Kiểm tra lại link.';
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'Mạng chậm — yt-dlp timeout. Thử lại với URL ngắn hơn hoặc kiểm tra kết nối.';
  }
  if (lower.includes('only available for registered users')) {
    return 'Video yêu cầu tài khoản — chưa đăng nhập nên không lấy được.';
  }
  // Trim long stack-like errors to first useful line
  const firstLine = rawMessage.split('\n').find((line) => line.trim().length > 0) || rawMessage;
  return firstLine.length > 240 ? `${firstLine.slice(0, 240)}…` : firstLine;
}

function pickFirstVttFile(dir: string, langPriority: string[], manualFirst: boolean): { path: string; lang: string; auto: boolean } | null {
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.vtt'));
  const candidates = files.map((file) => {
    const match = file.match(/\.([A-Za-z0-9-]+)\.vtt$/);
    const lang = match ? match[1] : '';
    return { file, lang };
  });

  for (const preferredLang of langPriority) {
    const search = (auto: boolean) => {
      for (const { file, lang } of candidates) {
        if (!lang.toLowerCase().startsWith(preferredLang.toLowerCase())) continue;
        const isAuto = /(\.auto\.|\borig\b|automatic|asr)/i.test(file) || /\.[a-z]+-.*\.vtt$/.test(file) && file.includes('orig');
        if (isAuto !== !manualFirst) continue;
        return { path: path.join(dir, file), lang, auto: isAuto };
      }
      return null;
    };

    const primary = search(false);
    if (primary && manualFirst) return primary;
    const auto = search(true);
    if (auto && !manualFirst) return auto;
    const any = search(false) || search(true);
    if (any) return any;
  }

  // Last resort: take first available
  for (const { file, lang } of candidates) {
    return { path: path.join(dir, file), lang, auto: /auto/i.test(file) };
  }
  return null;
}

export interface CommandRunner {
  command: string;
  argsPrefix: string[];
}

function normalizeUrl(input: string): string {
  try {
    const parsed = new URL(input);
    // Strip YouTube playlist/mix/radio params — only keep the video id
    if (/(^|\.)youtube\.com$/.test(parsed.hostname) || parsed.hostname === 'youtu.be') {
      const videoId = parsed.hostname === 'youtu.be'
        ? parsed.pathname.slice(1).split('/')[0]
        : parsed.searchParams.get('v') || '';
      if (videoId && /^[\w-]{6,20}$/.test(videoId)) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }
    // Strip tracking params for other sites
    for (const param of ['utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid', '_t', '_r']) {
      parsed.searchParams.delete(param);
    }
    return parsed.toString();
  } catch {
    return input;
  }
}

export interface FetchTranscriptOptions {
  useWhisper?: boolean;
}

export async function fetchTranscriptWithYtdlp(
  rawUrl: string,
  languages: string[],
  runYtdlp: (args: string[], options: { timeoutMs: number }) => Promise<{ stdout: string }>,
  downloadDir: string,
  hasCommand: (command: string, args: string[]) => Promise<boolean>,
  options: FetchTranscriptOptions = {}
): Promise<TranscriptResult> {
  const url = normalizeUrl(rawUrl);
  const jobId = randomUUID();
  const jobDir = path.join(downloadDir, `transcript-${jobId}`);
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    const langList = (languages.length ? languages : ['vi', 'en']).join(',');
    const args = [
      '--write-info-json',
      '--write-subs',
      '--write-auto-subs',
      '--sub-format', 'vtt',
      '--sub-langs', `${langList},${langList}-*`,
      '--convert-subs', 'vtt',
      '--skip-download',
      '--no-warnings',
      '--no-playlist',
      '--ignore-no-formats-error',
      '--paths', jobDir,
      '-o', '%(id)s',
      url
    ];

    let subFetchError: Error | null = null;
    try {
      await runYtdlp(args, { timeoutMs: 90000 });
    } catch (error) {
      // Don't bail entirely — yt-dlp may have written info.json before sub fetch failed
      subFetchError = error instanceof Error ? error : new Error(String(error));
      console.warn('[transcript] sub fetch failed, will try info-only fallback:', subFetchError.message.slice(0, 200));
    }

    let infoFile = fs.readdirSync(jobDir).find((file) => file.endsWith('.info.json'));

    // If sub fetch failed AND no info.json, try info-only run (less likely to be rate-limited)
    if (!infoFile && subFetchError) {
      try {
        await runYtdlp([
          '--write-info-json',
          '--skip-download',
          '--no-warnings',
          '--no-playlist',
          '--paths', jobDir,
          '-o', '%(id)s',
          url
        ], { timeoutMs: 60000 });
        infoFile = fs.readdirSync(jobDir).find((file) => file.endsWith('.info.json'));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown';
        console.warn('[transcript] info-only fetch also failed:', message.slice(0, 200));
        throw subFetchError; // Re-throw original error
      }
    }

    if (!infoFile) {
      if (subFetchError) throw subFetchError;
      throw new Error('Không lấy được thông tin video (yt-dlp không trả info.json).');
    }

    const info = JSON.parse(fs.readFileSync(path.join(jobDir, infoFile), 'utf8')) as YtdlpInfo;

    const availableManual = Object.keys(info.subtitles || {});
    const availableAuto = Object.keys(info.automatic_captions || {});
    const availableLanguages = [
      ...availableManual.map((code) => ({ code, label: languageLabel(code), auto: false })),
      ...availableAuto.filter((code) => !availableManual.includes(code)).map((code) => ({ code, label: languageLabel(code), auto: true }))
    ];

    const detectedType = detectContentType(info);
    const videoMeta: VideoMeta = {
      title: info.title || 'Video',
      duration: typeof info.duration === 'number' ? info.duration : 0,
      durationLabel: secondsToShort(info.duration || 0),
      uploader: info.uploader || null,
      channel: info.channel || info.uploader || null,
      uploadDate: info.upload_date ? formatUploadDate(info.upload_date) : null,
      thumbnail: info.thumbnail || null,
      webpageUrl: info.webpage_url || url,
      viewCount: typeof info.view_count === 'number' ? info.view_count : null,
      host: hostFromUrl(info.webpage_url || url),
      contentType: detectedType,
      contentTypeLabel: contentTypeLabel(detectedType),
      categories: info.categories || []
    };

    const whisperAvailable = await hasCommand('faster-whisper', ['--help']) || await hasCommand('whisper', ['--help']);

    const langPriority = languages.length ? languages : ['vi', 'en'];
    // If user explicitly requested Whisper, skip the YouTube sub and go straight to Whisper.
    // Otherwise prefer existing manual/auto subs (faster, no compute).
    const picked = options.useWhisper ? null : pickFirstVttFile(jobDir, langPriority, true);

    if (!picked) {
      // No subtitles found OR user forced Whisper — try Whisper fallback
      const whisperResult = await tryWhisperFallback({
        url,
        info,
        videoMeta,
        jobDir,
        runYtdlp,
        hasCommand,
        languages: langPriority
      });
      if (whisperResult) return whisperResult;

      return {
        video: videoMeta,
        language: '',
        languageLabel: 'Không có',
        source: 'none',
        hasSubtitles: false,
        availableLanguages,
        segments: [],
        qualityWarning: buildQualityWarning(detectedType, 'none', whisperAvailable),
        plainText: '',
        paragraphsMarkdown: '',
        srt: '',
        vtt: '',
        message: whisperAvailable
          ? 'Video này không có phụ đề (manual hoặc auto). Whisper đã chạy nhưng không có speech.'
          : 'Video này không có phụ đề (manual hoặc auto). Cài Whisper local để transcribe fallback: python -m pip install faster-whisper-cli'
      };
    }

    const vtt = fs.readFileSync(picked.path, 'utf8');
    const segments = parseVtt(vtt);
    const subSource: 'manual' | 'auto' = picked.auto ? 'auto' : 'manual';

    if (segments.length === 0) {
      return {
        video: videoMeta,
        language: picked.lang,
        languageLabel: languageLabel(picked.lang),
        source: subSource,
        hasSubtitles: false,
        availableLanguages,
        segments: [],
        qualityWarning: buildQualityWarning(detectedType, subSource, whisperAvailable),
        plainText: '',
        paragraphsMarkdown: '',
        srt: '',
        vtt,
        warning: 'Phụ đề tải về nhưng parse không ra cue nào — VTT có thể trống.'
      };
    }

    return {
      video: videoMeta,
      language: picked.lang,
      languageLabel: languageLabel(picked.lang),
      source: subSource,
      hasSubtitles: true,
      availableLanguages,
      segments,
      qualityWarning: buildQualityWarning(detectedType, subSource, whisperAvailable),
      plainText: segmentsToPlainText(segments),
      paragraphsMarkdown: segmentsToMarkdownParagraphs(segments),
      srt: segmentsToSrt(segments),
      vtt: segmentsToVtt(segments)
    };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

function formatUploadDate(yyyymmdd: string): string | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

interface WhisperContext {
  url: string;
  info: YtdlpInfo;
  videoMeta: VideoMeta;
  jobDir: string;
  runYtdlp: (args: string[], options: { timeoutMs: number }) => Promise<{ stdout: string }>;
  hasCommand: (command: string, args: string[]) => Promise<boolean>;
  languages: string[];
}

async function tryWhisperFallback(context: WhisperContext): Promise<TranscriptResult | null> {
  const whisperCommand = await detectWhisper(context.hasCommand);
  if (!whisperCommand) {
    console.warn('[transcript:whisper] no whisper backend detected');
    return null;
  }

  // Download audio (mp3 16kHz, small file)
  const audioId = context.info.id || randomUUID();
  const beforeAudio = new Set(fs.readdirSync(context.jobDir));
  try {
    await context.runYtdlp([
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '5',
      '--postprocessor-args', '-ar 16000',
      '--no-playlist',
      '--no-warnings',
      '--paths', context.jobDir,
      '-o', `${audioId}.%(ext)s`,
      context.url
    ], { timeoutMs: 180000 });
  } catch (error) {
    console.warn('[transcript:whisper] audio download failed:', error instanceof Error ? error.message.slice(0, 200) : error);
    return null;
  }

  // Find downloaded audio (mp3 expected from -x --audio-format)
  const afterAudio = fs.readdirSync(context.jobDir);
  const audioFile = afterAudio.find((file) =>
    !beforeAudio.has(file) && /\.(mp3|m4a|webm|opus|wav)$/i.test(file) && !file.endsWith('.srt') && !file.endsWith('.vtt')
  );
  if (!audioFile) {
    console.warn('[transcript:whisper] no audio file found after yt-dlp run. Files:', afterAudio.filter((f) => !beforeAudio.has(f)));
    return null;
  }
  const audioPath = path.join(context.jobDir, audioFile);

  // Run whisper — output SRT or VTT depending on backend
  const lang = context.languages[0] || 'vi';
  const beforeFiles = new Set(fs.readdirSync(context.jobDir));

  try {
    await whisperCommand.invoke(audioPath, context.jobDir, lang);
  } catch (error) {
    console.warn('[transcript:whisper] whisper invocation failed:', error instanceof Error ? error.message.slice(0, 200) : error);
    return null;
  }

  // Find new subtitle file produced (.srt for faster-whisper, .vtt for openai-whisper)
  const afterFiles = fs.readdirSync(context.jobDir);
  const newSubFile = afterFiles.find((file) =>
    !beforeFiles.has(file) && (file.endsWith('.srt') || file.endsWith('.vtt'))
  );
  if (!newSubFile) {
    console.warn('[transcript:whisper] no SRT/VTT produced. New files:', afterFiles.filter((f) => !beforeFiles.has(f)));
    return null;
  }

  const subPath = path.join(context.jobDir, newSubFile);
  const subContent = fs.readFileSync(subPath, 'utf8');
  const segments = newSubFile.endsWith('.srt') ? parseSrt(subContent) : parseVtt(subContent);
  if (segments.length === 0) {
    console.warn('[transcript:whisper] subtitle file empty — likely no speech in audio. Content preview:', subContent.slice(0, 200));
    return {
      video: context.videoMeta,
      language: lang,
      languageLabel: languageLabel(lang),
      source: 'whisper',
      hasSubtitles: false,
      availableLanguages: [{ code: lang, label: languageLabel(lang), auto: true }],
      segments: [],
      qualityWarning: buildQualityWarning(context.videoMeta.contentType, 'whisper', true),
      plainText: '',
      paragraphsMarkdown: '',
      srt: '',
      vtt: '',
      message: 'Whisper đã chạy nhưng không phát hiện được lời thoại trong audio (có thể video chỉ có nhạc/silent). Thử video khác có người nói.'
    };
  }

  return {
    video: context.videoMeta,
    language: lang,
    languageLabel: languageLabel(lang),
    source: 'whisper',
    hasSubtitles: true,
    availableLanguages: [{ code: lang, label: languageLabel(lang), auto: true }],
    segments,
    qualityWarning: buildQualityWarning(context.videoMeta.contentType, 'whisper', true),
    plainText: segmentsToPlainText(segments),
    paragraphsMarkdown: segmentsToMarkdownParagraphs(segments),
    srt: segmentsToSrt(segments),
    vtt: segmentsToVtt(segments),
    warning: 'Đã transcribe bằng Whisper local (ASR neural network — thường chính xác hơn YouTube auto-sub, nhất là với tiếng hát).'
  };
}

interface WhisperInvoker {
  name: string;
  invoke: (audioPath: string, outputDir: string, language: string) => Promise<void>;
}

async function detectWhisper(hasCommand: (command: string, args: string[]) => Promise<boolean>): Promise<WhisperInvoker | null> {
  const { spawn } = await import('node:child_process');

  const run = (command: string, args: string[]) => new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { shell: process.platform === 'win32', windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exit ${code}: ${stderr.trim().slice(0, 200)}`));
    });
  });

  // faster-whisper-cli installs a binary named "faster-whisper" (not -cli) and outputs .srt
  if (await hasCommand('faster-whisper', ['--help'])) {
    return {
      name: 'faster-whisper',
      invoke: async (audio, dir, lang) => {
        const pathMod = await import('node:path');
        const baseName = pathMod.parse(audio).name;
        const srtPath = pathMod.join(dir, `${baseName}.srt`);
        await run('faster-whisper', [
          audio,
          '-o', srtPath,
          '--language', lang,
          '--model_size_or_path', 'base',
          '--device', 'cpu',
          '--compute_type', 'int8',
          '--vad_filter', 'true'
        ]);
      }
    };
  }
  // openai-whisper CLI outputs .vtt natively
  if (await hasCommand('whisper', ['--help'])) {
    return {
      name: 'whisper',
      invoke: async (audio, dir, lang) => {
        await run('whisper', [audio, '--model', 'base', '--language', lang, '--output_format', 'vtt', '--output_dir', dir]);
      }
    };
  }
  return null;
}
