// 截点周报的纯领域逻辑：
// 只信任来源明确给出的身份（permitId）与关联声明（replaces），
// 标题相似不作为合并依据；关联不足的情形输出人工核对项而非猜测。

const knownActions = new Set(['grant', 'correct', 'revoke']);

const actionLabels = Object.freeze({
  grant: '许可公示',
  correct: '更正公示',
  revoke: '撤销公示',
});

const statusLabels = Object.freeze({
  granted: '许可有效',
  corrected: '许可有效（已更正）',
  revoked: '已撤销',
  review: '待人工核对',
});

const issueMessages = Object.freeze({
  'replaces-cycle': (detail) => `公示 ${detail.ids.join('、')} 的替代声明形成环形，需人工核对`,
  'replaces-target-missing': (detail) => `公示 ${detail.id} 声明替代 ${detail.replaces}，但已采集集合中没有该公示，需人工核对`,
  'replaces-permit-mismatch': (detail) => `公示 ${detail.id}（许可 ${detail.permitId}）声明替代另一许可 ${detail.otherPermitId} 的公示 ${detail.replaces}，来源关联跨许可，需人工核对`,
  'unknown-action': (detail) => `公示 ${detail.id} 的 action=${detail.action} 不在 grant/correct/revoke 范围内，需人工核对`,
  'missing-effective-time': (detail) => `公示 ${detail.id} 缺少 effectiveAt/publishedAt，生效时间无法确定，需人工核对`,
  'multiple-effective-roots': (detail) => `许可 ${detail.permitId} 在截点存在多条互无替代关系的有效公示（${detail.ids.join('、')}），来源未给出足够关联，需人工核对`,
  'missing-permit-id': (detail) => `公示 ${detail.id} 未给出许可号 permitId，无法归入任何许可，需人工核对`,
});

function text(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

// 本地获知时间：collectedAt 是采集时刻；历史数据缺该字段时回退到 observedAt。
export function knowledgeTime(record) {
  const candidate = text(record.collectedAt) ?? text(record.observedAt);
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed)) throw new Error(`record ${record.sourceId} has no usable knowledge time`);
  return candidate;
}

function toNode(record) {
  const attributes = record.attributes ?? {};
  const effectiveAt = text(attributes.effectiveAt) ?? text(attributes.publishedAt) ?? text(record.observedAt);
  return {
    sourceId: text(record.sourceId),
    permitId: text(attributes.permitId),
    title: text(attributes.title) ?? record.label ?? null,
    action: text(attributes.action),
    replaces: text(attributes.replaces),
    publishedAt: text(attributes.publishedAt) ?? text(record.observedAt),
    effectiveAt,
    hasEffectiveTime: Boolean(text(attributes.effectiveAt) ?? text(attributes.publishedAt)),
    observedAt: text(record.observedAt),
    collectedAt: text(record.collectedAt),
    knownAt: knowledgeTime(record),
    attributes: structuredClone(attributes),
  };
}

function issue(code, detail) {
  return { code, message: issueMessages[code](detail), ...detail };
}

// 在全量 replaces 有向图上找出处于环上的节点。
function findCycleMembers(nodes) {
  const edges = new Map();
  for (const node of nodes) if (node.replaces) edges.set(node.sourceId, node.replaces);
  const state = new Map(); // 1=在栈中 2=已完成
  const members = new Set();
  const stack = [];
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    const next = edges.get(id);
    if (next && state.get(next) !== 2) {
      if (state.get(next) === 1) {
        const start = stack.indexOf(next);
        for (let index = start; index < stack.length; index += 1) members.add(stack[index]);
      } else if (nodes.some((node) => node.sourceId === next)) {
        visit(next);
      }
    }
    state.set(id, 2);
    stack.pop();
  };
  for (const node of nodes) if (!state.has(node.sourceId)) visit(node.sourceId);
  return members;
}

function timeCompare(left, right) {
  return Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt)
    || Date.parse(left.publishedAt) - Date.parse(right.publishedAt)
    || left.sourceId.localeCompare(right.sourceId);
}

