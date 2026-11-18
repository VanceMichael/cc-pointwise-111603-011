# 来源与消费契约

## 来源

入口 `/permits/notices`，HTML 内的 source-record JSON 节点保留了门户输出字段；rel=next 链接表示下一页。`fixtures/source.json` 的 opening 与 updated 是两个可切换的来源观察，不代表业务库必须得出某个预设结论；可添加新的来源观察验证行为。

noticeId 是公告身份，permitId 是来源明确给出的许可号；标题相同不能自动关联。action 可能为 grant/correct/revoke，replaces 为来源关联声明，缺失或环形声明可保持待核对。截点报告以当时已知公告和业务生效时间解释，不把迟到记录伪装成早已知晓。

## 截点周报

采集服务在接收每条公告时写入 `collectedAt`（本地首次知晓时间，时钟可注入），与来源公告时间 `observedAt`/`publishedAt`、业务生效时间 `effectiveAt` 构成双时间轴。`buildWeeklyReport(records, { asOf })` 与 `readWeeklyReport(repository, options)` 的规则：

1. 只按来源明确给出的 `permitId` 归组、按 `replaces` 解释更正/替代/撤销链；标题相似度永不作为关联依据。缺失许可号、缺失/悬空/环形/跨许可 replaces、未知 action、无效 effectiveAt 一律输出 `needsReview` 与 `reviewNotes`，留给人工核对。
2. 截点状态只纳入 `collectedAt <= asOf` 的公告；截点后才采到的公告进入 `arrivedAfterCutoff`，不参与状态，同一历史截点重复生成结果不变。
3. 已知公告按 `effectiveAt`（次选 publishedAt、noticeId）确定性排序后折叠：grant→有效、revoke→已撤销、correct 不改状态只留链解释；`effectiveAt > asOf` 的已知公告不提前生效。
4. 撤销是终态：撤销之后出现的 grant/correct 不能让许可复活，只追加 `event-after-revocation` 核对项。列表换序、迟到补采不改变输出。
5. 原始公示在 repository 中逐条保留，报告是只读折叠视图，不修改输入记录。

## 业务消费

`readOperations(repository)` 当前返回 product 和 rows，每行带 sourceId/source/observedAt/attributes。现有 CLI 和结构化导入用于本地运维；新增采集结果也需要让业务读取入口看到一致状态，必要的解释信息可扩展返回。原始来源身份与 observedAt 不是通用的业务版本、完整性或成功证明。来源接口契约是兼容边界，采集、状态管理和新业务表达由实现决定。
