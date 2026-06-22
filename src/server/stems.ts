import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface StemFile {
  name: 'vocals' | 'drums' | 'bass' | 'other' | 'instrumental';
  label: string;
  fileName: string;
  size: number;
  duration: number;
  downloadUrl: string;
  streamUrl: string;
}

export interface StemsResult {
  jobId: string;
  title: string;
  duration: number;
  durationLabel: string;
  thumbnail: string | null;
  source: 'demucs' | 'spleeter';
  model: string;
  stems: StemFile[];
  instrumentalUrl: string | null; // drums + bass + other mixed (= karaoke track)
  karaokeUrl: string | null; // same as instrumentalUrl (semantic alias)
  message?: string;
  warning?: string;
}

function formatDurationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface StemsRunOptions {
  url: string;
  jobDir: string;
  jobId: string;
  downloadsBase: string;
  model?: 'htdemucs' | 'htdemucs_ft' | 'mdx_extra' | 'spleeter:4stems';
  twoStems?: boolean; // karaoke mode: vocals + instrumental only (≈2x faster)
  audioPath?: string; // local uploaded audio file (skip yt-dlp download when set)
  title?: string;     // display title for uploaded audio
  runYtdlp: (args: string[], options: { timeoutMs: number }) => Promise<{ stdout: string }>;
  runCommand: (command: string, args: string[], options?: { timeoutMs?: number; env?: Record<string, string> }) => Promise<{ stdout: string; stderr: string }>;
  hasCommand: (command: string, args: string[]) => Promise<boolean>;
}

async function detectDemucs(hasCommand: (command: string, args: string[]) => Promise<boolean>): Promise<'demucs' | null> {
  if (await hasCommand('demucs', ['--help'])) return 'demucs';
  if (await hasCommand('python3', ['-m', 'demucs.separate', '--help'])) return 'demucs';
  if (await hasCommand('python', ['-m', 'demucs.separate', '--help'])) return 'demucs';
  return null;
}

