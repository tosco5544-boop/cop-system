import { json, jstDate, nowIso } from '../../../lib/util.js';
import { findCurrentDay, dayState } from '../../../lib/attendance.js';

export async function onRequestGet({ env, data }) {
  const day = await findCurrentDay(env, data.user.id);
  return json({ day: day || null, state: dayState(day), today: jstDate(), server_time: nowIso() });
}