// 待核对条目可能缺少时间字段，缺时间的统一排在后面，避免 NaN 导致排序不稳定。
function safeTimeCompare(left, right) {
  const leftTime = Date.parse(left.effectiveAt);
  const rightTime = Date.parse(right.effectiveAt);
  if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return left.sourceId.localeCompare(right.sourceId);
  if (!Number.isFinite(leftTime)) return 1;
  if (!Number.isFinite(rightTime)) return -1;
  if (leftTime !== rightTime) return leftTime - rightTime;
  const leftPublished = Date.parse(left.publishedAt);
  const rightPublished = Date.parse(right.publishedAt);
  if (Number.isFinite(leftPublished) && Number.isFinite(rightPublished) && leftPublished !== rightPublished) {
    return leftPublished - rightPublished;
  }
  return left.sourceId.localeCompare(right.sourceId);
}

function chainEntry(node) {
  const relation = node.replaces
    ? (knownActions.has(node.action) ? node.action : 'relation-unknown')
    : 'root';
  return {
    sourceId: node.sourceId,
    noticeId: node.attributes.noticeId ?? node.sourceId,
    action: node.action,
    actionLabel: actionLabels[node.action] ?? '未知动作',
    title: node.title,
    publishedAt: node.publishedAt,
    effectiveAt: node.effectiveAt,
    replaces: node.replaces,
    relation,
    relationLabel: node.replaces
      ? `${actionLabels[node.action] ?? '未知动作'}，替代公示 ${node.replaces}`
      : '链上最早公示',
    knowledge: {
      observedAt: node.observedAt,
      collectedAt: node.collectedAt,
      knownAt: node.knownAt,
      knownAtCutoff: true,
    },
  };
}

function explain(row) {
  const head = row.head;
  if (row.status === 'review') {
    return `许可 ${row.permitId} 的公示链存在待人工核对问题（${row.review.map((item) => item.code).join('、')}），以下为待人工核对的临时呈现，需人工确认后才能作为合规结论`;
  }
  if (row.status === 'revoked') {
    return `许可 ${row.permitId} 已由公示 ${head.sourceId} 于 ${head.effectiveAt} 撤销（替代公示 ${head.replaces}）；撤销为终态，之后迟到或重新出现的公示不恢复其效力`;
  }
  if (row.status === 'corrected') {
    return `许可 ${row.permitId} 已由公示 ${head.sourceId} 更正，替代公示 ${head.replaces}，更正后自 ${head.effectiveAt} 起继续有效`;
  }
  return `许可 ${row.permitId} 当前依据公示 ${head.sourceId} 处于有效状态，生效时间 ${head.effectiveAt}`;
}

function buildPermitRow(permitId, group, globalIssues) {
  const review = [];
  const nodes = group.nodes;
  for (const node of nodes) {
    for (const global of globalIssues.get(node.sourceId) ?? []) review.push(global);
    if (!node.action || !knownActions.has(node.action)) {
      review.push(issue('unknown-action', { id: node.sourceId, action: node.action }));
    }
    if (!node.hasEffectiveTime) {
      review.push(issue('missing-effective-time', { id: node.sourceId }));
    }
  }

  const cutoffTime = Date.parse(group.cutoff);
  const effective = group.nodes.filter((node) => Date.parse(node.effectiveAt) <= cutoffTime);
  const pending = group.nodes.filter((node) => Date.parse(node.effectiveAt) > cutoffTime);

  const replacedIds = new Set(effective.map((node) => node.replaces).filter(Boolean));
  const roots = effective.filter((node) => !replacedIds.has(node.sourceId));
  if (effective.length > 1 && roots.length > 1) {
    review.push(issue('multiple-effective-roots', { permitId, ids: roots.map((node) => node.sourceId) }));
  }

  const chain = effective.slice().sort(timeCompare).map(chainEntry);
  // 多个互无替代关系的有效根意味着来源关联不足，不猜测唯一链头。
  const head = roots.length === 1 ? roots[0] : null;

  let status;
  if (!head) {
    // 多个互无替代关系的有效根：链结构本身有歧义，不能下任何业务结论。
    status = 'review';
  } else if (head.action === 'revoke') {
    // 撤销是终态：即使链上同时存在数据质量问题，也不能退回有效；问题仍随 review 暴露。
    status = 'revoked';
  } else if (review.length) {
    status = 'review';
  } else if (head.action === 'correct') {
    status = 'corrected';
  } else {
    status = 'granted';
  }

  const row = {
    permitId,
    status,
    statusLabel: statusLabels[status],
    valid: status === 'granted' || status === 'corrected',
    head: head ? {
      sourceId: head.sourceId,
      action: head.action,
      title: head.title,
      publishedAt: head.publishedAt,
      effectiveAt: head.effectiveAt,
      replaces: head.replaces,
    } : null,
    currentNotice: head ? structuredClone(head.attributes) : null,
    chain,
    review,
    pending: pending.map((node) => ({
      sourceId: node.sourceId,
      action: node.action,
      title: node.title,
      publishedAt: node.publishedAt,
      effectiveAt: node.effectiveAt,
      knownAt: node.knownAt,
    })),
  };
  row.explanation = explain(row);
  return row;
}

