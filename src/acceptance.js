import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSource } from '../source/server.js';
import { SourceClient } from './source-client.js';
import { parsePage, entryPath } from './adapter.js';
import { RecordRepository } from './repository.js';
import { CollectionService } from './service.js';
import { readOperations } from './operations.js';

const source = await startSource(new URL('../fixtures/source.json', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'collection-acceptance-'));
try {
  const repository = new RecordRepository(join(directory, 'records.json'));
  const clocks = {
    opening: '2026-11-16T08:05:00Z',
    updated: '2026-11-16T09:05:00Z',
    revoked: '2026-11-17T08:30:00Z',
  };
  // 注入时钟：获知时间由场景决定，验收不依赖真实墙钟。
  const service = new CollectionService(repository, () => clocks.opening);
  const firstPage = parsePage(await new SourceClient(source.url).read(entryPath));
  assert.ok(firstPage.records.length > 0, '初始来源须有可接收的业务记录');
  const first = await service.ingest(firstPage.records);
  assert.equal(first.accepted, firstPage.records.length);
  const stored = await repository.read();
  const reopenedRepository = new RecordRepository(join(directory, 'records.json'));
  assert.deepEqual(await new CollectionService(reopenedRepository).query({}), stored, '重新打开后读取同一份业务记录');
  const second = await new CollectionService(reopenedRepository).ingest(firstPage.records);
  assert.equal(second.stored, stored.length, '重放首批记录不重复保存');

  // 后续采集：更正在周报截点前到达，撤销在截点后才被本地获知。
  for (const stage of ['updated', 'revoked']) {
    source.publish(stage);
    const page = parsePage(await new SourceClient(source.url).read(entryPath));
    const stageService = new CollectionService(reopenedRepository, () => clocks[stage]);
    await stageService.ingest(page.records);
  }
  const allRecords = await reopenedRepository.read();
  assert.deepEqual(allRecords.map((record) => record.sourceId), ['N1', 'N2', 'N3'], '每份原始公示独立保留');

  const cutoff = '2026-11-17T00:00:00Z';
  const operations = await readOperations(reopenedRepository, { cutoff });
  assert.deepEqual(operations.rows.map(row => row.sourceId), allRecords.map(row => row.sourceId));
  for (const row of operations.rows) {
    const original = allRecords.find(record => record.sourceId === row.sourceId);
    assert.equal(row.source, original.source);
    assert.equal(row.observedAt, original.observedAt);
  }
  const historical = operations.weeklyReport;
  assert.equal(historical.rows.length, 1, '一条许可在周报只占一行');
  assert.equal(historical.rows[0].status, 'corrected', '截点当时尚未获知撤销，历史周报不被事后改写');
  assert.deepEqual(historical.lateNotices.map((item) => item.sourceId), ['N3']);
  assert.deepEqual(historical.rows[0].chain.map((entry) => entry.sourceId), ['N1', 'N2']);

  const current = (await readOperations(reopenedRepository, { cutoff: '2026-11-18T00:00:00Z' })).weeklyReport;
  assert.equal(current.rows[0].status, 'revoked', '撤销被获知后的下一个截点呈现终态');
  assert.equal(current.lateNotices.length, 0);

  console.log(JSON.stringify({
    accepted: first.accepted, persisted: stored.length, replayStored: second.stored,
    operationRows: operations.rows.length, lateNotices: historical.lateNotices.length,
    historicalStatus: historical.rows[0].status, currentStatus: current.rows[0].status, status: 'ok',
  }));
} finally {
  await source.close();
  await rm(directory, {recursive: true, force: true});
}
