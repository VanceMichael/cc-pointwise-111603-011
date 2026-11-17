import { schema } from './schema.js';

export function normalizeRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`${schema.entity} must be an object`);
  }
  const record = {
    sourceId: String(input.sourceId ?? '').trim(),
    source: String(input.source ?? '').trim(),
    observedAt: String(input.observedAt ?? '').trim(),
    label: String(input.label ?? '').trim(),
    attributes: input.attributes && typeof input.attributes === 'object' && !Array.isArray(input.attributes)
      ? structuredClone(input.attributes) : {},
  };
  for (const field of schema.required) {
    if (!record[field]) throw new Error(`missing ${field} for ${schema.entity}`);
  }
  if (!Number.isFinite(Date.parse(record.observedAt))) {
    throw new Error(`invalid observedAt for ${schema.entity}`);
  }
  // collectedAt 是本地实际采集时刻，用于截点报告区分“当时已知”与“后来补来”。
  // 与公告自身的 publishedAt/observedAt 分开保留；缺省时回退到 observedAt 以兼容历史集合。
  const collectedAt = String(input.collectedAt ?? '').trim() || record.observedAt;
  if (!Number.isFinite(Date.parse(collectedAt))) {
    throw new Error(`invalid collectedAt for ${schema.entity}`);
  }
  record.collectedAt = collectedAt;
  return record;
}

export function mergeRecords(existing, incoming) {
  const merged = new Map(existing.map((record) => [record.sourceId, record]));
  for (const record of incoming) {
    const current = merged.get(record.sourceId);
    if (!current || Date.parse(record.observedAt) >= Date.parse(current.observedAt)) {
      // 本地首次获知时间取最早观察，重放或迟到采集不会把已知记录伪装成“更晚才知道”。
      if (current?.collectedAt && Date.parse(current.collectedAt) < Date.parse(record.collectedAt)) {
        record.collectedAt = current.collectedAt;
      }
      merged.set(record.sourceId, record);
    } else if (current && Date.parse(record.collectedAt) < Date.parse(current.collectedAt)) {
      // 较旧的观察仍可能补来更早的获知时间。
      current.collectedAt = record.collectedAt;
    }
  }
  return [...merged.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

export function findRecords(records, { source, from, to } = {}) {
  return records.filter((record) => {
    if (source && record.source !== source) return false;
    const timestamp = Date.parse(record.observedAt);
    if (from && timestamp < Date.parse(from)) return false;
    if (to && timestamp > Date.parse(to)) return false;
    return true;
  });
}
