import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyReport } from '../src/weekly-report.js';

function record(noticeId, attrs, collectedAt) {
  const attributes = { noticeId, ...attrs };
  return {
    sourceId: noticeId,
    source: '建设许可公告目录',
    observedAt: attrs.publishedAt,
    collectedAt,
    label: attrs.title,
    attributes,
  };
}

const grant = (noticeId, permitId, at, collectedAt = at, extra = {}) => record(noticeId, {
  permitId, title: '项目许可', action: 'grant',
  publishedAt: at, effectiveAt: at, ...extra,
}, collectedAt);

const correct = (noticeId, permitId, replaces, publishedAt, effectiveAt, collectedAt = publishedAt, extra = {}) => record(noticeId, {
  permitId, title: '项目许可更正', action: 'correct', replaces,
  publishedAt, effectiveAt, ...extra,
}, collectedAt);

const revoke = (noticeId, permitId, replaces, at, collectedAt = at, extra = {}) => record(noticeId, {
  permitId, title: '撤销许可', action: 'revoke', replaces,
  publishedAt: at, effectiveAt: at, ...extra,
}, collectedAt);

test('完整 grant-correct-revoke 链在截点折叠成单行且状态为已撤销', () => {
  const records = [
    grant('N1', 'P1', '2026-11-16T08:00:00Z'),
    correct('N2', 'P1', 'N1', '2026-11-16T09:00:00Z', '2026-11-16T08:00:00Z'),
    revoke('N3', 'P1', 'N2', '2026-11-16T10:00:00Z', '2026-11-16T10:00:00Z'),
  ];
  const report = buildWeeklyReport(records, { asOf: '2026-11-16T12:00:00Z' });
  assert.equal(report.permits.length, 1, '同一许可不得因多条公告占多行');
  const row = report.permits[0];
  assert.equal(row.permitId, 'P1');
  assert.equal(row.status, 'revoked');
  assert.equal(row.statusText, '已撤销');
  assert.equal(row.needsReview, false);
  assert.deepEqual(row.chain.map((entry) => entry.noticeId), ['N1', 'N2', 'N3']);
  assert.deepEqual(row.chain.map((entry) => entry.replaces), [null, 'N1', 'N2']);
  assert.deepEqual(row.chain.map((entry) => entry.action), ['grant', 'correct', 'revoke']);
  assert.ok(row.chain.every((entry) => entry.knowledge === 'known-at-cutoff'));
});

test('截点时只依据当时已采集到的公告，迟到的撤销不改变状态且单列说明', () => {
  const records = [
    grant('N1', 'P1', '2026-11-16T08:00:00Z'),
    revoke('N3', 'P1', 'N1', '2026-11-16T10:00:00Z', '2026-11-16T11:30:00Z'),
  ];
  const atCutoff = buildWeeklyReport(records, { asOf: '2026-11-16T11:00:00Z' });
  assert.equal(atCutoff.permits[0].status, 'active', '撤销公告截点后才采到，许可仍为有效');
  assert.deepEqual(atCutoff.permits[0].chain.map((entry) => entry.noticeId), ['N1']);
  assert.deepEqual(atCutoff.arrivedAfterCutoff.map((entry) => entry.noticeId), ['N3']);
  assert.equal(atCutoff.arrivedAfterCutoff[0].knowledge, 'arrived-after-cutoff');

  const later = buildWeeklyReport(records, { asOf: '2026-11-16T12:00:00Z' });
  assert.equal(later.permits[0].status, 'revoked', '更晚截点纳入补采公告后状态变为已撤销');
  assert.equal(later.arrivedAfterCutoff.length, 0);
});

test('更正公告可追溯生效到更早时间，但截点前尚未知晓时不参与状态', () => {
  const records = [
    grant('N1', 'P1', '2026-11-16T08:00:00Z'),
    correct('N2', 'P1', 'N1', '2026-11-16T09:00:00Z', '2026-11-16T08:00:00Z', '2026-11-16T09:30:00Z'),
  ];
  const before = buildWeeklyReport(records, { asOf: '2026-11-16T09:00:00Z' });
  assert.deepEqual(before.permits[0].chain.map((entry) => entry.noticeId), ['N1']);
  const after = buildWeeklyReport(records, { asOf: '2026-11-16T10:00:00Z' });
  const correction = after.permits[0].chain.find((entry) => entry.noticeId === 'N2');
  assert.equal(correction.knowledge, 'known-at-cutoff');
  assert.equal(correction.effectiveAtCutoff, 'effective-at-cutoff', 'effectiveAt 早于截点即视为在截点已生效');
});

test('已公告但 effectiveAt 在截点之后的许可不提前变成有效', () => {
  const records = [grant('N1', 'P9', '2026-11-20T08:00:00Z', '2026-11-16T08:00:00Z')];
  const report = buildWeeklyReport(records, { asOf: '2026-11-16T12:00:00Z' });
  assert.equal(report.permits[0].status, 'unknown');
  assert.equal(report.permits[0].chain[0].effectiveAtCutoff, 'effective-after-cutoff');
});

test('标题相同但 permitId 不同的公告绝不按相似度合并', () => {
  const records = [
    grant('N1', 'P1', '2026-11-16T08:00:00Z'),
    grant('N2', 'P2', '2026-11-16T08:30:00Z'),
  ];
  const report = buildWeeklyReport(records, { asOf: '2026-11-16T12:00:00Z' });
  assert.deepEqual(report.permits.map((row) => row.permitId), ['P1', 'P2']);
});

