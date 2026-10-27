# 战锤3 MOD AI 技能书 · 通用分享版
# Warhammer III Modding AI Skill · Portable Edition

**中文优先，标题、介绍与使用说明提供中英双语。**

A Chinese-first, portable knowledge and tooling package for AI-assisted Total War: Warhammer III modding. Titles, introduction and usage guidance are available in both Chinese and English; technical chapters are written in Chinese with original English table names, fields and terminology.

发布 2026-10-27；共 **42 个主题分册**，同步近期汉化、UI 与动作经验，并选择性融合上游 `45a4c4b`。文档和脚本使用通用路径配置，适合 GitHub 浏览和 ZIP 分享，不依赖特定 AI 客户端。

## 开始使用 / Getting started

1. 解压，保留整个 `warhammer-mod` 文件夹及内部结构。
2. 人工阅读：打开 [技能书目录](references/00-技能书目录.md) 按主题选择；AI 使用：让它先读 [SKILL.md](SKILL.md)、00，再按任务读取相关册。客户端支持技能包时，按该客户端的安装说明放置；本包不自动安装。
3. 做 MOD 前提供自己的游戏版本、原版导出根和 MOD 源目录，先读 02/05。没有导出资料时先用 RPFM 从自己的游戏导出，不能把作者指纹当作可编辑原版。

可直接发给 AI 的开工要求：

> 先读取这个文件夹里的 SKILL.md 和 references/00-技能书目录.md，按任务路由读需要的册。先核实我提供的游戏版本、原版导出和 MOD 路径，字段对拍当前原版；区分已验证、历史案例和推断。文档尖括号路径需换成我的真实路径，缺软件时说明依赖。

## 随包工具 / Included tools

首次使用先看 [工具清单与准备](工具清单与准备.md)：必需/可选工具、作者下载地址、环境准备顺序，以及每个脚本的依赖。

- `tools/modcheck/check.js`：TSV/loc/引用检查，DB 原版路径必须指定。不能替代 schema 的全部类型/复合键校验或游戏实测。
- `tools/rpfm-pack/{pack,extract,inspect}.js`：另需兼容 RPFM server；说明在其 README。
- `scripts/dds-inspect.js`：只读 DDS 头与 SHA-256；不解码像素、不验证压缩载荷或游戏兼容性。
- `scripts/loc-audit.js`：汉化标记、官方译名、键覆盖与多文件同键审校；空目录或缺参数明确失败。
- `tools/ui-preview/preview.js`：可选的本地 HTML 素材预览与缺图/页面错误报告，另需 Chrome 和 `playwright-core`；[配置说明](tools/ui-preview/README.md)。
- `scripts/audit-version.js`：只读指纹对比；只有显式 --snapshot 才写新快照。
- `scripts/diff-row.ps1`：逐字段比较克隆行；`check-tsv.ps1` 是浅层格式检查；Windows 各配 .bat。

核心 Node 脚本无 npm 依赖；可选 UI 预览需要 `playwright-core`。Node 和第三方软件需自行准备。命令示例与配置见 [02](references/02-环境与工具.md)，验证范围见 [VALIDATION](VALIDATION.md)。文档中 `<GAME>` 等是占位记号，不能原样执行。

## 版本与动作案例 / Version and case boundaries

作者资料参考为 WH3 9.0.4.0 / build 25961564（版本与表数同步）；随包自动审计指纹仍为 9.0.2 / build 25649450，尚未接纳新版快照，不承诺未来版本全部兼容。旧字段、表计数和历史游戏实测需按自己的版本复核。

28 册同步移动射击候选制作、容器格式与回环验收；案例的帧数、骨骼和动画工具只属于该输入。新的静态/渲染结果尚未完成游戏验收，不能按案例参数直接套所有模型。

## 本次新增 / New chapters

- [45 · Lua 离线回归](references/45-Lua离线回归.md)：实际源码、严格替身、延迟/取消与保存恢复。
- [46 · CA 字符串接口](references/46-CA字符串接口.md)：`find` / `find_lua` 的签名和模式差异，普通 Lua 测试的盲区。
- [62 · 运行时样本与内存研究](references/62-运行时样本与内存研究.md)、[63 · MCP 证据与日志整理](references/63-MCP证据与日志整理.md)：样本身份、调用图、字段推导及原始响应证据。
- [51 · 汉化审校与显示](references/51-汉化审校与显示规则.md)、[43 · UI 布局与预览](references/43-UI布局与运行时.md)：近期本地经验通用化。

修正自增益目标组不能统一套字段值的旧结论；上游审查范围与未导入内容见 [UPSTREAM](UPSTREAM.md)。

原生分析按需另装 Ghidra 及其版本要求的 JDK；本包不附游戏二进制、分析工程、DLL 或原始案例日志。

## 分享范围 / Distribution scope

GitHub 可直接浏览全部 Markdown；下载或克隆后保留目录结构，再让 AI 读取 SKILL.md 和 00 目录。

本包可作为技能书分享给群友；不含个人配置、旧归档、原版游戏资产或案例 MOD 源。工具与教程外链归各作者；需要相关资产时从自己的合法游戏安装或有权使用的 MOD 获取。原版元数据指纹已去掉作者绝对路径。

## English quick start

1. Download the repository as a ZIP or clone it. Keep SKILL.md, references/, scripts/, tools/ and assets/ together. The package does not install itself or require a particular AI client.
2. Ask your AI to read [SKILL.md](SKILL.md), then [the chapter router](references/00-技能书目录.md). It should load only the chapters relevant to your task.
3. Provide your own game version, current vanilla export, MOD source directory and required tools. See [environment setup](references/02-环境与工具.md) and [tool preparation](工具清单与准备.md). Replace all angle-bracket path placeholders with your own real paths.
4. Verify table headers, field types, keys and script APIs against your current vanilla game and schema. Documentation references WH3 9.0.4.0 / Steam build 25961564 for version and table counts; the bundled audit fingerprint remains 9.0.2 / build 25649450. Neither is a claim about your game; it is not a claim about your installed version or a future latest release.

Copy this instruction to your AI:

> Read SKILL.md and references/00-技能书目录.md first, then select the relevant chapters for my task. Confirm my game version, vanilla export and MOD paths before editing. Check fields and keys against my current vanilla data. Distinguish verified facts, historical cases and inference. Replace path placeholders with my real paths and explain any missing tools. Follow my authorization and the permissions of your client.

The 42 Chinese chapters cover DB/TSV, units, characters, abilities, equipment, campaigns, battle Lua, MCT, UI, textures, models, localization and diagnosis. The 2026-10-27 edition adds Lua behavioral regression, CA string contracts, runtime sample analysis and MCP evidence handling, plus updated localization review and optional offline UI previews. Selected upstream methods are attributed to immutable commit 45a4c4b; see [review scope](UPSTREAM.md).

Core Node.js scripts have no npm dependencies. Optional UI previews require Chrome and playwright-core with your own configuration. modcheck requires current vanilla DB exports via --vanilla; pack helpers require a compatible RPFM server and schema. dds-inspect only reads headers and SHA-256. Lua syntax checking requires Lua 5.1 luac. Software and game data are not bundled.

No game assets, game table contents, private paths, credentials or third-party executables are included. Author metadata fingerprints are reference snapshots. Static checks do not replace in-game testing; this publication did not repeat game tests or validate newer RPFM interfaces. See [validation scope](VALIDATION.md).
