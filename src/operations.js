const fields = ["noticeId", "permitId", "title", "action", "publishedAt", "effectiveAt"];

export async function readOperations(repository) {
  const records = await repository.read();
  return { product: "建设许可公告目录", rows: records.map((record) => ({
    sourceId: record.sourceId,
    source: record.source,
    observedAt: record.observedAt,
    attributes: Object.fromEntries(fields.map((field) => [field, record.attributes[field] ?? null])),
  })) };
}
