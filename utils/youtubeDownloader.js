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

async function downloadYoutubeVideo(url) {
  if (!url || typeof url !== 'string' || !isSupportedYoutubeUrl(url)) {
    throw createError('URL YouTube tidak valid', 'INVALID_YOUTUBE_URL');
  }

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

    const result = await ytDlpWrap.execPromise(execArgs, { env: execEnv });

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
