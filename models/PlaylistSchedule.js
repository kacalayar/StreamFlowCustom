const { db } = require('../db/database');
const { v4: uuidv4 } = require('uuid');

const OVERLAP_ERROR_CODE = 'SCHEDULE_OVERLAP';

function toMinutes(timeStr) {
  if (typeof timeStr !== 'string') {
    throw new Error('Invalid time format');
  }
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw new Error('Invalid time format');
  }
  return hours * 60 + minutes;
}

function toScheduleRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    auto_playlist_mode: undefined,
    start_minutes: row.start_minutes,
    end_minutes: row.end_minutes
  };
}

function intervalsFromRange(start, end) {
  if (start <= end) {
    return [[start, end]];
  }
  return [
    [start, 1440],
    [0, end]
  ];
}

function intervalsOverlap(intervalA, intervalB) {
  return intervalA[0] < intervalB[1] && intervalB[0] < intervalA[1];
}

function rangeOverlaps(startA, endA, startB, endB) {
  const intervalsA = intervalsFromRange(startA, endA);
  const intervalsB = intervalsFromRange(startB, endB);
  return intervalsA.some(interval1 => intervalsB.some(interval2 => intervalsOverlap(interval1, interval2)));
}

function normalizeDay(day) {
  return ((day % 7) + 7) % 7;
}

function splitDayRanges(day, start, end) {
  const normalizedDay = normalizeDay(day);
  if (start <= end) {
    return [{ day: normalizedDay, start, end }];
  }
  return [
    { day: normalizedDay, start, end: 1440 },
    { day: normalizeDay(normalizedDay + 1), start: 0, end }
  ];
}

