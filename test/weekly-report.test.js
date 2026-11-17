import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyReport } from '../src/weekly-report.js';

function notice(overrides) {
  const base = {
    noticeId: overrides.sourceId ?? overrides.noticeId,
    permitId: 'P1',
    title: '项目许可',
    action: 'grant',
    publishedAt: '2026-11-16T08:00:00Z',
    effectiveAt: '2026-11-16T08:00:00Z',
    ...overrides,
  };
  return {
    sourceId: overrides.sourceId ?? base.noticeId,
    source: '建设许可公告目录',
    observedAt: base.publishedAt,
    collectedAt: overrides.collectedAt ?? base.publishedAt,
    label: base.title,
    attributes: base,
  };
}

const cutoff = '2026-11-17T00:00:00Z';

test('截点时只呈现许可的当前有效状态一行，并保留完整更正链解释', () => {
  const records = [
    notice({ noticeId: 'N1', action: 'grant' }),
    notice({ noticeId: 'N2', action: 'correct', replaces: 'N1', title: '项目许可更正',
      publishedAt: '2026-11-16T09:00:00Z', effectiveAt: '2026-11-16T08:00:00Z' }),
  ];
  const report = buildWeeklyReport(records, cutoff);
  assert.equal(report.rows.length, 1);
  const row = report.rows[0];
  assert.equal(row.permitId, 'P1');
  assert.equal(row.status, 'corrected');
  assert.equal(row.valid, true);
  assert.equal(row.head.sourceId, 'N2');
  assert.deepEqual(row.chain.map((entry) => entry.sourceId), ['N1', 'N2']);
  assert.equal(row.chain[1].relation, 'correct');
  assert.match(row.explanation, /N2/);
  assert.match(row.explanation, /替代公示 N1/);
});

test('撤销是终态：迟到或换序出现的公示不会让已撤销许可恢复有效', () => {
  const grant = notice({ noticeId: 'N1', action: 'grant' });
  const correction = notice({ noticeId: 'N2', action: 'correct', replaces: 'N1',
    publishedAt: '2026-11-16T09:00:00Z', effectiveAt: '2026-11-16T08:00:00Z' });
  const revocation = notice({ noticeId: 'N3', action: 'revoke', replaces: 'N2',
    title: '撤销许可', publishedAt: '2026-11-16T10:00:00Z', effectiveAt: '2026-11-16T10:00:00Z' });

  const shuffled = [revocation, grant, correction];
  const report = buildWeeklyReport(shuffled, cutoff);
  assert.equal(report.rows.length, 1);
  const row = report.rows[0];
  assert.equal(row.status, 'revoked');
  assert.equal(row.valid, false);
  assert.equal(row.head.sourceId, 'N3');
  assert.deepEqual(row.chain.map((entry) => entry.sourceId), ['N1', 'N2', 'N3']);

  // 撤销后又出现的公示（无论采集先后）都不能覆盖终态链头。
  const laterCorrection = notice({ noticeId: 'N4', action: 'correct',
    title: '撤销后补来的更正', publishedAt: '2026-11-16T11:00:00Z',
    effectiveAt: '2026-11-16T11:00:00Z', collectedAt: '2026-11-16T12:00:00Z' });
  const extended = buildWeeklyReport([grant, correction, revocation, laterCorrection], cutoff);
  assert.equal(extended.rows[0].status, 'review', '终态撤销不会复活，但来源未声明关联必须转人工核对');
  assert.equal(extended.rows[0].valid, false);
  assert.equal(extended.rows[0].head, null, '关联不足时不伪造唯一链头');
  assert.ok(extended.rows[0].chain.some((entry) => entry.sourceId === 'N3'), '撤销公示仍保留在链上');
  assert.ok(extended.rows[0].review.some((item) => item.code === 'multiple-effective-roots'),
    '来源未声明 N4 与撤销链的关系时必须留给人工核对');
});

test('截点之后才采集到的公示进入 lateNotices，不参与当时状态判断', () => {
  const records = [
    notice({ noticeId: 'N1', action: 'grant' }),
    notice({ noticeId: 'N3', action: 'revoke', replaces: 'N1', title: '撤销许可',
      publishedAt: '2026-11-16T10:00:00Z', effectiveAt: '2026-11-16T10:00:00Z',
      collectedAt: '2026-11-17T09:00:00Z' }),
  ];
  const report = buildWeeklyReport(records, cutoff);
  assert.equal(report.rows[0].status, 'granted', '截点当时不知道撤销，许可仍有效');
  assert.equal(report.lateNotices.length, 1);
  assert.equal(report.lateNotices[0].sourceId, 'N3');
  assert.equal(report.basis.knownNoticeCount, 1);
  assert.equal(report.basis.lateNoticeCount, 1);
});

test('标题相同但来源未给出关联时不自动并项目，输出人工核对', () => {
  const records = [
    notice({ noticeId: 'N1', permitId: 'P1', title: '完全相同的标题' }),
    notice({ noticeId: 'N2', permitId: 'P1', title: '完全相同的标题',
      publishedAt: '2026-11-16T12:00:00Z', effectiveAt: '2026-11-16T12:00:00Z' }),
  ];
  const report = buildWeeklyReport(records, cutoff);
  const row = report.rows[0];
  assert.equal(row.status, 'review');
  assert.ok(row.review.some((item) => item.code === 'multiple-effective-roots'));
  assert.match(row.explanation, /待人工核对/);
});

