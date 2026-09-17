/**
 * 状态读写：已送过猫的名单、点名要猫的冷却记录。
 */

import { readFile, writeFile } from 'node:fs/promises';

const HOUR = 60 * 60 * 1000;

export async function loadJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

export async function saveJson(file, data) {
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** 某个用户在窗口期内已经要过几只猫 */
export function requestsInWindow(record, login, windowHours) {
  const cutoff = Date.now() - windowHours * HOUR;
  return (record[login] ?? []).filter((t) => Date.parse(t) >= cutoff);
}

/** 丢掉窗口期外的记录，避免文件无限增长 */
export function trimRequests(record, windowHours) {
  const cutoff = Date.now() - windowHours * HOUR;
  const out = {};
  for (const [login, times] of Object.entries(record)) {
    const kept = times.filter((t) => Date.parse(t) >= cutoff);
    if (kept.length) out[login] = kept;
  }
  return out;
}
