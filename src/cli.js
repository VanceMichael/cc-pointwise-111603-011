import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { RecordRepository } from './repository.js';
import { CollectionService } from './service.js';
import { readWeeklyReport } from './operations.js';

const here = dirname(fileURLToPath(import.meta.url));
const service = new CollectionService(new RecordRepository(resolve(here, '../var/records.json')));
const action = process.argv[2] ?? '--help';
if (action === '--help' || action === '-h') {
  console.log(JSON.stringify({
    usage: 'npm start -- ingest [文件] | query [来源] | report <截点ISO时间>',
    commands: ['ingest', 'query', 'report'],
  }));
  process.exit(0);
}
if (action === 'ingest') {
  const records = JSON.parse(await readFile(process.argv[3] ?? resolve(here, '../fixtures/records.json'), 'utf8'));
  console.log(JSON.stringify(await service.ingest(records), null, 2));
} else if (action === 'query') {
  console.log(JSON.stringify(await service.query({ source: process.argv[3] }), null, 2));
} else if (action === 'report') {
  const asOf = process.argv[3];
  if (!asOf || !Number.isFinite(Date.parse(asOf))) throw new Error('report requires an ISO cutoff timestamp, e.g. 2026-11-16T12:00:00Z');
  console.log(JSON.stringify(await readWeeklyReport(service.repository, { asOf, generatedAt: new Date().toISOString() }), null, 2));
} else {
  throw new Error('action must be ingest, query or report');
}
