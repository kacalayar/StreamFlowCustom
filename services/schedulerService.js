const Stream = require('../models/Stream');
const PlaylistSchedule = require('../models/PlaylistSchedule');
const scheduledTerminations = new Map();
const SCHEDULE_LOOKAHEAD_SECONDS = 60;
const AUTO_PLAYLIST_INTERVAL_MS = 30 * 1000;
let streamingService = null;
let initialized = false;
let scheduleIntervalId = null;
let durationIntervalId = null;
let autoPlaylistIntervalId = null;
const autoPlaylistLocks = new Set();
function init(streamingServiceInstance) {
  if (initialized) {
    console.log('Stream scheduler already initialized');
    return;
  }
  streamingService = streamingServiceInstance;
  initialized = true;
  console.log('Stream scheduler initialized');
  scheduleIntervalId = setInterval(checkScheduledStreams, 60 * 1000);
  durationIntervalId = setInterval(checkStreamDurations, 60 * 1000);
  autoPlaylistIntervalId = setInterval(checkAutoPlaylistSchedules, AUTO_PLAYLIST_INTERVAL_MS);
  checkScheduledStreams();
  checkStreamDurations();
  checkAutoPlaylistSchedules();
}
async function checkScheduledStreams() {
  try {
    if (!streamingService) {
      console.error('StreamingService not initialized in scheduler');
      return;
    }
    const now = new Date();
    const lookAheadTime = new Date(now.getTime() + SCHEDULE_LOOKAHEAD_SECONDS * 1000);
    const streams = await Stream.findScheduledInRange(now, lookAheadTime);
    if (streams.length > 0) {
      console.log(`Found ${streams.length} streams to schedule start`);
      for (const stream of streams) {
        console.log(`Starting scheduled stream: ${stream.id} - ${stream.title}`);
        const result = await streamingService.startStream(stream.id);
        if (result.success) {
          console.log(`Successfully started scheduled stream: ${stream.id}`);
        } else {
          console.error(`Failed to start scheduled stream ${stream.id}: ${result.error}`);
        }
      }
    }
  } catch (error) {
    console.error('Error checking scheduled streams:', error);
  }
}
async function checkStreamDurations() {
  try {
    if (!streamingService) {
      console.error('StreamingService not initialized in scheduler');
      return;
    }
    const liveStreams = await Stream.findAll(null, 'live');
    for (const stream of liveStreams) {
      if (stream.duration && stream.start_time && !scheduledTerminations.has(stream.id)) {
        const startTime = new Date(stream.start_time);
        const durationMs = stream.duration * 60 * 1000;
        const shouldEndAt = new Date(startTime.getTime() + durationMs);
        const now = new Date();
        if (shouldEndAt <= now) {
          console.log(`Stream ${stream.id} exceeded duration, stopping now`);
          await streamingService.stopStream(stream.id);
        } else {
          const timeUntilEnd = shouldEndAt.getTime() - now.getTime();
          scheduleStreamTermination(stream.id, timeUntilEnd / 60000);
        }
      }
    }
  } catch (error) {
    console.error('Error checking stream durations:', error);
  }
}
function scheduleStreamTermination(streamId, durationMinutes) {
  if (!streamingService) {
    console.error('StreamingService not initialized in scheduler');
    return;
  }
  if (typeof durationMinutes !== 'number' || Number.isNaN(durationMinutes)) {
    console.error(`Invalid duration provided for stream ${streamId}: ${durationMinutes}`);
    return;
  }
  if (scheduledTerminations.has(streamId)) {
    clearTimeout(scheduledTerminations.get(streamId));
  }
  const clampedMinutes = Math.max(0, durationMinutes);
  const durationMs = clampedMinutes * 60 * 1000;
  console.log(`Scheduling termination for stream ${streamId} after ${clampedMinutes} minutes`);
  const timeoutId = setTimeout(async () => {
    try {
      console.log(`Terminating stream ${streamId} after ${clampedMinutes} minute duration`);
      await streamingService.stopStream(streamId);
      scheduledTerminations.delete(streamId);
    } catch (error) {
      console.error(`Error terminating stream ${streamId}:`, error);
    }
  }, durationMs);
  scheduledTerminations.set(streamId, timeoutId);
}
function cancelStreamTermination(streamId) {
  if (scheduledTerminations.has(streamId)) {
    clearTimeout(scheduledTerminations.get(streamId));
    scheduledTerminations.delete(streamId);
    console.log(`Cancelled scheduled termination for stream ${streamId}`);
    return true;
  }
  return false;
}
function handleStreamStopped(streamId) {
  return cancelStreamTermination(streamId);
}

function getJakartaDate(date = new Date()) {
  return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
}

async function checkAutoPlaylistSchedules() {
  try {
    if (!streamingService) {
      console.error('StreamingService not initialized in scheduler');
      return;
    }
    const jakartaNow = getJakartaDate();
    const dayOfWeek = jakartaNow.getDay();
    const currentMinutes = jakartaNow.getHours() * 60 + jakartaNow.getMinutes();
    const liveStreams = await Stream.findAll(null, 'live');
    for (const stream of liveStreams) {
      if (!stream.auto_playlist_mode) {
        continue;
      }
      const activeSchedule = await PlaylistSchedule.findActiveSchedule(stream.id, dayOfWeek, currentMinutes);
      if (!activeSchedule) {
        continue;
      }
      if (autoPlaylistLocks.has(stream.id)) {
        continue;
      }
      if (stream.video_id === activeSchedule.playlist_id) {
        continue;
      }
      autoPlaylistLocks.add(stream.id);
      try {
        console.log(`[Scheduler] Switching stream ${stream.id} to playlist ${activeSchedule.playlist_id} (auto schedule)`);
        const result = await streamingService.switchPlaylist(stream.id, activeSchedule.playlist_id);
        if (!result.success) {
          console.error(`[Scheduler] Failed to switch playlist for stream ${stream.id}: ${result.error}`);
        }
      } catch (error) {
        console.error(`[Scheduler] Error switching playlist for stream ${stream.id}:`, error);
      } finally {
        autoPlaylistLocks.delete(stream.id);
      }
    }
  } catch (error) {
    console.error('Error checking auto playlist schedules:', error);
  }
}
module.exports = {
  init,
  scheduleStreamTermination,
  cancelStreamTermination,
  handleStreamStopped
};
