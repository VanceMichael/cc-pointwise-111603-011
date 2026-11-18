import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSource } from '../source/server.js';
import { SourceClient } from '../src/source-client.js';
import { parsePage, entryPath } from '../src/adapter.js';
import { RecordRepository } from '../src/repository.js';
import { CollectionService } from '../src/service.js';
import { readWeeklyReport, readOperations } from '../src/operations.js';

const scenarioPath = new URL('../fixtures/weekly-source.json', import.meta.url);

// 用注入时钟模拟各阶段采集时刻，无需等待真实时间。
function clockedService(repository, clock) {
  return new CollectionService(repository, clock);
}

test('周报接入采集：截点状态、迟到撤销与列表换序均符合双时间轴规则', async () => {
  const source = await startSource(scenarioPath);
  const directory = await mkdtemp(join(tmpdir(), 'weekly-integration-'));
  try {
    const client = new SourceClient(source.url);
    const repository = new RecordRepository(join(directory, 'records.json'));

    source.publish('opening');
    await clockedService(repository, () => '2026-11-16T08:30:00Z')
      .ingest(parsePage(await client.read(entryPath)).records);

    source.publish('corrected');
    await clockedService(repository, () => '2026-11-16T09:30:00Z')
      .ingest(parsePage(await client.read(entryPath)).records);

    // 10:00 公告撤销，但 11:00 截点时本地尚未采到。
    source.publish('revoked');
    const cutoff = '2026-11-16T11:00:00Z';
    const reportAtEleven = await readWeeklyReport(repository, { asOf: cutoff });
    assert.equal(reportAtEleven.permits.length, 1);
    assert.equal(reportAtEleven.permits[0].status, 'active', '迟到撤销不能提前生效');
    assert.deepEqual(reportAtEleven.permits[0].chain.map((entry) => entry.noticeId), ['W1', 'W2']);

    // 11:30 才采到撤销公告；原始公示全部保留。
    await clockedService(repository, () => '2026-11-16T11:30:00Z')
      .ingest(parsePage(await client.read(entryPath)).records);
    const stored = await repository.read();
    assert.deepEqual(stored.map((record) => record.sourceId), ['W1', 'W2', 'W3'], '每份原始公示都保留');

    const reportAtNoon = await readWeeklyReport(repository, { asOf: cutoff });
    const row = reportAtNoon.permits[0];
    assert.equal(row.status, 'active', '同一历史截点重放结果不变：当时不知道的撤销仍不参与');
    assert.deepEqual(reportAtNoon.arrivedAfterCutoff.map((entry) => entry.noticeId), ['W3']);
    assert.equal(reportAtNoon.arrivedAfterCutoff[0].knowledge, 'arrived-after-cutoff');

    const laterReport = await readWeeklyReport(repository, { asOf: '2026-11-16T12:00:00Z' });
    assert.equal(laterReport.permits[0].status, 'revoked');
    assert.deepEqual(laterReport.permits[0].chain.map((entry) => entry.noticeId), ['W1', 'W2', 'W3']);

    // 列表换序：同一批记录以不同顺序再采一次，报告结果保持一致。
    source.publish('reordered');
    await clockedService(repository, () => '2026-11-16T12:30:00Z')
      .ingest(parsePage(await client.read(entryPath)).records);
    const afterReorder = await readWeeklyReport(repository, { asOf: '2026-11-16T12:00:00Z' });
    assert.deepEqual(afterReorder, laterReport, '列表换序不改变折叠结果');
    assert.equal((await repository.read()).length, 3, '重放不产生重复原始记录');

    // 业务读取入口仍能看到一致状态，且带采集知晓时间。
    const operations = await readOperations(repository);
    assert.equal(operations.rows.length, 3);
    assert.ok(operations.rows.every((item) => item.collectedAt && item.attributes.replaces !== undefined));
  } finally {
    await source.close();
    await rm(directory, { recursive: true, force: true });
  }
});
