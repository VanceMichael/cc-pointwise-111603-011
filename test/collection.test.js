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
import { readOperations } from '../src/operations.js';

const scenarioPath = new URL('../fixtures/source.json', import.meta.url);
const weeklyCutoff = '2026-11-17T00:00:00Z';

async function collectAt(source, service, stage, clock) {
  source.publish(stage);
  const page = parsePage(await new SourceClient(source.url).read(entryPath));
  return service.ingest(page.records.map((record) => ({ ...record, collectedAt: clock })));
}

test('多阶段采集后，原始公示全部保留，周报只呈现截点有效状态与替代链解释', async () => {
  const source = await startSource(scenarioPath);
  const directory = await mkdtemp(join(tmpdir(), 'weekly-integration-'));
  try {
    const repository = new RecordRepository(join(directory, 'records.json'));
    const service = new CollectionService(repository);

    await collectAt(source, service, 'opening', '2026-11-16T08:05:00Z');
    const earlyView = (await readOperations(repository, { cutoff: weeklyCutoff })).weeklyReport;
    assert.equal(earlyView.rows[0].status, 'granted');

    await collectAt(source, service, 'updated', '2026-11-16T09:05:00Z');
    await collectAt(source, service, 'revoked', '2026-11-16T10:05:00Z');

    const records = await repository.read();
    assert.deepEqual(records.map((record) => record.sourceId), ['N1', 'N2', 'N3'], '每份原始公示独立保留，不覆盖不合并');

    const view = await readOperations(repository, { cutoff: weeklyCutoff });
    const report = view.weeklyReport;
    assert.equal(report.rows.length, 1, '一条许可在周报中只占一行');
    const row = report.rows[0];
    assert.equal(row.permitId, 'P1');
    assert.equal(row.status, 'revoked');
    assert.equal(row.valid, false);
    assert.equal(row.head.sourceId, 'N3');
    assert.deepEqual(row.chain.map((entry) => entry.sourceId), ['N1', 'N2', 'N3']);
    assert.deepEqual(row.chain.map((entry) => entry.relation), ['root', 'correct', 'revoke']);
    assert.match(row.explanation, /撤销/);
  } finally {
    await source.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('撤销公示迟到时，历史截点保持有效而当前截点显示已撤销', async () => {
  const source = await startSource(scenarioPath);
  const directory = await mkdtemp(join(tmpdir(), 'weekly-late-'));
  try {
    const repository = new RecordRepository(join(directory, 'records.json'));
    const service = new CollectionService(repository);
    await collectAt(source, service, 'opening', '2026-11-16T08:05:00Z');
    await collectAt(source, service, 'updated', '2026-11-16T09:05:00Z');

    // 撤销公告自身的时间戳在截点前，但本地截点之后才采集到。
    await collectAt(source, service, 'revoked', '2026-11-17T08:30:00Z');

    const historical = (await readOperations(repository, { cutoff: weeklyCutoff })).weeklyReport;
    assert.equal(historical.rows[0].status, 'corrected', '截点当时不知道撤销，不能事后改写历史周报');
    assert.deepEqual(historical.lateNotices.map((item) => item.sourceId), ['N3']);
    assert.match(historical.lateNotices[0].note, /截点之后/);

    const nextWeek = (await readOperations(repository, { cutoff: '2026-11-18T00:00:00Z' })).weeklyReport;
    assert.equal(nextWeek.rows[0].status, 'revoked');
    assert.equal(nextWeek.lateNotices.length, 0);
  } finally {
    await source.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('乱序采集（先见撤销后见原始公示）不会让已撤销许可复活', async () => {
  const source = await startSource(scenarioPath);
  const directory = await mkdtemp(join(tmpdir(), 'weekly-reorder-'));
  try {
    const repository = new RecordRepository(join(directory, 'records.json'));
    const service = new CollectionService(repository);
    await collectAt(source, service, 'revoked', '2026-11-16T10:05:00Z');
    await collectAt(source, service, 'updated', '2026-11-16T09:05:00Z');
    await collectAt(source, service, 'opening', '2026-11-16T08:05:00Z');

    const report = (await readOperations(repository, { cutoff: weeklyCutoff })).weeklyReport;
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].status, 'revoked');
    assert.deepEqual(report.rows[0].chain.map((entry) => entry.sourceId), ['N1', 'N2', 'N3']);
  } finally {
    await source.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('重放同一采集批次不重复保存，且获知时间保留最早观察', async () => {
  const source = await startSource(scenarioPath);
  const directory = await mkdtemp(join(tmpdir(), 'weekly-replay-'));
  try {
    const repository = new RecordRepository(join(directory, 'records.json'));
    const service = new CollectionService(repository);
    const first = await collectAt(source, service, 'opening', '2026-11-16T08:05:00Z');
    const replay = await collectAt(source, service, 'opening', '2026-11-18T00:00:00Z');
    assert.equal(first.stored, 1);
    assert.equal(replay.stored, 1, '重放不产生重复行');
    const [record] = await repository.read();
    assert.equal(record.collectedAt, '2026-11-16T08:05:00Z', '更晚的重放不能改写首次获知时间');
  } finally {
    await source.close();
    await rm(directory, { recursive: true, force: true });
  }
});
