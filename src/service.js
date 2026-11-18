import { findRecords, mergeRecords, normalizeRecord } from './records.js';

export class CollectionService {
  // clock 可注入，便于测试确定性地模拟采集时刻；默认使用系统时钟。
  constructor(repository, clock = () => new Date().toISOString()) {
    this.repository = repository;
    this.clock = clock;
  }

  async ingest(inputs) {
    if (!Array.isArray(inputs)) throw new TypeError('ingest input must be an array');
    const now = this.clock();
    if (!Number.isFinite(Date.parse(now))) throw new Error('clock returned an invalid timestamp');
    const accepted = inputs.map((input) => ({ ...normalizeRecord(input), collectedAt: now }));
    const current = await this.repository.read();
    const merged = mergeRecords(current, accepted);
    await this.repository.replace(merged);
    return { accepted: accepted.length, stored: merged.length };
  }

  async query(filters) { return findRecords(await this.repository.read(), filters); }
}
