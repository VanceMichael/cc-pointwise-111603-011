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
  return record;
}

export function mergeRecords(existing, incoming) {
  const merged = new Map(existing.map((record) => [record.sourceId, record]));
  for (const record of incoming) {
    const current = merged.get(record.sourceId);
    if (!current) {
      merged.set(record.sourceId, record);
      continue;
    }
    // collectedAt 保留本地最早知晓时刻，与记录内容新旧无关：
    // 重放或后续观察不能把"后来才知道"伪装成"一直知道"。
    const earliestKnown = [current.collectedAt ?? current.observedAt, record.collectedAt ?? record.observedAt]
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
    // 记录内容仍以来源公告时间 observedAt 决定新旧。
    const base = Date.parse(record.observedAt) >= Date.parse(current.observedAt) ? record : current;
    merged.set(record.sourceId, { ...base, collectedAt: earliestKnown });
  }
  // 兼容采集时间改造前写入的历史记录：回退为来源公告时间，不臆造更早的知晓时刻。
  for (const record of merged.values()) {
    if (!record.collectedAt) record.collectedAt = record.observedAt;
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
