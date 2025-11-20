const fs = require('fs');
const path = require('path');
const ytdl = require('ytdl-core');
const { paths, getUniqueFilename } = require('./storage');

function createError(message, code) {
  const error = new Error(message);
  if (code) {
    error.code = code;
  }
  return error;
}

function sanitizeTitle(title = '') {
  return title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim() || 'youtube-video';
}

async function downloadYoutubeVideo(url) {
  if (!ytdl.validateURL(url)) {
    throw createError('URL YouTube tidak valid', 'INVALID_YOUTUBE_URL');
  }

  try {
    const info = await ytdl.getInfo(url);
    const videoDetails = info.videoDetails;
    const safeTitle = sanitizeTitle(videoDetails.title);
    let format = ytdl.chooseFormat(info.formats, {
      quality: 'highest',
      filter: f => f.container === 'mp4' && f.hasVideo && f.hasAudio
    });

    if (!format || !format.container) {
      format = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'audioandvideo' });
    }

    const extension = format && format.container ? format.container : 'mp4';
    const uniqueFilename = getUniqueFilename(`${safeTitle}.${extension}`);
    const fullPath = path.join(paths.videos, uniqueFilename);

    await new Promise((resolve, reject) => {
      const stream = ytdl.downloadFromInfo(info, {
        quality: format ? format.itag : 'highest',
        highWaterMark: 1 << 25
      });

      stream.on('error', reject);

      const writeStream = fs.createWriteStream(fullPath);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);

      stream.pipe(writeStream);
    });

    const stats = fs.statSync(fullPath);

    return {
      title: videoDetails.title,
      duration: parseInt(videoDetails.lengthSeconds, 10) || 0,
      filepath: `/uploads/videos/${uniqueFilename}`,
      fullPath,
      fileSize: stats.size,
      format: extension
    };
  } catch (error) {
    if (error.code === 'ERR_INVALID_URL') {
      throw createError('URL YouTube tidak valid', 'INVALID_YOUTUBE_URL');
    }
    if (error.message && error.message.toLowerCase().includes('copyright')) {
      throw createError('Video YouTube tidak tersedia untuk diunduh', 'YOUTUBE_UNAVAILABLE');
    }
    throw error;
  }
}

module.exports = {
  downloadYoutubeVideo
};
