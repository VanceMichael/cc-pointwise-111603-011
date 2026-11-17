import { buildWeeklyReport } from './weekly-report.js';

const fields = ["noticeId", "permitId", "title", "action", "publishedAt", "effectiveAt", "replaces"];

export async function readOperations(repository, options = {}) {
  const records = await repository.read();
  const view = {
    product: "建设许可公告目录",
    rows: records.map((record) => ({
      sourceId: record.sourceId,
      source: record.source,
      observedAt: record.observedAt,
      collectedAt: record.collectedAt ?? record.observedAt,
      attributes: Object.fromEntries(fields.map((field) => [field, record.attributes[field] ?? null])),
    })),
  };
  if (options.cutoff) view.weeklyReport = buildWeeklyReport(records, options.cutoff);
  return view;
}