// records：规范化后的本地公告集合（保留全部原始公示）。
// cutoff：周报截点；只有 collectedAt/observedAt 不晚于截点的公告才算“当时已知”。
export function buildWeeklyReport(records, cutoff) {
  const cutoffText = text(cutoff);
  if (!cutoffText || !Number.isFinite(Date.parse(cutoffText))) {
    throw new Error('weekly report cutoff must be a parseable timestamp');
  }

  const allNodes = records.map(toNode);
  const nodeById = new Map(allNodes.map((node) => [node.sourceId, node]));

  // 全量集合上的关联声明检查（迟到记录的问题同样暴露，但不计入截点行）。
  const cycleMembers = findCycleMembers(allNodes);
  const globalIssues = new Map();
  const addGlobal = (sourceId, item) => {
    if (!globalIssues.has(sourceId)) globalIssues.set(sourceId, []);
    globalIssues.get(sourceId).push(item);
  };
  for (const node of allNodes) {
    if (cycleMembers.has(node.sourceId)) {
      addGlobal(node.sourceId, issue('replaces-cycle', { ids: [...cycleMembers].sort() }));
    }
    if (!node.replaces) continue;
    const target = nodeById.get(node.replaces);
    if (!target) {
      addGlobal(node.sourceId, issue('replaces-target-missing', { id: node.sourceId, replaces: node.replaces }));
    } else if (target.permitId && node.permitId && target.permitId !== node.permitId) {
      addGlobal(node.sourceId, issue('replaces-permit-mismatch', {
        id: node.sourceId, permitId: node.permitId, otherPermitId: target.permitId, replaces: node.replaces,
      }));
    }
  }

  const known = allNodes.filter((node) => Date.parse(node.knownAt) <= Date.parse(cutoffText));
  const lateNotices = allNodes
    .filter((node) => Date.parse(node.knownAt) > Date.parse(cutoffText))
    .sort(safeTimeCompare)
    .map((node) => ({
      sourceId: node.sourceId,
      permitId: node.permitId,
      action: node.action,
      title: node.title,
      publishedAt: node.publishedAt,
      effectiveAt: node.effectiveAt,
      collectedAt: node.collectedAt,
      knownAt: node.knownAt,
      note: '该公示在截点之后才被本地采集，不参与截点状态判断',
    }));

  const reviewQueue = [];
  const groups = new Map();
  for (const node of known) {
    if (!node.permitId) {
      reviewQueue.push({
        sourceId: node.sourceId,
        reason: 'missing-permit-id',
        message: issueMessages['missing-permit-id']({ id: node.sourceId }),
        title: node.title,
        action: node.action,
        knownAt: node.knownAt,
      });
      continue;
    }
    if (!groups.has(node.permitId)) groups.set(node.permitId, []);
    groups.get(node.permitId).push(node);
  }

  const rows = [];
  const pendingNotices = [];
  for (const [permitId, nodes] of [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    const row = buildPermitRow(permitId, { nodes, cutoff: cutoffText }, globalIssues);
    if (row.chain.length === 0) {
      // 截点时该许可只有“已知但尚未生效”的公示，不生成许可状态行。
      for (const node of nodes) {
        pendingNotices.push({
          permitId, sourceId: node.sourceId, action: node.action, title: node.title,
          publishedAt: node.publishedAt, effectiveAt: node.effectiveAt, knownAt: node.knownAt,
          note: '截点时已采集但生效时间在截点之后',
        });
      }
      continue;
    }
    for (const item of row.pending) pendingNotices.push({ permitId, ...item });
    delete row.pending;
    rows.push(row);
  }

  return {
    product: '建设许可公告目录',
    cutoff: cutoffText,
    basis: {
      knownNoticeCount: known.length,
      lateNoticeCount: lateNotices.length,
      rule: '仅按来源明确给出的 permitId 分组、按显式 replaces 建立替代链；标题相似不自动关联',
    },
    rows,
    reviewQueue: reviewQueue.sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
    pendingNotices: pendingNotices.sort(safeTimeCompare),
    lateNotices,
  };
}