class PlaylistSchedule {
  static findById(id) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT ps.*, p.name AS playlist_name
         FROM playlist_schedules ps
         LEFT JOIN playlists p ON ps.playlist_id = p.id
         WHERE ps.id = ?`,
        [id],
        (err, row) => {
        if (err) {
          return reject(err);
        }
        resolve(toScheduleRow(row));
      });
    });
  }

  static findByStream(streamId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT ps.*, p.name AS playlist_name
         FROM playlist_schedules ps
         LEFT JOIN playlists p ON ps.playlist_id = p.id
         WHERE ps.stream_id = ?
         ORDER BY ps.day_of_week ASC, ps.start_minutes ASC`,
        [streamId],
        (err, rows) => {
          if (err) {
            return reject(err);
          }
          resolve(rows.map(toScheduleRow));
        }
      );
    });
  }

  static findActiveSchedule(streamId, dayOfWeek, minutes) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT ps.*, p.name AS playlist_name
         FROM playlist_schedules ps
         LEFT JOIN playlists p ON ps.playlist_id = p.id
         WHERE ps.stream_id = ?
           AND ps.day_of_week = ?
           AND (
             (ps.start_minutes <= ps.end_minutes AND ? >= ps.start_minutes AND ? < ps.end_minutes)
             OR
             (ps.start_minutes > ps.end_minutes AND (? >= ps.start_minutes OR ? < ps.end_minutes))
           )
         ORDER BY ps.priority DESC, ps.start_minutes ASC
         LIMIT 1`,
        [streamId, dayOfWeek, minutes, minutes, minutes, minutes],
        (err, row) => {
          if (err) {
            return reject(err);
          }
          resolve(toScheduleRow(row));
        }
      );
    });
  }

  static ensureNoOverlap(streamId, dayOfWeek, startMinutes, endMinutes, excludeId = null) {
    return new Promise((resolve, reject) => {
      const params = [streamId];
      let query = `SELECT id, day_of_week, start_minutes, end_minutes FROM playlist_schedules WHERE stream_id = ?`;
      if (excludeId) {
        query += ' AND id != ?';
        params.push(excludeId);
      }
      db.all(query, params, (err, rows) => {
        if (err) {
          return reject(err);
        }
        const newRanges = splitDayRanges(dayOfWeek, startMinutes, endMinutes);
        const hasOverlap = rows.some(row => {
          const existingRanges = splitDayRanges(row.day_of_week, row.start_minutes, row.end_minutes);
          return existingRanges.some(existingRange =>
            newRanges.some(newRange =>
              existingRange.day === newRange.day &&
              rangeOverlaps(newRange.start, newRange.end, existingRange.start, existingRange.end)
            )
          );
        });
        if (hasOverlap) {
          const error = new Error('Jadwal bertabrakan dengan slot lain pada hari yang sama');
          error.code = OVERLAP_ERROR_CODE;
          return reject(error);
        }
        resolve(true);
      });
    });
  }

  static async create(scheduleData) {
    const id = uuidv4();
    const startMinutes = toMinutes(scheduleData.start_time);
    const endMinutes = toMinutes(scheduleData.end_time);
    await PlaylistSchedule.ensureNoOverlap(scheduleData.stream_id, scheduleData.day_of_week, startMinutes, endMinutes);
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO playlist_schedules (
          id, stream_id, playlist_id, day_of_week,
          start_time, end_time, start_minutes, end_minutes, priority
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          scheduleData.stream_id,
          scheduleData.playlist_id,
          scheduleData.day_of_week,
          scheduleData.start_time,
          scheduleData.end_time,
          startMinutes,
          endMinutes,
          scheduleData.priority || 0
        ],
        function (err) {
          if (err) {
            return reject(err);
          }
          resolve({ id, ...scheduleData, start_minutes: startMinutes, end_minutes: endMinutes });
        }
      );
    });
  }

  static async update(id, scheduleData) {
    const existing = await PlaylistSchedule.findById(id);
    if (!existing) {
      throw new Error('Schedule not found');
    }
    const fields = [];
    const values = [];

    let targetDay = existing.day_of_week;
    let targetStart = existing.start_minutes;
    let targetEnd = existing.end_minutes;
    let targetStartTime = existing.start_time;
    let targetEndTime = existing.end_time;

    if (scheduleData.playlist_id) {
      fields.push('playlist_id = ?');
      values.push(scheduleData.playlist_id);
    }
    if (scheduleData.day_of_week !== undefined) {
      fields.push('day_of_week = ?');
      values.push(scheduleData.day_of_week);
      targetDay = scheduleData.day_of_week;
    }
    if (scheduleData.start_time) {
      const startMinutes = toMinutes(scheduleData.start_time);
      fields.push('start_time = ?', 'start_minutes = ?');
      values.push(scheduleData.start_time, startMinutes);
      targetStart = startMinutes;
      targetStartTime = scheduleData.start_time;
    }
    if (scheduleData.end_time) {
      const endMinutes = toMinutes(scheduleData.end_time);
      fields.push('end_time = ?', 'end_minutes = ?');
      values.push(scheduleData.end_time, endMinutes);
      targetEnd = endMinutes;
      targetEndTime = scheduleData.end_time;
    }
    if (scheduleData.priority !== undefined) {
      fields.push('priority = ?');
      values.push(scheduleData.priority);
    }

    if (fields.length === 0) {
      return Promise.resolve({ id, ...scheduleData });
    }

    await PlaylistSchedule.ensureNoOverlap(existing.stream_id, targetDay, targetStart, targetEnd, id);

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE playlist_schedules SET ${fields.join(', ')} WHERE id = ?`,
        values,
        function (err) {
          if (err) {
            return reject(err);
          }
          resolve({
            id,
            ...scheduleData,
            day_of_week: targetDay,
            start_time: targetStartTime,
            end_time: targetEndTime,
            start_minutes: targetStart,
            end_minutes: targetEnd
          });
        }
      );
    });
  }

  static delete(id) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM playlist_schedules WHERE id = ?', [id], function (err) {
        if (err) {
          return reject(err);
        }
        resolve({ deleted: this.changes > 0 });
      });
    });
  }
}

module.exports = PlaylistSchedule;
module.exports.OVERLAP_ERROR_CODE = OVERLAP_ERROR_CODE;
