# 42 · MCT 配置菜单（Mod Configuration Tool）

> 适用：WH3 ｜ 事实截止：2026-09-14 ｜ 来源：`groovy_mct.pack` 解包源码逐条核对（`<REFERENCE>\su_fymsm_mct_ref\groovy_mct.pack` → `script\groovy\modules\mct\`）；作者案例 `su_fymsm` MOD 在游戏内实测菜单可用
> 可信度：A（API 签名、控件类型、取值函数均取自框架源码；菜单注册与读取经游戏内实测） ｜ 指纹：控件类型 9 种 / `add_new_option` 于 `objects\mods\obj.lua` L935
> 再生成：重解 `groovy_mct.pack`，核对 `script\groovy\modules\mct\objects\options\types\` 目录与 `objects\mods\obj.lua`
> 维护核验：2026-10-08；当前版本、来源与本次验证范围见 `05-版本维护与核验.md`。

**分工**：本册讲「怎么给 MOD 加一个玩家能在游戏里改的设置菜单」。菜单值在**战斗脚本**里怎么读、怎么用看 `references/41-战斗脚本.md`；菜单文本的本地化规则看 `references/50-本地化与翻译.md`。

## 0. 一页速览

1. MCT（Mod Configuration Tool）= 第三方框架包 `groovy_mct.pack`；**不是官方组件**，玩家需自行订阅/安装。
2. 菜单脚本放 `script\mct\settings\<名>.lua`，框架自动扫描加载，**不需要注册任何监听**。
3. 菜单文本放独立 loc：`text\db\<名>.loc.tsv`（中英成对）。
4. 三步建菜单：`register_mod` → `add_new_section` → `add_new_option`。
5. 读值只用两个：`opt:get_finalized_setting()`（最终值，**推荐**）、`opt:get_selected_setting()`（UI 选中值）。
6. `checkbox` 类型**只接受 boolean**；`multibox` 是**空壳**（源码仅一行 TODO），要多选就用多个 checkbox。
7. **战斗环境也能读 MCT**（框架主动支持战役内战斗），因此"战役里配置、战斗里生效"是可行模式。
8. 没装 MCT 时**必须退化**：`get_mct` 为 nil 或 `get_mod_by_key` 返回 nil → 用内置默认值，不得报错、不得静默失效。

## 1. 依赖与加载

| 项 | 事实 |
|---|---|
| 框架包 | `groovy_mct.pack`（作者 groovy / vandy_lib 系） |
| 入口 | `script\_lib\mod\!glib_init.lua`（日志中出现 `MCT.Init` 即加载成功） |
| 菜单目录 | `script\mct\settings\*.lua` —— 框架自动加载 |
| 框架本体 | `script\groovy\modules\mct\`（约 20 个文件：mods / sections / options / controls / systems） |
| 菜单文本 | `text\db\<名>.loc.tsv` |

- **依据**：`lib_mod_loader.lua` 的 `core:load_mods` 加载 `script/_lib/mod/`；MCT 自身再扫描 `script/mct/settings/`。
- **怎么做**：新 MOD 加菜单时，只建 `script\mct\settings\<前缀>_mct.lua` 与 `text\db\<前缀>_mct.loc.tsv` 两个文件即可。
- **验收**：游戏内 MCT 菜单列表里出现该 MOD 条目；`lua_mod_log.txt` 有 `MCT.Init`。

> ⚠️ 坑：把菜单脚本放进 `script\campaign\mod\` → MCT 不扫描该目录，菜单不出现（无任何报错）。

## 2. 最小可运行菜单

来源：`<REFERENCE>\su_fymsm_mct_ref\` 中 `wyccc_ai_overhaul.pack` 的 `script\mct\settings\wyccc_ai_overhaul_mct.lua`（21 行，最小完整实例）。

```lua
local loc_prefix = "su_fymsm_"
local mct = get_mct()

if mct == nil then
    return;                      -- 没装 MCT：直接退出，由业务脚本自己用默认值
end;

