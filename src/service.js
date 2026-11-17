import { findRecords, mergeRecords, normalizeRecord } from './records.js';

export class CollectionService {
  // clock 可注入，测试与回放场景不需要等待真实时间。
  constructor(repository, clock = () => new Date().toISOString()) {
    this.repository = repository;
    this.clock = clock;
  }

  async ingest(inputs) {
    if (!Array.isArray(inputs)) throw new TypeError('ingest input must be an array');
    const collectedAt = this.clock();
    const accepted = inputs.map((input) => normalizeRecord({ collectedAt, ...input }));
    const current = await this.repository.read();
    const merged = mergeRecords(current, accepted);
    await this.repository.replace(merged);
    return { accepted: accepted.length, stored: merged.length };
  }

  async query(filters) { return findRecords(await this.repository.read(), filters); }
}