test('环形 replaces 声明保持待核对，不猜测链方向', () => {
  const records = [
    notice({ noticeId: 'N1', action: 'grant' }),
    notice({ noticeId: 'N2', action: 'correct', replaces: 'N1',
      publishedAt: '2026-11-16T09:00:00Z', effectiveAt: '2026-11-16T09:00:00Z' }),
    notice({ noticeId: 'N3', action: 'correct', replaces: 'N4',
      publishedAt: '2026-11-16T10:00:00Z', effectiveAt: '2026-11-16T10:00:00Z' }),
    notice({ noticeId: 'N4', action: 'correct', replaces: 'N3',
      publishedAt: '2026-11-16T11:00:00Z', effectiveAt: '2026-11-16T11:00:00Z' }),
  ];
  const report = buildWeeklyReport(records, cutoff);
  const codes = report.rows[0].review.map((item) => item.code);
  assert.ok(codes.includes('replaces-cycle'), '环形声明本身必须暴露为待核对');
  assert.equal(report.rows[0].status, 'review');
});

test('替代目标缺失的断链声明进入人工核对', () => {
  const records = [
    notice({ noticeId: 'N2', action: 'correct', replaces: 'N-ghost',
      publishedAt: '2026-11-16T09:00:00Z', effectiveAt: '2026-11-16T09:00:00Z' }),
  ];
  const report = buildWeeklyReport(records, cutoff);
  assert.ok(report.rows[0].review.some((item) => item.code === 'replaces-target-missing'));
  assert.equal(report.rows[0].status, 'review');
});

test('跨许可的 replaces 声明不被采纳，进入人工核对', () => {
  const records = [
    notice({ noticeId: 'N1', permitId: 'P1', action: 'grant' }),
    notice({ noticeId: 'N2', permitId: 'P2', action: 'revoke', replaces: 'N1',
      title: '另一许可的撤销', publishedAt: '2026-11-16T09:00:00Z',
      effectiveAt: '2026-11-16T09:00:00Z' }),
  ];
  const report = buildWeeklyReport(records, cutoff);
  const p2 = report.rows.find((row) => row.permitId === 'P2');
  assert.ok(p2.review.some((item) => item.code === 'replaces-permit-mismatch'));
  assert.equal(p2.status, 'revoked', '链头撤销的终态语义保留，但跨许可关联同时暴露给人工核对');
  assert.equal(p2.valid, false);
  const p1 = report.rows.find((row) => row.permitId === 'P1');
  assert.equal(p1.status, 'granted', 'P1 不被别的许可的撤销影响');
});

test('缺少 permitId 的公示无法归入许可，进入顶层人工核对队列', () => {
  const records = [notice({ noticeId: 'N1', permitId: null })];
  const report = buildWeeklyReport(records, cutoff);
  assert.equal(report.rows.length, 0);
  assert.equal(report.reviewQueue[0].reason, 'missing-permit-id');
  assert.equal(report.reviewQueue[0].sourceId, 'N1');
});

test('截点时已知但尚未生效的公示进入 pendingNotices，不生成许可状态行', () => {
  const records = [
    notice({ noticeId: 'N1', action: 'grant',
      publishedAt: '2026-11-18T08:00:00Z', effectiveAt: '2026-11-18T08:00:00Z',
      collectedAt: '2026-11-16T12:00:00Z' }),
  ];
  const report = buildWeeklyReport(records, cutoff);
  assert.equal(report.rows.length, 0);
  assert.equal(report.pendingNotices[0].sourceId, 'N1');
});

test('不同许可按 permitId 各自成行，更正链不会串到其他许可', () => {
  const records = [
    notice({ noticeId: 'N1', permitId: 'P1', action: 'grant' }),
    notice({ noticeId: 'N2', permitId: 'P2', action: 'grant',
      publishedAt: '2026-11-16T09:00:00Z', effectiveAt: '2026-11-16T09:00:00Z' }),
    notice({ noticeId: 'N3', permitId: 'P2', action: 'revoke', replaces: 'N2',
      publishedAt: '2026-11-16T10:00:00Z', effectiveAt: '2026-11-16T10:00:00Z' }),
  ];
  const report = buildWeeklyReport(records, cutoff);
  assert.deepEqual(report.rows.map((row) => row.permitId), ['P1', 'P2']);
  assert.equal(report.rows[0].status, 'granted');
  assert.equal(report.rows[1].status, 'revoked');
});

test('更早的截点只依据当时已采集的集合重建，同一份原始集合可产出不同历史周报', () => {
  const records = [
    notice({ noticeId: 'N1', action: 'grant' }),
    notice({ noticeId: 'N2', action: 'correct', replaces: 'N1',
      publishedAt: '2026-11-16T09:00:00Z', effectiveAt: '2026-11-16T08:30:00Z',
      collectedAt: '2026-11-16T12:00:00Z' }),
  ];
  const early = buildWeeklyReport(records, '2026-11-16T11:00:00Z');
  assert.equal(early.rows[0].status, 'granted');
  assert.equal(early.rows[0].head.sourceId, 'N1');
  assert.equal(early.lateNotices[0].sourceId, 'N2');
  const later = buildWeeklyReport(records, cutoff);
  assert.equal(later.rows[0].status, 'corrected');
  assert.equal(later.lateNotices.length, 0);
});

test('非法截点被明确拒绝', () => {
  assert.throws(() => buildWeeklyReport([], 'not-a-timestamp'), /cutoff/);
});

test('缺少生效时间的公示不臆测生效顺序，整行转人工核对', () => {
  const records = [
    notice({ noticeId: 'N1', action: 'grant', publishedAt: null, effectiveAt: null,
      collectedAt: '2026-11-16T08:00:00Z' }),
  ];
  records[0].observedAt = '2026-11-16T08:00:00Z';
  const report = buildWeeklyReport(records, cutoff);
  assert.equal(report.rows[0].status, 'review');
  assert.ok(report.rows[0].review.some((item) => item.code === 'missing-effective-time'));
});
