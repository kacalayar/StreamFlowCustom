const fs = require('fs-extra');
const path = require('path');

const storageRoot = path.join(__dirname, '../storage');
const youtubeStorageDir = path.join(storageRoot, 'youtube');
const uploadsVideosDir = path.join(__dirname, '../public/uploads/videos');
const uploadsThumbnailsDir = path.join(__dirname, '../public/uploads/thumbnails');
const uploadsAvatarsDir = path.join(__dirname, '../public/uploads/avatars');

const ensureDirectories = () => {
  const dirs = [
    uploadsVideosDir,
    uploadsThumbnailsDir,
    uploadsAvatarsDir,
    youtubeStorageDir
  ];
  dirs.forEach(dir => {
    fs.ensureDirSync(dir);
  });
};
const getUniqueFilename = (originalFilename) => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000);
  const ext = path.extname(originalFilename);
  const basename = path.basename(originalFilename, ext)
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase();
  return `${basename}-${timestamp}-${random}${ext}`;
};
module.exports = {
  ensureDirectories,
  getUniqueFilename,
  paths: {
    videos: uploadsVideosDir,
    thumbnails: uploadsThumbnailsDir,
    avatars: uploadsAvatarsDir,
    cookiesDir: youtubeStorageDir,
    youtubeCookiesFile: path.join(youtubeStorageDir, 'yt-cookies.txt')
  }
};