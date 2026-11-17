# 建设许可公告目录

Node.js 本地数据接入项目。已有一次来源读取、结构化导入与操作查询，来源服务和业务存储独立，来源变化不会自动刷新本地集合。导入按 sourceId 保存每条原始公示的最新观察并独立留存（更正、撤销不覆盖原公示），同时记录本地首次获知时间；截点周报在此之上做纯解释性重建。

## 运行

需要 Node.js 22，无第三方包、远程服务或账户凭据。`npm test` 运行现有行为与本地接口测试；`npm run demo` 启动临时来源、读取首批并展示业务查询，结束时自动关闭监听并清理临时数据，通常两秒内完成。`npm start -- ingest` 从 `fixtures/records.json` 导入，`npm start -- query` 读取本地 `var/records.json`，`npm start -- report <ISO截点>` 输出该截点的合规周报。演示数据不访问生产站点。

## 组件和数据

`source/server.js` 读取 `fixtures/source.json` 并监听随机回环端口。`startSource()` 返回 url、publish(stage)、failNext(path,status) 和 close()；publish 切换可观察来源版本而不修改业务仓库，failNext 可返回 503 或使用 disconnect 断开连接。它记录请求路径并支持来源 ETag/304。`src/source-client.js` 只接受同一回环来源；`src/adapter.js` 解析现有首批页面并保留原始来源属性，返回 records 和 next；目前 demo 只导入首批。`src/service.js` 与 `src/repository.js` 维护持久集合，服务时钟可注入（测试与回放不依赖真实时间）；`src/operations.js` 是读取该集合的业务消费入口，来源协议见 [CONTRACT.md](CONTRACT.md)。

### 截点周报（src/weekly-report.js）

每份原始公示独立保留，周报不修改集合，只在读取时按截点重建当时有效的许可状态：

- **知识时间**：记录带 `collectedAt`（本地实际采集时刻，与公告自身 `publishedAt/observedAt` 分开）。只有获知时间不晚于截点的公示才算“当时已知”；截点后才补来的公示进入 `lateNotices`，不参与当时状态判断，因此历史周报不会被迟到数据事后改写。
- **关联规则**：只按来源明确给出的 `permitId` 分组、按显式 `replaces` 建立更正/替代链。标题相同或相似绝不自动并项目。环形声明、断链（替代目标缺失）、跨许可声明、同一许可出现多条互无替代关系的有效公示、缺 permitId 等关联不足的情形，一律进入行内 `review` 或顶层 `reviewQueue` 留给人工核对。
- **终态语义**：链头为 revoke 时许可为“已撤销”，撤销是终态；列表换序、公告迟到或重新出现都不会让已撤销许可变回有效。链结构本身有歧义（多根）时状态为“待人工核对”，不猜测唯一链头。
- **可解释性**：每个许可一行，带 `status/statusLabel/valid/head/currentNotice/chain/review/explanation`；chain 逐项说明 root、correct、revoke 及其替代对象。截点时已知但尚未生效的公示进入 `pendingNotices`。

状态目录属于运行产物。扩展导入时应保留现有 CLI 和现有集合查询能力；新增状态可以另行组织。测试可直接使用随机端口来源，不需要等待真实时间或接入外网。运行录制可用 test 和 demo，无需安装浏览器或外部数据库。

`npm start` 或 `npm start -- --help` 查看命令；导入和查询使用显式的 ingest、query 动作，周报使用 report 动作加截点时间。`npm run acceptance` 在临时目录中验证本地来源读取、首批导入、重启回读、重放、迟到撤销的双截点周报与业务查询，完成后清理临时状态。
