// 截点周报：把原始公示按来源明确给出的身份与关联折叠成"截点时有效的许可状态"。
// 本模块是纯函数，不修改任何输入记录；关联证据不足时只标记 needsReview，不做相似标题合并。

const ACTIONS = new Set(['grant', 'correct', 'revoke']);
const RELATION_ACTIONS = new Set(['correct', 'revoke']);
const STATUS_TEXT = Object.freeze({
  active: '有效',
  revoked: '已撤销',
  unknown: '状态待核对',
});

function attribute(record, field) {
  const value = record.attributes?.[field];
  return value === undefined || value === null ? null : String(value);
}

function timestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// 公告被本地采集系统知晓的时间。collectedAt 由采集服务在接收时写入；
// 对采集时间改造前的历史记录回退使用来源公告时间，不把迟到记录伪装成早已知晓。
function knownAtOf(record) {
  return timestamp(record.collectedAt) ?? timestamp(record.observedAt);
}

function effectiveAtOf(record) {
  return timestamp(attribute(record, 'effectiveAt'));
}

function publishedAtOf(record) {
  return timestamp(attribute(record, 'publishedAt')) ?? timestamp(record.observedAt);
}

// 收集单条公告层面的关联问题；这些问题不阻止状态计算，但必须留给人工核对。
function reviewNotesFor(record, byNoticeId) {
  const notes = [];
  const noticeId = attribute(record, 'noticeId') ?? record.sourceId;
  const permitId = attribute(record, 'permitId');
  const action = attribute(record, 'action');
  const replaces = attribute(record, 'replaces');

  if (!permitId) notes.push({ code: 'missing-permit-id', noticeId, detail: '来源未给出许可号，无法归入许可' });
  if (!action || !ACTIONS.has(action)) notes.push({ code: 'unknown-action', noticeId, detail: `未识别的 action：${action ?? '缺失'}` });
  if (effectiveAtOf(record) === null) notes.push({ code: 'invalid-effective-at', noticeId, detail: '缺少或无法解析 effectiveAt' });
  if (RELATION_ACTIONS.has(action) && !replaces) {
    notes.push({ code: 'missing-replaces-declaration', noticeId, detail: `${action} 公告没有来源 replaces 关联声明` });
  }
  if (replaces) {
    const target = byNoticeId.get(replaces);
    if (!target) {
      notes.push({ code: 'replaces-target-missing', noticeId, detail: `replaces 指向的公告 ${replaces} 不在已采集集合中` });
    } else {
      const targetPermit = attribute(target, 'permitId');
      if (permitId && targetPermit && permitId !== targetPermit) {
        notes.push({ code: 'replaces-cross-permit', noticeId, detail: `replaces 链跨越不同 permitId：${permitId} → ${targetPermit}` });
      }
    }
  }
  return notes;
}

// 沿 replaces 边检测环形声明（A→B→A 之类），环形链保持待核对，不猜测先后。
function cyclicChains(records, byNoticeId) {
  const cyclic = new Set();
  for (const start of records) {
    const seen = new Set();
    let current = start;
    while (current) {
      const id = attribute(current, 'noticeId') ?? current.sourceId;
      if (seen.has(id)) {
        for (const member of seen) cyclic.add(member);
        break;
      }
      seen.add(id);
      const nextId = attribute(current, 'replaces');
      current = nextId ? byNoticeId.get(nextId) : null;
    }
  }
  return cyclic;
}

// 同一来源公告身份重复出现时，以采集仓库合并后的单条记录为准；
// 这里兜底防御重复 sourceId，避免重复计数。
function dedupeByIdentity(records) {
  const unique = new Map();
  for (const record of records) {
    if (!unique.has(record.sourceId)) unique.set(record.sourceId, record);
  }
  return [...unique.values()];
}

function chainEntry(record, knownAt, cutoff) {
  const noticeId = attribute(record, 'noticeId') ?? record.sourceId;
  const effectiveAt = effectiveAtOf(record);
  return {
    noticeId,
    action: attribute(record, 'action'),
    replaces: attribute(record, 'replaces'),
    title: attribute(record, 'title'),
    publishedAt: attribute(record, 'publishedAt'),
    effectiveAt: attribute(record, 'effectiveAt'),
    collectedAt: record.collectedAt ?? null,
    // 该公告对截点而言是"当时已知"还是"截点后补来"。
    knowledge: knownAt <= cutoff ? 'known-at-cutoff' : 'arrived-after-cutoff',
    // effectiveAt 晚于截点：公告已知，但业务效力在截点时尚未发生。
    effectiveAtCutoff: effectiveAt === null ? null : (effectiveAt <= cutoff ? 'effective-at-cutoff' : 'effective-after-cutoff'),
  };
}

