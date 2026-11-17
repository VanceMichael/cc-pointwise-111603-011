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
const directory = await mkdtemp(join(tmpdir(), 'collection-demo-'));
const clocks = {
  opening: '2026-11-16T08:05:00Z',
  updated: '2026-11-16T09:05:00Z',
  revoked: '2026-11-17T08:30:00Z', // 撤销公告迟到：周报截点 2026-11-17T00:00:00Z 之后才采集到
};
try {
  const repository = new RecordRepository(join(directory, 'records.json'));
  const service = new CollectionService(repository);
  for (const stage of ['opening', 'updated', 'revoked']) {
    source.publish(stage);
    const page = parsePage(await new SourceClient(source.url).read(entryPath));
    await service.ingest(page.records.map((record) => ({ ...record, collectedAt: clocks[stage] })));
  }

  const cutoff = '2026-11-17T00:00:00Z';
  const view = await readOperations(repository, { cutoff });
  console.log(JSON.stringify({
    原始公示保留: view.rows.map((row) => row.sourceId),
    周报截点: cutoff,
    周报: view.weeklyReport.rows.map((row) => ({
      permitId: row.permitId,
      status: row.statusLabel,
      链: row.chain.map((entry) => `${entry.sourceId}:${entry.relationLabel}`),
      解释: row.explanation,
    })),
    截点后才补来: view.weeklyReport.lateNotices.map((item) => item.sourceId),
  }, null, 2));
} finally { await source.close(); await rm(directory, { recursive: true, force: true }); }