test('缺少 replaces 声明的更正保留为待人工核对而不是按标题硬并', () => {
  const records = [
    grant('N1', 'P1', '2026-11-16T08:00:00Z'),
    correct('N2', 'P1', null, '2026-11-16T09:00:00Z', '2026-11-16T09:00:00Z'),
  ];
  const row = buildWeeklyReport(records, { asOf: '2026-11-16T12:00:00Z' }).permits[0];
  assert.equal(row.needsReview, true);
  assert.ok(row.reviewNotes.some((note) => note.code === 'missing-replaces-declaration'));
  assert.deepEqual(row.chain.map((entry) => entry.noticeId), ['N1', 'N2']);
});

test('replaces 指向缺失公告或跨许可时标记待核对', () => {
  const missing = [
    grant('N1', 'P1', '2026-11-16T08:00:00Z'),
    revoke('N9', 'P1', 'N404', '2026-11-16T10:00:00Z'),
  ];
  const row = buildWeeklyReport(missing, { asOf: '2026-11-16T12:00:00Z' }).permits[0];
  assert.ok(row.reviewNotes.some((note) => note.code === 'replaces-target-missing'));

  const cross = [
    grant('N1', 'P1', '2026-11-16T08:00:00Z'),
    grant('N2', 'P2', '2026-11-16T08:30:00Z'),
    revoke('N3', 'P2', 'N1', '2026-11-16T10:00:00Z'),
  ];
  const report = buildWeeklyReport(cross, { asOf: '2026-11-16T12:00:00Z' });
  const p2 = report.permits.find((item) => item.permitId === 'P2');
  assert.ok(p2.reviewNotes.some((note) => note.code === 'replaces-cross-permit'));
});

test('环形 replaces 声明被检测并保持待核对，状态仍按生效时间确定性计算', () => {
  const records = [
    { ...grant('N1', 'P1', '2026-11-16T08:00:00Z'), attributes: { ...grant('N1', 'P1', '2026-11-16T08:00:00Z').attributes, replaces: 'N2' } },
    correct('N2', 'P1', 'N1', '2026-11-16T09:00:00Z', '2026-11-16T09:00:00Z'),
  ];
  const row = buildWeeklyReport(records, { asOf: '2026-11-16T12:00:00Z' }).permits[0];
  assert.ok(row.reviewNotes.some((note) => note.code === 'cyclic-replaces-chain'));
  assert.equal(row.status, 'active');
});

test('撤销是终态：后续 grant/correct 不能让已撤销许可复活', () => {
  const records = [
    grant('N1', 'P1', '2026-11-16T08:00:00Z'),
    revoke('N2', 'P1', 'N1', '2026-11-16T10:00:00Z'),
    grant('N3', 'P1', '2026-11-16T11:00:00Z'),
  ];
  const report = buildWeeklyReport(records, { asOf: '2026-11-16T12:00:00Z' });
  assert.equal(report.permits[0].status, 'revoked');
  assert.ok(report.permits[0].reviewNotes.some((note) => note.code === 'event-after-revocation'));
});

test('撤销公告在输入中排在前面时终态依然成立，不依赖列表顺序', () => {
  const records = [
    revoke('N2', 'P1', 'N1', '2026-11-16T10:00:00Z'),
    grant('N3', 'P1', '2026-11-16T11:00:00Z'),
    grant('N1', 'P1', '2026-11-16T08:00:00Z'),
  ];
  const report = buildWeeklyReport(records, { asOf: '2026-11-16T12:00:00Z' });
  assert.equal(report.permits[0].status, 'revoked');
  assert.ok(report.permits[0].reviewNotes.some((note) => note.code === 'event-after-revocation'));
});

test('列表换序与迟到补采产生完全相同的截点结果', () => {
  const ordered = [
    grant('N1', 'P1', '2026-11-16T08:00:00Z'),
    correct('N2', 'P1', 'N1', '2026-11-16T09:00:00Z', '2026-11-16T08:00:00Z', '2026-11-16T09:30:00Z'),
    revoke('N3', 'P1', 'N2', '2026-11-16T10:00:00Z', '2026-11-16T10:00:00Z', '2026-11-16T11:30:00Z'),
  ];
  const shuffled = [ordered[2], ordered[0], ordered[1]];
  const options = { asOf: '2026-11-16T12:00:00Z' };
  assert.deepEqual(buildWeeklyReport(shuffled, options), buildWeeklyReport(ordered, options));
  assert.equal(buildWeeklyReport(ordered, options).permits[0].status, 'revoked');
});

test('没有 permitId 的公告独立成组并标记核对，不并入同名许可', () => {
  const records = [
    grant('N1', 'P1', '2026-11-16T08:00:00Z'),
    record('N2', { title: '项目许可', action: 'grant', publishedAt: '2026-11-16T09:00:00Z', effectiveAt: '2026-11-16T09:00:00Z' }, '2026-11-16T09:00:00Z'),
  ];
  const report = buildWeeklyReport(records, { asOf: '2026-11-16T12:00:00Z' });
  assert.equal(report.permits.length, 2);
  const unlinked = report.permits.find((row) => row.permitId === null);
  assert.ok(unlinked.needsReview);
  assert.ok(unlinked.reviewNotes.some((note) => note.code === 'missing-permit-id'));
});

test('截点参数必须是可解析时间', () => {
  assert.throws(() => buildWeeklyReport([], { asOf: 'not-a-date' }), /valid asOf/);
  assert.throws(() => buildWeeklyReport([], {}), /valid asOf/);
});

test('原始记录不被报告过程修改', () => {
  const original = grant('N1', 'P1', '2026-11-16T08:00:00Z');
  const snapshot = structuredClone(original);
  buildWeeklyReport([original], { asOf: '2026-11-16T12:00:00Z' });
  assert.deepEqual(original, snapshot);
});
