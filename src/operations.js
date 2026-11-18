import { buildWeeklyReport } from './weekly-report.js';

const fields = ["noticeId", "permitId", "title", "action", "publishedAt", "effectiveAt", "replaces"];

export async function readOperations(repository) {
  const records = await repository.read();
  return { product: "建设许可公告目录", rows: records.map((record) => ({
    sourceId: record.sourceId,
    source: record.source,
    observedAt: record.observedAt,
    collectedAt: record.collectedAt ?? record.observedAt,
    attributes: Object.fromEntries(fields.map((field) => [field, record.attributes[field] ?? null])),
  })) };
}

// 合规周报：按截点呈现当时有效的许可状态，并解释更正、替代、撤销关系。
// 原始公示仍由 repository 完整保留，这里只返回折叠后的解释视图。
export async function readWeeklyReport(repository, options) {
  return buildWeeklyReport(await repository.read(), options);
}
