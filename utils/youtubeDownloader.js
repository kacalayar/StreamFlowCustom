const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const YTDlpWrap = require('yt-dlp-wrap-plus').default;
const { paths, getUniqueFilename } = require('./storage');

const access = promisify(fs.access);
const mkdir = promisify(fs.mkdir);

const BIN_DIR = path.join(__dirname, '../bin');
const BIN_EXT = process.platform === 'win32' ? '.exe' : '';
const BIN_PATH = path.join(BIN_DIR, `yt-dlp${BIN_EXT}`);
const NODE_BINARY_DIR = path.dirname(process.execPath);
const DEFAULT_JS_RUNTIME = process.env.YTDLP_JS_RUNTIME || process.execPath;
const COOKIE_FILE_PATH = process.env.YTDLP_COOKIES_FILE || paths.youtubeCookiesFile;

let ytDlpInstance = null;
let binaryReadyPromise = null;

function createError(message, code) {
  const error = new Error(message);
  if (code) {
    error.code = code;
  }

function normalizeProgressPayload(progress) {
  if (!progress) return null;
  const percentRaw = typeof progress.percent === 'number'
    ? progress.percent
    : parseFloat(String(progress.percent || '0').replace('%', ''));
  const percent = Number.isFinite(percentRaw) ? Math.max(0, Math.min(100, percentRaw)) : 0;
  const totalBytes = parseInt(progress.totalBytes || progress.total_bytes || progress.total || 0, 10) || null;
  const downloadedBytes = parseInt(progress.downloadedBytes || progress.downloaded_bytes || 0, 10)
    || (totalBytes && percent ? Math.round((percent / 100) * totalBytes) : null);
  const speedBytes = parseFloat(progress.speed || progress.currentSpeed || progress.avgSpeed || 0) || 0;
  const etaSeconds = parseFloat(progress.eta || progress.etaTime || 0) || null;

  return {
    percent,
    downloadedBytes,
    totalBytes,
    downloadedFormatted: formatBytes(downloadedBytes),
    totalSize: formatBytes(totalBytes),
    speed: speedBytes,
    speedFormatted: speedBytes ? `${formatBytes(speedBytes)}/s` : '-/-',
    eta: etaSeconds,
    etaFormatted: formatEta(etaSeconds)
  };
}

function formatBytes(bytes) {
  if (!bytes || Number.isNaN(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

function formatEta(seconds) {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return '-';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function runDownloadWithProgress(ytDlpWrap, execArgs, execEnv, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const ytProcess = ytDlpWrap.exec(execArgs, { env: execEnv });
      let stdout = '';
      let stderr = '';

      if (ytProcess.stdout) {
        ytProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }
      if (ytProcess.stderr) {
        ytProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      if (typeof onProgress === 'function' && typeof ytProcess.on === 'function') {
        ytProcess.on('progress', (progressData) => {
          try {
            const normalized = normalizeProgressPayload(progressData);
            if (normalized) {
              onProgress(normalized);
            }
          } catch (err) {
            console.warn('Failed to emit progress:', err.message);
          }
        });
      }

      ytProcess.once('error', (error) => {
        reject(error);
      });

      ytProcess.once('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(createError(stderr || 'Gagal mengunduh video YouTube', 'YTDLP_DOWNLOAD_ERROR'));
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}
  return error;
}

function getYoutubeCookiesStatus() {
  const info = {
    path: COOKIE_FILE_PATH || null,
    exists: false,
    size: 0,
    updatedAt: null
  };
  if (!COOKIE_FILE_PATH) {
    return info;
  }
  if (fs.existsSync(COOKIE_FILE_PATH)) {
    const stats = fs.statSync(COOKIE_FILE_PATH);
    info.exists = stats.size > 0;
    info.size = stats.size;
    info.updatedAt = stats.mtime;
  }
  return info;
}

function sanitizeTitle(title = '') {
  return title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim() || 'youtube-video';
}

function parseMetadata(output) {
  if (!output) return null;
  const lines = output.trim().split('\n').reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      continue;
    }
  }
  return null;
}

function isSupportedYoutubeUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtube.com')) {
      return parsed.pathname.startsWith('/watch') || host === 'music.youtube.com';
    }
    if (host === 'youtu.be') {
      return parsed.pathname.length > 1;
    }
    return false;
  } catch (error) {
    return false;
  }
}

async function ensureBinaryAvailable() {
  if (!binaryReadyPromise) {
    binaryReadyPromise = (async () => {
      await mkdir(BIN_DIR, { recursive: true });
      if (!fs.existsSync(BIN_PATH)) {
        console.log('Downloading yt-dlp binary to', BIN_PATH);
        await YTDlpWrap.downloadFromGithub(BIN_PATH, undefined, process.platform);
      }
      ytDlpInstance = new YTDlpWrap(BIN_PATH);
      return ytDlpInstance;
    })().catch((error) => {
      binaryReadyPromise = null;
      throw error;
    });
  }
  return binaryReadyPromise;
}

async function downloadYoutubeVideo(url, options = {}) {
  if (!url || typeof url !== 'string' || !isSupportedYoutubeUrl(url)) {
    throw createError('URL YouTube tidak valid', 'INVALID_YOUTUBE_URL');
  }

  const { onProgress } = options;

  try {
    await ensureBinaryAvailable();
    const ytDlpWrap = ytDlpInstance;
    const tempFilename = getUniqueFilename('youtube-video.mp4');
    const baseName = path.parse(tempFilename).name;
    const outputTemplate = path.join(paths.videos, `${baseName}.%(ext)s`);

    const execArgs = [
      url,
      '--no-playlist',
      '--print-json',
      '--restrict-filenames',
      '-f', 'bv*+ba/best',
      '--merge-output-format', 'mp4',
      '-o', outputTemplate
    ];

    const cookiesStatus = getYoutubeCookiesStatus();
    if (cookiesStatus.exists) {
      execArgs.push('--cookies', COOKIE_FILE_PATH);
    } else if (COOKIE_FILE_PATH) {
      console.warn('YT-DLP cookies file not found or empty at', COOKIE_FILE_PATH);
    }

    execArgs.push('--extractor-args', 'youtube:player_client=default');

    const execEnv = { ...process.env };
    if (DEFAULT_JS_RUNTIME && !execEnv.YTDLP_JS_RUNTIME) {
      execEnv.YTDLP_JS_RUNTIME = DEFAULT_JS_RUNTIME;
    }
    if (NODE_BINARY_DIR) {
      const currentPath = execEnv.PATH || execEnv.Path || '';
      const pathSeparator = path.delimiter;
      const pathSegments = currentPath.split(pathSeparator).filter(Boolean);
      if (!pathSegments.includes(NODE_BINARY_DIR)) {
        execEnv.PATH = `${NODE_BINARY_DIR}${pathSeparator}${currentPath}`.replace(new RegExp(`${pathSeparator}$`), '');
        execEnv.Path = execEnv.PATH;
      }
    }

    const result = await runDownloadWithProgress(ytDlpWrap, execArgs, execEnv, onProgress);

    const metadata = parseMetadata(result);
    if (!metadata) {
      throw createError('Gagal mendapatkan metadata YouTube', 'YTDLP_METADATA_ERROR');
    }

    const downloadedPath = metadata._filename
      ? path.isAbsolute(metadata._filename)
        ? metadata._filename
        : path.join(paths.videos, metadata._filename)
      : path.join(paths.videos, `${baseName}.${metadata.ext || 'mp4'}`);

    await access(downloadedPath);

    const stats = fs.statSync(downloadedPath);
    const safeTitle = sanitizeTitle(metadata.title || baseName);
    const finalFilename = getUniqueFilename(`${safeTitle}.${metadata.ext || 'mp4'}`);
    const finalPath = path.join(paths.videos, finalFilename);

    if (downloadedPath !== finalPath) {
      fs.renameSync(downloadedPath, finalPath);
    }

    return {
      title: metadata.title || safeTitle,
      duration: Math.round(metadata.duration || 0),
      filepath: `/uploads/videos/${finalFilename}`,
      fullPath: finalPath,
      fileSize: stats.size,
      format: metadata.ext || 'mp4',
      resolution: metadata.width && metadata.height ? `${metadata.width}x${metadata.height}` : null,
      fps: metadata.fps || null
    };
  } catch (error) {
    if (error.code === 'ERR_INVALID_URL' || error.code === 'INVALID_YOUTUBE_URL') {
      throw createError('URL YouTube tidak valid', 'INVALID_YOUTUBE_URL');
    }
    if (error.stderr && error.stderr.toLowerCase().includes('copyright')) {
      throw createError('Video YouTube tidak tersedia untuk diunduh', 'YOUTUBE_UNAVAILABLE');
    }
    throw createError(error.message || 'Gagal mengunduh video YouTube', 'YTDLP_DOWNLOAD_ERROR');
  }
}

module.exports = {
  downloadYoutubeVideo,
  getYoutubeCookiesStatus
};