local mod = mct:register_mod("su_fymsm")
mod:set_author("su")
mod:set_title(loc_prefix .. "mod_title", true)
mod:set_description(loc_prefix .. "mod_desc", true)

local section = mod:add_new_section("su_fymsm_guard", loc_prefix .. "section_guard", true)

local opt = mod:add_new_option("guard_inf_mis", "checkbox")
opt:set_default_value(true)
opt:set_text(loc_prefix .. "opt_inf_mis", true)
opt:set_tooltip_text(loc_prefix .. "opt_inf_mis_tt", true)
```

- `register_mod` 的 key 必须全局唯一（重复注册框架会警告并返回旧对象）。
- 第二个参数 `true` 表示"这是 loc 键，请去本地化表查"。
- **验收**：进游戏打开 MCT → 出现「默认防御模式（按兵种标签）」条目 → 分区下有一个勾选框，文案与提示均为中文（不是键名原文）。

> ⚠️ 坑：`set_text("中文文案", true)` 直接塞中文当 loc 键 → 本地化表里查不到，界面显示键名。

## 3. 控件类型

框架 `objects\options\types\` 下实有 9 种，`add_new_option(key, type)` 的 `type` 字符串即目录名：

| type | 用途 | 值类型 | 备注 |
|---|---|---|---|
| `checkbox` | 单个开关 | **boolean** | 最常用；`set_default_value(false)` 为默认 |
| `dropdown` | 下拉单选 | 选中项的 `key`（字符串） | 需先 `add_dropdown_values` |
| `radio_button` | 单选按钮组 | 选中项 key | |
| `slider` | 数值滑块 | number | |
| `text_input` | 文本输入 | string | |
| `dummy` | 占位/纯展示 | — | |
| `action` | 按钮（点击触发） | — | |
| `dropdown_game_object` | 游戏对象下拉 | 对象 key | 选项来自游戏数据 |
| `multibox` | ~~多选~~ | — | **未实现**，源码只有 `--- TODO multiple checkboxes - and\|or operation` |

**dropdown 写法**（来源：`wyccc_ai_overhaul_mct.lua`）：

```lua
local difficulty = mod:add_new_option("ai_buff_difficulty", "dropdown")
difficulty:add_dropdown_values({
    { key = "off",    text = loc_prefix .. "diff_off" },
    { key = "normal", text = loc_prefix .. "diff_normal" },
})
difficulty:set_default_value("normal")
```

- **怎么做**：需要"多选"时，注册 N 个 `checkbox`（每个选项一个键），别找 multibox。
- **验收**：每个控件在菜单里都能改、改完重开游戏仍保留。

> ⚠️ 坑：用 `multibox` → 菜单里不出现或点了没反应（类型未实现），且**不报错**。

## 4. 读取设置

```lua
local mct = get_mct()                          -- 战斗中同样可用
local mod = mct:get_mod_by_key("su_fymsm")     -- 按注册 key 取 mod
local opt = mod:get_option_by_key("guard_inf_mis")
local value = opt:get_finalized_setting()      -- boolean
```

| 函数 | 语义 |
|---|---|
| `get_finalized_setting()` | **最终生效值**（已考虑锁定/预设/多人同步），业务代码读这个 |
| `get_selected_setting()` | UI 上当前选中的值 |
| `get_key()` / `get_text()` | 键名 / 显示文本 |

**必须写成"读不到就用默认值"**，四处都要防：`get_mct` 为 nil / `mct` 为 nil / `get_mod_by_key` 返回 nil / `get_option_by_key` 返回 nil。参考 `<WORKSPACE>\su_fymsm\script\battle\mod\su_fymsm.lua` 的 `su_fymsm_read_settings()`：先填内置默认表，再逐项用 MCT 值覆盖，整体包 `pcall`。

- **验收**：未装 MCT 时功能仍按内置默认值工作，`lua_mod_log.txt` 出现"using built-in defaults"类日志，无脚本错误。

> ⚠️ 坑：直接 `mct:get_mod_by_key(...):get_option_by_key(...):get_finalized_setting()` 链式取值 → 玩家没装 MCT 或 mod 未注册时脚本整体报错，功能全废。

## 5. 菜单文本（loc）

文件：`text\db\<名>.loc.tsv`，列头固定 `key	text	tooltip`，第 2 行 `#Loc;1;text/db/<名>.loc`。