async function probeAudioDuration(
  filePath: string,
  runCommand: StemsRunOptions['runCommand']
): Promise<number> {
  try {
    const { stdout } = await runCommand('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], { timeoutMs: 8000 });
    const n = parseFloat(stdout.trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function fetchVideoInfo(url: string, runYtdlp: StemsRunOptions['runYtdlp']): Promise<{ title: string; duration: number; thumbnail: string | null }> {
  try {
    const { stdout } = await runYtdlp([
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--skip-download',
      url
    ], { timeoutMs: 60000 });
    const firstLine = stdout.split('\n').find((line) => line.trim().startsWith('{'));
    if (!firstLine) return { title: 'audio', duration: 0, thumbnail: null };
    const info = JSON.parse(firstLine) as { title?: string; duration?: number; thumbnail?: string | null };
    return {
      title: info.title || 'audio',
      duration: Number.isFinite(info.duration) ? Number(info.duration) : 0,
      thumbnail: info.thumbnail || null
    };
  } catch {
    return { title: 'audio', duration: 0, thumbnail: null };
  }
}

export async function separateStems(options: StemsRunOptions): Promise<StemsResult> {
  const { url, jobDir, jobId, downloadsBase, runYtdlp, runCommand, hasCommand } = options;
  const model = options.model || 'htdemucs';
  const twoStems = Boolean(options.twoStems);

  // 1) Verify backend availability
  const demucsAvailable = await detectDemucs(hasCommand);
  if (!demucsAvailable) {
    const err = new Error(
      'Demucs chưa được cài đặt trên server. Tách stems cần Demucs (Python). ' +
      'Cài qua: pip install demucs (hoặc dùng GPU image với torch). ' +
      'Trong khi chờ admin cài, dùng tab "Trích lời" để lấy lyrics.'
    );
    (err as Error & { code: string }).code = 'DEMUCS_NOT_INSTALLED';
    throw err;
  }

  // 2 + 3) Resolve the source audio: either an uploaded local file, or download from URL.
  let meta: { title: string; duration: number; thumbnail: string | null };
  let audioPath: string;
  let duration: number;

  if (options.audioPath) {
    // Uploaded file path — skip yt-dlp entirely.
    audioPath = options.audioPath;
    duration = await probeAudioDuration(audioPath, runCommand);
    if (duration > 600) {
      throw new Error(`Audio dài ${formatDurationLabel(duration)} — vượt giới hạn 10 phút để tách stems (Demucs CPU rất chậm).`);
    }
    meta = { title: options.title || 'Audio upload', duration, thumbnail: null };
  } else {
    meta = await fetchVideoInfo(url, runYtdlp);
    if (meta.duration > 600) {
      throw new Error(`Audio dài ${formatDurationLabel(meta.duration)} — vượt giới hạn 10 phút để tách stems (Demucs CPU rất chậm). Cắt audio ngắn lại bằng tool khác trước.`);
    }
    const audioId = `src-${jobId.slice(0, 8)}`;
    const beforeFiles = new Set(fs.readdirSync(jobDir));
    await runYtdlp([
      '-x',
      '--audio-format', 'wav',
      '--audio-quality', '0',
      '--no-playlist',
      '--no-warnings',
      '--paths', jobDir,
      '-o', `${audioId}.%(ext)s`,
      url
    ], { timeoutMs: 240000 });

    const afterFiles = fs.readdirSync(jobDir);
    const audioFile = afterFiles.find((f) =>
      !beforeFiles.has(f) && /\.(wav|mp3|m4a|webm|opus)$/i.test(f)
    );
    if (!audioFile) {
      throw new Error('Không tải được audio từ URL. Thử URL khác.');
    }
    audioPath = path.join(jobDir, audioFile);
    duration = meta.duration > 0 ? meta.duration : await probeAudioDuration(audioPath, runCommand);
  }

  // 4) Run Demucs (CPU mode — slower but works without GPU)
  // demucs -n <model> --out <dir> --mp3 --device cpu <input>
  const demucsOutDir = path.join(jobDir, 'stems-raw');
  fs.mkdirSync(demucsOutDir, { recursive: true });
  const demucsArgs = [
    '-n', model,
    '--out', demucsOutDir,
    '--mp3',
    '--mp3-bitrate', '256',
    '--device', 'cpu',
    ...(twoStems ? ['--two-stems', 'vocals'] : []),
    audioPath
  ];
  try {
    await runCommand('demucs', demucsArgs, { timeoutMs: 30 * 60 * 1000 }); // 30 min hard cap
  } catch (err) {
    // Try python -m fallback
    const msg = err instanceof Error ? err.message : String(err);
    if (/ENOENT|not found|command not found/i.test(msg)) {
      const pythonCommand = (await hasCommand('python3', ['--version'])) ? 'python3' : 'python';
      await runCommand(pythonCommand, ['-m', 'demucs.separate', ...demucsArgs], { timeoutMs: 30 * 60 * 1000 });
    } else {
      throw err;
    }
  }

  // Demucs output structure: <out>/<model>/<basename>/{vocals,drums,bass,other}.mp3
  const modelDir = path.join(demucsOutDir, model);
  if (!fs.existsSync(modelDir)) {
    throw new Error('Demucs hoàn tất nhưng không tìm thấy folder output. Có thể quá trình bị giết do hết RAM.');
  }
  const innerDirs = fs.readdirSync(modelDir).filter((d) => fs.statSync(path.join(modelDir, d)).isDirectory());
  if (innerDirs.length === 0) {
    throw new Error('Demucs không xuất ra file. Kiểm tra log server.');
  }
  const stemFolder = path.join(modelDir, innerDirs[0]);

  // 5) Move stems to public download folder. 2-stem mode (demucs --two-stems vocals)
  // outputs vocals.mp3 + no_vocals.mp3; 4-stem outputs vocals/drums/bass/other.
  type StemSpec = { file: string; name: StemFile['name']; label: string };
  const stemSpecs: StemSpec[] = twoStems
    ? [
        { file: 'vocals', name: 'vocals', label: 'Giọng hát (Vocals)' },
        { file: 'no_vocals', name: 'instrumental', label: 'Nhạc nền (Karaoke)' }
      ]
    : [
        { file: 'vocals', name: 'vocals', label: 'Vocals' },
        { file: 'drums', name: 'drums', label: 'Drums' },
        { file: 'bass', name: 'bass', label: 'Bass' },
        { file: 'other', name: 'other', label: 'Other' }
      ];
  const stems: StemFile[] = [];

  for (const spec of stemSpecs) {
    const srcPath = path.join(stemFolder, `${spec.file}.mp3`);
    if (!fs.existsSync(srcPath)) continue;
    const targetName = `${spec.name}.mp3`;
    const targetPath = path.join(jobDir, targetName);
    fs.renameSync(srcPath, targetPath);
    const stat = fs.statSync(targetPath);
    const stemDur = await probeAudioDuration(targetPath, runCommand);
    stems.push({
      name: spec.name,
      label: spec.label,
      fileName: targetName,
      size: stat.size,
      duration: stemDur || duration,
      downloadUrl: `${downloadsBase}/${jobId}/${encodeURIComponent(targetName)}`,
      streamUrl: `${downloadsBase}/${jobId}/${encodeURIComponent(targetName)}`
    });
  }

  if (stems.length === 0) {
    throw new Error('Demucs xuất 0 stem — kiểm tra version hoặc thử model khác.');
  }

  // 6) Karaoke/instrumental track
  let instrumentalUrl: string | null = null;
  if (twoStems) {
    // 2-stem mode already produced the instrumental directly (no_vocals → instrumental.mp3)
    const inst = stems.find((s) => s.name === 'instrumental');
    if (inst) instrumentalUrl = `${downloadsBase}/${jobId}/${encodeURIComponent(inst.fileName)}`;
  } else {
    // 4-stem: build instrumental = drums + bass + other (no vocals) via ffmpeg amix
    const nonVocal = stems.filter((s) => s.name !== 'vocals');
    if (nonVocal.length >= 2) {
      const inputs: string[] = [];
      nonVocal.forEach((s) => {
        inputs.push('-i', path.join(jobDir, s.fileName));
      });
      const instrumentalPath = path.join(jobDir, 'instrumental.mp3');
      try {
        await runCommand('ffmpeg', [
          '-y',
          ...inputs,
          '-filter_complex', `amix=inputs=${nonVocal.length}:duration=longest:normalize=0`,
          '-b:a', '256k',
          instrumentalPath
        ], { timeoutMs: 120000 });
        if (fs.existsSync(instrumentalPath)) {
          instrumentalUrl = `${downloadsBase}/${jobId}/${encodeURIComponent('instrumental.mp3')}`;
        }
      } catch (err) {
        console.warn('[stems] instrumental mix failed:', err instanceof Error ? err.message.slice(0, 200) : err);
      }
    }
  }

  // 7) Clean up source audio + demucs raw dir
  try {
    fs.unlinkSync(audioPath);
    fs.rmSync(demucsOutDir, { recursive: true, force: true });
  } catch { /* ignore */ }

  return {
    jobId,
    title: meta.title,
    duration,
    durationLabel: formatDurationLabel(duration),
    thumbnail: meta.thumbnail,
    source: 'demucs',
    model,
    stems,
    instrumentalUrl,
    karaokeUrl: instrumentalUrl
  };
}

export async function isDemucsReady(hasCommand: (command: string, args: string[]) => Promise<boolean>): Promise<boolean> {
  return (await detectDemucs(hasCommand)) !== null;
}

export function newStemsJobDir(downloadDir: string): { jobId: string; jobDir: string } {
  const jobId = randomUUID();
  const jobDir = path.join(downloadDir, jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  return { jobId, jobDir };
}
