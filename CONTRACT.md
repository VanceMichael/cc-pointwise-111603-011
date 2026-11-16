# 来源与消费契约

## 来源

入口 `/permits/notices`，HTML 内的 source-record JSON 节点保留了门户输出字段；rel=next 链接表示下一页。`fixtures/source.json` 的 opening 与 updated 是两个可切换的来源观察，不代表业务库必须得出某个预设结论；可添加新的来源观察验证行为。

noticeId 是公告身份，permitId 是来源明确给出的许可号；标题相同不能自动关联。action 可能为 grant/correct/revoke，replaces 为来源关联声明，缺失或环形声明可保持待核对。截点报告以当时已知公告和业务生效时间解释，不把迟到记录伪装成早已知晓。

## 业务消费

`readOperations(repository)` 当前返回 product 和 rows，每行带 sourceId/source/observedAt/attributes。现有 CLI 和结构化导入用于本地运维；新增采集结果也需要让业务读取入口看到一致状态，必要的解释信息可扩展返回。原始来源身份与 observedAt 不是通用的业务版本、完整性或成功证明。来源接口契约是兼容边界，采集、状态管理和新业务表达由实现决定。
