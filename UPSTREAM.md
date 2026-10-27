# 上游更新审查 · 2026-10-27

来源：[scnjwyc/warhammer3-mod-development-skill](https://github.com/scnjwyc/warhammer3-mod-development-skill)。上次采纳固定在 `b92d85eadd82a1d94b6e4e9cf519313ee1624e02`；本次核实 main 为 `45a4c4b6dcd65557a1dbbff258f307563d60f637`，其 parent 就是前者。[本次提交](https://github.com/scnjwyc/warhammer3-mod-development-skill/commit/45a4c4b6dcd65557a1dbbff258f307563d60f637) 涉及 49 个文件；这是提交统计，不表示本次逐文件审计全部内容。

选择读取开发域 18 份文档，下载字节与固定提交 manifest 的 SHA256 逐一匹配；有旧版文件的进行了增量对照。审查工作文件不随分享包分发。

| 处理 | 内容与落点 |
|---|---|
| 新增方法册 | 45：真实 Lua 源码、严格替身、延迟与存档回归；46：CA 字符串契约；62：运行时样本身份/覆盖/调用图/字段；63：MCP 请求、响应和前后日志证据 |
| 独立核实并纠正 | 当前原版 lucky_banner 与 reforge 的目标组反例，修正 20/21 的统一自增益配方；当前原版 `lib_lua_extensions.lua` 注释及 CA 文档镜像确认 find/find_lua 的参数和模式差异 |
| 对照后保留既有方法 | effect/bonus/scope 与载体职责、真实单位容量、采购与立即发兵、模型大小与判定、整行 TSV、覆盖层次和版本漂移；不重复建相同章节 |
| 本机近期经验同步 | 28 的移动射击/animpack 容器检查、43 的通用 UI 与离线预览、51 的汉化审校，以及当前 modcheck 的特定复合主键与精确引用检查 |
| 本次未导入 | 完整 Lua 模拟框架、Lupa/Capstone 工具链、运行时采集器、MCP 服务、原版 UI/Lua/术语快照、作者 pack 映射和自动回填流程 |

具体读取文件（均位于上游 `skills/warhammer-mod-development/references/`）：

`ability-targeting.md`、`ancillaries_and_traits.md`、`animation-and-mounts.md`、`ca-string-api.md`、`campaigns_payloads_mercenaries.md`、`db-scenarios.md`、`effects_and_bundles.md`、`lua-offline-testing.md`、`lua_api.md`、`model-and-collision.md`、`naming_conventions.md`、`pooled_resources.md`、`project_structure.md`、`runtime-memory-analysis.md`、`tsv_format.md`、`units_and_combat.md`、`version-maintenance.md`、`wh3-mcp-workflow.md`。

新提交将公开技能入口整理为 5 个；这不证明先前 DDS/模型修复知识失效。本书保留已经采纳的方法，继续按单入口和分册使用。本次采用方法重述并链接固定来源，没有整包搬运代码、第三方软件或游戏资料。原始来源的权利归属不变。

上游报告的历史原生失效、特定 MCP 缺陷和测试数字只属于它记录的版本。本次没有运行其完整测试、采集游戏进程或新增游戏实测，不把这些记录写成本次验证成功。各项边界见 [91 §9](references/91-数据素材来源与可信度.md) 与 [VALIDATION](VALIDATION.md)。
