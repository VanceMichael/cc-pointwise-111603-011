# 建设许可公告目录

Node.js 本地数据接入项目。已有一次来源读取、结构化导入与操作查询，来源服务和业务存储独立，来源变化不会自动刷新本地集合。导入以 sourceId 保存最新观察；采集时另记录 `collectedAt`（本地首次知晓时间），重放保留最早知晓时刻。截点周报在完整保留原始公示的前提下，按双时间轴折叠出截点时有效的许可状态。

## 运行

需要 Node.js 22，无第三方包、远程服务或账户凭据。`npm test` 运行现有行为与本地接口测试；`npm run demo` 启动临时来源、读取首批并展示业务查询，结束时自动关闭监听并清理临时数据，通常两秒内完成。`npm start -- ingest` 从 `fixtures/records.json` 导入，`npm start -- query` 读取本地 `var/records.json`，`npm start -- report 2026-11-16T12:00:00Z` 输出指定截点的合规周报。演示数据不访问生产站点。

## 组件和数据

`source/server.js` 读取 `fixtures/source.json` 并监听随机回环端口。`startSource()` 返回 url、publish(stage)、failNext(path,status) 和 close()；publish 切换可观察来源版本而不修改业务仓库，failNext 可返回 503 或使用 disconnect 断开连接。它记录请求路径并支持来源 ETag/304。`src/source-client.js` 只接受同一回环来源；`src/adapter.js` 解析现有首批页面并保留原始来源属性，返回 records 和 next；目前 demo 只导入首批。`src/service.js` 与 `src/repository.js` 维护持久集合，服务时钟可注入以便测试采集时刻；`src/operations.js` 是读取该集合的业务消费入口（含 `readWeeklyReport`），`src/weekly-report.js` 是纯函数截点折叠逻辑，来源协议见 [CONTRACT.md](CONTRACT.md)。

周报按来源明确的 `permitId`/`replaces` 归组并解释 grant/correct/revoke 链，绝不按相似标题并项目；关联证据不足时输出 `needsReview`/`reviewNotes` 留给人工核对。截点只纳入当时已采集（`collectedAt <= asOf`）的公告，迟到公告列入 `arrivedAfterCutoff`；状态按 `effectiveAt` 确定性排序计算，撤销为终态，列表换序不改变结果，原始公示始终逐条保留。

状态目录属于运行产物。扩展导入时应保留现有 CLI 和现有集合查询能力；新增状态可以另行组织。测试可直接使用随机端口来源，不需要等待真实时间或接入外网。运行录制可用 test 和 demo，无需安装浏览器或外部数据库。

`npm start` 或 `npm start -- --help` 查看命令；原导入和查询使用显式的 ingest、query 动作，截点周报使用 report 动作。`npm run acceptance` 在临时目录中验证本地来源读取、首批导入、重启回读、重放与业务查询，完成后清理临时状态。
