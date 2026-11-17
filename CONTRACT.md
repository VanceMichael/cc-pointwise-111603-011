# 来源与消费契约

## 来源

入口 `/permits/notices`，HTML 内的 source-record JSON 节点保留了门户输出字段；rel=next 链接表示下一页。`fixtures/source.json` 的 opening 与 updated 是两个可切换的来源观察，不代表业务库必须得出某个预设结论；可添加新的来源观察验证行为。

noticeId 是公告身份，permitId 是来源明确给出的许可号；标题相同不能自动关联。action 可能为 grant/correct/revoke，replaces 为来源关联声明，缺失或环形声明可保持待核对。截点报告以当时已知公告和业务生效时间解释，不把迟到记录伪装成早已知晓。

## 截点周报

`readOperations(repository, { cutoff })` 在原 product/rows 之外附加 `weeklyReport`；`buildWeeklyReport(records, cutoff)` 是纯函数，可独立复用。语义约束：

- 知识时间取记录的 `collectedAt`（本地采集时刻），历史集合缺该字段时回退 `observedAt`。获知时间晚于截点的公示进入 `lateNotices`，不参与截点状态判断；同一原始集合对不同截点可重建出不同的历史周报。
- 只按显式 `permitId` 分组、按显式 `replaces` 建链。环形、断链、跨许可、多有效根、缺 permitId 等关联不足情形输出 `review`/`reviewQueue` 人工核对项，禁止按标题相似度合并。
- revoke 链头是终态：换序、迟到或重新出现的公示不恢复许可效力；链结构歧义时状态为 review 且 head 为 null，不猜测链头。
- 每个许可在截点只占一行，chain 保留全部原始公示及替代关系解释；已知但未生效的公示进入 `pendingNotices`。

## 业务消费

`readOperations(repository)` 当前返回 product 和 rows，每行带 sourceId/source/observedAt/collectedAt/attributes。现有 CLI 和结构化导入用于本地运维；新增采集结果也需要让业务读取入口看到一致状态，必要的解释信息可扩展返回。原始来源身份与 observedAt 不是通用的业务版本、完整性或成功证明。来源接口契约是兼容边界，采集、状态管理和新业务表达由实现决定。
