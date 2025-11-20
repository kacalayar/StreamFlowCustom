const multer = require('multer');
const path = require('path');
const { getUniqueFilename, paths } = require('../utils/storage');

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, paths.videos);
  },
  filename: (req, file, cb) => {
    const uniqueFilename = getUniqueFilename(file.originalname);
    cb(null, uniqueFilename);
  }
});

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, paths.avatars);
  },
  filename: (req, file, cb) => {
    const uniqueFilename = getUniqueFilename(file.originalname);
    cb(null, uniqueFilename);
  }
});

const youtubeCookiesStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, paths.cookiesDir);
  },
  filename: (req, file, cb) => {
    cb(null, 'yt-cookies.txt');
  }
});

const videoFilter = (req, file, cb) => {
  const allowedFormats = ['video/mp4', 'video/avi', 'video/quicktime'];
  const fileExt = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.mp4', '.avi', '.mov'];
  if (allowedFormats.includes(file.mimetype) || allowedExts.includes(fileExt)) {
    cb(null, true);
  } else {
    cb(new Error('Only .mp4, .avi, and .mov formats are allowed'), false);
  }
};

const imageFilter = (req, file, cb) => {
  const allowedFormats = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
  const fileExt = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.jpg', '.jpeg', '.png', '.gif'];
  if (allowedFormats.includes(file.mimetype) || allowedExts.includes(fileExt)) {
    cb(null, true);
  } else {
    cb(new Error('Only .jpg, .jpeg, .png, and .gif formats are allowed'), false);
  }
};

const youtubeCookiesFilter = (req, file, cb) => {
  const allowedFormats = ['text/plain', 'application/json'];
  const fileExt = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.txt', '.json'];
  if (allowedFormats.includes(file.mimetype) || allowedExts.includes(fileExt)) {
    cb(null, true);
  } else {
    cb(new Error('Format cookies harus .txt atau .json'), false);
  }
};

const uploadVideo = multer({
  storage: videoStorage,
  fileFilter: videoFilter
});

const upload = multer({
  storage: avatarStorage,
  fileFilter: imageFilter
});

const uploadYoutubeCookies = multer({
  storage: youtubeCookiesStorage,
  fileFilter: youtubeCookiesFilter,
  limits: {
    fileSize: 1024 * 1024 // 1MB
  }
});

module.exports = {
  uploadVideo,
  upload,
  uploadYoutubeCookies
};