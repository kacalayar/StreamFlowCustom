const fs = require('fs/promises');
const path = require('path');
const Video = require('../models/Video');

const FILE_TARGETS = {
  videos: {
    dir: path.join(__dirname, '../public/uploads/videos'),
    label: 'Videos',
    dbResolver: async (userId = null, isAdmin = false) => {
      try {
        const records = await Video.findAll(isAdmin ? null : userId);
        return new Set((records || []).map((video) => path.basename(video.filepath || '')));
      } catch (error) {
        console.error('Failed to resolve registered videos:', error);
        return new Set();
      }
    }
  },
  thumbnails: {
    dir: path.join(__dirname, '../public/uploads/thumbnails'),
    label: 'Thumbnails',
    dbResolver: async () => new Set()
  }
};

const PART_EXTENSIONS = ['.part', '.ytdl'];

async function ensureTarget(type) {
  const target = FILE_TARGETS[type];
  if (!target) {
    const error = new Error('File type tidak dikenali');
    error.code = 'UNKNOWN_FILE_TYPE';
    throw error;
  }
  return target;
}

function buildFileMeta(fileName, stats, registeredSet) {
  const ext = path.extname(fileName).toLowerCase();
  const base = path.basename(fileName);
  const isPartial = PART_EXTENSIONS.some((suffix) => base.endsWith(suffix));
  const registered = registeredSet ? registeredSet.has(base) : false;

  return {
    name: base,
    size: stats.size,
    modifiedAt: stats.mtime,
    type: ext.replace('.', '') || 'unknown',
    isPartial,
    registered,
    status: isPartial ? 'partial' : (registered ? 'registered' : 'orphan')
  };
}

async function listFiles(type = 'videos', userId = null, isAdmin = false) {
  const target = await ensureTarget(type);
  const registeredSet = await target.dbResolver(userId, isAdmin);
  const entries = await fs.readdir(target.dir).catch((error) => {
    console.error('Failed to read directory:', error);
    return [];
  });

  const files = [];
  for (const entry of entries) {
    try {
      const fullPath = path.join(target.dir, entry);
      const stats = await fs.stat(fullPath);
      if (!stats.isFile()) continue;
      const meta = buildFileMeta(entry, stats, registeredSet);
      // Untuk user non-admin, hanya tampilkan file yang terdaftar (milik user tsb di tabel videos)
      if (!isAdmin && type === 'videos' && !meta.registered) {
        continue;
      }
      files.push(meta);
    } catch (error) {
      console.warn('Skipping file due to error:', entry, error.message);
    }
  }
  files.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return files;
}

async function deleteFiles(type = 'videos', names = [], userId = null, isAdmin = false) {
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error('Daftar file yang akan dihapus wajib diisi');
  }
  const target = await ensureTarget(type);
  const results = { deleted: [], failed: [] };

  let allowedNames = null;
  if (type === 'videos' && !isAdmin && userId) {
    try {
      const records = await Video.findAll(userId);
      allowedNames = new Set((records || []).map((video) => path.basename(video.filepath || '')));
    } catch (error) {
      console.error('Failed to resolve allowed videos for user:', error);
      allowedNames = new Set();
    }
  }

  for (const fileName of names) {
    const safeName = path.basename(fileName);
    const fullPath = path.join(target.dir, safeName);
    if (!fullPath.startsWith(target.dir)) {
      results.failed.push({ name: safeName, reason: 'Path tidak valid' });
      continue;
    }
    if (allowedNames && !allowedNames.has(safeName)) {
      results.failed.push({ name: safeName, reason: 'Tidak diizinkan menghapus file milik user lain' });
      continue;
    }
    try {
      await fs.unlink(fullPath);
      results.deleted.push(safeName);
    } catch (error) {
      results.failed.push({ name: safeName, reason: error.message });
    }
  }
  return results;
}

module.exports = {
  listFiles,
  deleteFiles,
  FILE_TARGETS
};