function foldGroup(group, cutoff, cyclic) {
  const known = group
    .filter((record) => knownAtOf(record) <= cutoff)
    .map((record) => ({ record, effectiveAt: effectiveAtOf(record), publishedAt: publishedAtOf(record) }))
    // 确定性排序：先按业务生效时间，再按来源公告时间、公告身份。
    // 列表换序、迟到补采都不会改变折叠结果。
    .sort((left, right) =>
      (left.effectiveAt ?? Number.POSITIVE_INFINITY) - (right.effectiveAt ?? Number.POSITIVE_INFINITY)
      || (left.publishedAt ?? Number.POSITIVE_INFINITY) - (right.publishedAt ?? Number.POSITIVE_INFINITY)
      || left.record.sourceId.localeCompare(right.record.sourceId));

  let status = 'unknown';
  const notes = [];
  for (const { record } of known) {
    const noticeId = attribute(record, 'noticeId') ?? record.sourceId;
    const action = attribute(record, 'action');
    const effectiveAt = effectiveAtOf(record);
    const inForce = effectiveAt !== null && effectiveAt <= cutoff;

    if (cyclic.has(noticeId)) {
      notes.push({ code: 'cyclic-replaces-chain', noticeId, detail: 'replaces 链存在环形声明，关联顺序待人工核对' });
    }
    if (!inForce) continue; // 已公告但截点时未生效，不改变截点状态。
    if (status === 'revoked' && (action === 'grant' || action === 'correct')) {
      // 撤销是终态：迟到或换序出现的后续公告不能让已撤销许可复活。
      notes.push({ code: 'event-after-revocation', noticeId, detail: '许可已撤销后又出现 grant/correct 公告，未恢复其有效性，待人工核对' });
      continue;
    }

    if (action === 'grant') status = 'active';
    else if (action === 'revoke') status = 'revoked';
    // correct 不改变有效/撤销状态，只在链中留下解释；unknown action 也不改状态。
  }

  return { status, notes, knownRecords: known.map(({ record }) => record) };
}

export function buildWeeklyReport(records, { asOf, generatedAt = null } = {}) {
  const cutoff = timestamp(asOf);
  if (cutoff === null) throw new Error('weekly report requires a valid asOf cutoff timestamp');

  const all = dedupeByIdentity(records);
  const byNoticeId = new Map(all.map((record) => [attribute(record, 'noticeId') ?? record.sourceId, record]));
  const cyclic = cyclicChains(all, byNoticeId);

  // 归组只承认来源明确给出的 permitId；没有许可号的公告各自独立成组并标记核对。
  // 标题相似不作为任何归组依据。
  const groups = new Map();
  for (const record of all) {
    const permitId = attribute(record, 'permitId');
    const key = permitId ?? `unlinked:${record.sourceId}`;
    if (!groups.has(key)) groups.set(key, { permitId, records: [] });
    groups.get(key).records.push(record);
  }

  const rows = [];
  const arrivedAfterCutoff = [];
  for (const group of groups.values()) {
    const notes = group.records.flatMap((record) => reviewNotesFor(record, byNoticeId));
    const { status, notes: foldNotes, knownRecords } = foldGroup(group.records, cutoff, cyclic);
    notes.push(...foldNotes);

    for (const record of group.records) {
      if (knownAtOf(record) > cutoff) {
        arrivedAfterCutoff.push(chainEntry(record, knownAtOf(record), cutoff));
      }
    }

    const chain = knownRecords.map((record) => chainEntry(record, knownAtOf(record), cutoff));
    rows.push({
      permitId: group.permitId,
      status,
      statusText: STATUS_TEXT[status],
      needsReview: notes.length > 0,
      reviewNotes: notes,
      // 解释更正、替代、撤销关系的完整证据链，按业务生效顺序排列。
      chain,
      latestNoticeId: chain.length ? chain[chain.length - 1].noticeId : null,
    });
  }

  rows.sort((left, right) =>
    String(left.permitId ?? left.latestNoticeId ?? '').localeCompare(String(right.permitId ?? right.latestNoticeId ?? '')));
  arrivedAfterCutoff.sort((left, right) => left.noticeId.localeCompare(right.noticeId));

  return {
    product: '建设许可公告目录',
    asOf,
    generatedAt,
    permits: rows,
    // 截点之后才采集到的公告：保留可追溯信息，但不参与截点状态。
    arrivedAfterCutoff,
  };
}