```
key	text	tooltip
#Loc;1;text/db/su_fymsm_mct.loc		
su_fymsm_mod_title	默认防御模式（按兵种标签） / Default Guard Mode by Unit Tag	false
su_fymsm_opt_inf_mis	远程步兵 / Missile Infantry	false
su_fymsm_opt_inf_mis_tt	弓箭手、弩手、火枪手等远程步兵。\\n\\nMissile infantry.	false
```

- 菜单里凡是被 `set_text(..., true)` / `set_tooltip_text(..., true)` 引用的键，**都必须**在此表里定义。
- 换行必须写**双反斜杠** `\\n`（规则与全游戏 loc 一致，见 `references/50-本地化与翻译.md`）。
- **验收**：`node "<SKILL>\tools\modcheck\check.js" <MOD目录> --vanilla "<VANILLA>\db"` 的本地化组通过；游戏内无键名原文。

## 6. 战斗环境读取（关键）

MCT 框架**主动支持战役内战斗**：

| 环境 | 值来源 |
|---|---|
| 战役内战斗 | 与战役共用同一套已保存设置 |
| 快速战斗 / 前端 | 使用全局设置 |

- **依据**：`script\groovy\modules\mct\systems\registry\main.lua` 头部注释与 `__game_mode == __lib_type_battle` 分支；UI 上下文含 `battle.lua`。
- **怎么做**：在 `script\battle\mod\*.lua` 里直接 `get_mct()` 即可，无需把值从战役侧透传。
- **验收**：战役里改设置 → 进战斗 → 战斗脚本读到的值随之变化（可在脚本里打日志核对）。

> ⚠️ 坑：假设"战斗中读不到 MCT"而改用战役侧 `cm:set_saved_value` 透传 → 多写一层无谓的同步代码，且快速战斗无值可用。

## 7. 作者案例可复制实例

| 文件 | 说明 |
|---|---|
| `<WORKSPACE>\su_fymsm\script\mct\settings\su_fymsm_mct.lua` | 10 个 checkbox 的完整菜单（数组驱动，便于增删） |
| `<WORKSPACE>\su_fymsm\text\db\su_fymsm_mct.loc.tsv` | 中英成对菜单文本 |
| `<WORKSPACE>\su_fymsm\script\battle\mod\su_fymsm.lua` | 战斗侧读取 + 默认值退化 |
| `<REFERENCE>\su_fymsm_mct_ref\groovy_mct.pack` | 框架本体（解包后查源码用） |
| `<REFERENCE>\su_fymsm_mct_ref\wyccc_ai_overhaul.pack` | 最小菜单实例（21 行） |

## 8. 反模式

| 错误 | 后果 | 正确做法 |
|---|---|---|
| 不判断 `get_mct` 是否为 nil | 未装 MCT 的玩家脚本报错、功能全废 | 读设置整体包 `pcall` + 内置默认值兜底 |
| 用 `multibox` 做多选 | 控件不出现且无报错 | 拆成多个 `checkbox` |
| 把菜单脚本放 `script\campaign\mod\` | 菜单不出现 | 放 `script\mct\settings\` |
| 忘记给 loc 键写条目 | 界面显示键名原文 | 每个 `set_text` 的键都在 loc 里定义 |
| loc 换行写单反斜杠 `\n` | 文本里出现字面 `\n` | 写 `\\n` |

## 9. 验收清单

- [ ] `script\mct\settings\<名>.lua` 与 `text\db\<名>.loc.tsv` 均已打包进 pack
- [ ] 游戏内 MCT 列表出现该 MOD，分区与控件齐全、文案为中文
- [ ] 每个控件改动能保存（重开游戏仍在）
- [ ] 未装 MCT 的环境：脚本不报错，按内置默认值工作
- [ ] 战斗侧读取的值随菜单变化（日志核对）
- [ ] `modcheck` 本地化组通过
