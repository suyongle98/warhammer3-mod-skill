# 40 · Lua 战役脚本

> 适用：WH3 ｜ 事实截止：2026-10-10（新档事件及召唤接口局部复核）
> 来源：`游戏原文件\script\_lib\lib_campaign_manager.lua`（L1411-1452、L2219-2499、L2813、L3667-3706、L6431-6670、L8053、L14820-15010、L15746）；`游戏原文件\script\_lib\lib_mod_loader.lua`；`游戏原文件\db\campaigns_tables\data__.tsv`；教程 18/22
> 可信度：A ｜ 指纹：`campaigns_tables` 3 行（`wh3_main_chaos` / `wh3_main_combi` / `wh3_main_prologue`）
> 再生成：重读 `lib_campaign_manager.lua` 的 First Tick 段与 `lib_mod_loader.lua`；表结构变更后重导 `campaigns_tables`
> 局部核验：2026-10-10；安装版9.0.3的战役库与Boris召唤脚本已核对，其他历史条目未全量重测；版本范围见 `05-版本维护与核验.md`。

## 0. 一页速览

1. 脚本放 `script/campaign/<战役脚本目录>/mod/`；**通用脚本直接放 `script/campaign/mod/`**（对所有战役生效）。
2. 注册监听器一律用 `cm:add_first_tick_callback`（**含读档**）；`_new` 系列只在**新游戏**触发。
3. 只用 **Lua 5.1** 语法，文件 **UTF-8 无 BOM**，提交前跑 `luac5.1.exe -p`。
4. 存档状态用 `cm:get_saved_value` / `cm:set_saved_value`，不要自己造持久化。
5. 每个引擎调用前先判 `nil` / `is_null_interface()` / `is_dead()`。
6. 战役 key 从当前原版脚本和 `campaigns_tables` 核对，不按名称猜测。

## 1. 脚本目录结构

| 位置 | 生效范围 | 依据 |
|---|---|---|
| `script/campaign/mod/*.lua` | 所有战役 | `lib_mod_loader.lua` L87 |
| `script/campaign/<战役脚本目录>/mod/*.lua` | 单个战役 | `lib_mod_loader.lua` L88 |
| `script/_lib/mod/*.lua` | 所有环境（战役/战斗/前端） | `lib_mod_loader.lua` L86、L107、L117 |
| `script/battle/mod/*.lua` | 战斗 | 见 `41-战斗脚本.md` |

**战役脚本目录名以 `campaigns_tables.script_path` 为准（实测 3 行）**：

| `campaign_name` | 战役 | `script_path` | 战役 mod 脚本目录 |
|---|---|---|---|
| `wh3_main_combi` | 超凡帝国 | `script/campaign/main_warhammer` | `script/campaign/main_warhammer/mod/` |
| `wh3_main_chaos` | 混沌魔域 | `script/campaign/wh3_main_chaos` | `script/campaign/wh3_main_chaos/mod/` |
| `wh3_main_prologue` | 序章 | `script/campaign/wh3_main_prologue` | `script/campaign/wh3_main_prologue/mod/` |

- **怎么做**：目录名取 `script_path` 的末段（`main_warhammer` / `wh3_main_chaos`），不要用 `campaign_name`。
- **验收**：`游戏原文件\script\campaign\` 下存在同名目录；脚本能在日志里打出自己的 `out()`。

> ⚠️ 坑：把超凡帝国脚本放到 `script/campaign/wh3_main_combi/mod/` → 该目录不存在，脚本永不加载（`wh3_main_combi` 是**战役 key**，不是脚本目录名）。

**加载与执行时机（`lib_mod_loader.lua`）**：

```
NewSession 事件 → core:load_mods("/script/_lib/mod/", "/script/campaign/mod/", "/script/campaign/<战役>/mod/")
                → 逐文件执行文件顶层代码，并调用与文件同名的函数（若存在，类似构造函数）
first tick      → cm:add_first_tick_callback(function() core:execute_mods(context) end)
```

- **怎么做**：文件顶层只写定义与注册；**需要游戏世界就绪的逻辑放进回调**。
- **验收**：日志中 `ScriptEventAllModsLoaded` 之后才出现你的运行时输出。

## 2. Lua 文件规范

| 项 | 要求 | 验收 |
|---|---|---|
| 编码 | UTF-8 **无 BOM** | 首 3 字节不是 `EF BB BF`（`Get-Content` 首字符不是 `\ufeff`） |
| 语法 | 仅 Lua 5.1 | `luac5.1 -p <file.lua>` 无输出即通过 |
| 禁用 | `goto` / `::label::`、`//`、位运算 `~`、`continue` | 用 `if/else` 或提前 `return` 替代 |
| 文件名 | 与内部构造函数同名（约定） | 见 §8.1 |

> ⚠️ 坑：Lua 文件带 BOM → `luac5.1.exe` 报 `near '�'`，引擎同样拒绝加载。

## 3. first tick 回调族（实证结论，必须按此选）

来源：`lib_campaign_manager.lua` L2219-2330 定义、L2471-2499 执行顺序。**执行顺序如下**：

| 顺序 | API | 触发条件 |
|---|---|---|
| 1 | `cm:add_pre_first_tick_callback(fn)` | 最先；无论新档/读档、单机/多人 |
| 2 | `cm:add_first_tick_callback_new(fn)` | **仅新游戏**（内部同时插入 mp_new 与 sp_new 两张表，L2327-2328） |
| 2 | `cm:add_first_tick_callback_sp_new(fn)` | **仅单机新游戏** |
| 2 | `cm:add_first_tick_callback_mp_new(fn)` | **仅多人新游戏** |
| 3 | `cm:add_first_tick_callback_sp_each(fn)` | **单机每局**（新档 + 读档） |
| 3 | `cm:add_first_tick_callback_mp_each(fn)` | **多人每局**（新档 + 读档） |
| 4 | `cm:add_first_tick_callback(fn)` | **全局**，含读档（L2241 注释："regardless of what mode the campaign is being loaded in"） |
| 5 | `cm:add_post_first_tick_callback(fn)` | 最后；无论新档/读档 |

- **怎么做**：**注册事件监听器、执行每局都要跑的初始化，一律用 `cm:add_first_tick_callback`**；只在"开新档才做一次"的逻辑（发开局军队、发初始装备）用 `_new`。
- **新档资格与恢复重试**：开局事件需只服务新档、又要在早期读档后继续重试时，`_new`只写入存档资格，每局回调恢复有资格且未发出的监听；具体两难返回值与防重复见25册§3.3。回调中延后执行的函数不能把当时的 `cm:is_new_game()`当作持久资格。
- **验收**：存档后读档重进，日志里仍能看到 `add_first_tick_callback` 内的输出；`_new` 内输出**不会**再次出现。

> ⚠️ 坑：用 `cm:add_first_tick_callback_new` 注册监听器 → 读档时回调不触发，监听器从未注册，脚本"存档后失效"（这是本库内 `lua_api.md` 与正文冲突点的实证结论，以本册为准）。
> ⚠️ 坑：以为 `cm:add_first_tick_callback` 只在开新档触发 → 实际读档也触发，未做幂等保护的初始化会重复执行。

**首次 tick 时加载画面通常还在**（L2223）：要在屏幕上显示内容，用 `core:progress_on_loading_screen_dismissed(fn)` 延后。

## 4. 事件监听器

**位置**：必须在 `cm:add_first_tick_callback` 内调用 `core:add_listener`；顶层注册不生效。

```lua
cm:add_first_tick_callback(function()
    core:add_listener(
        "my_mod_turn_listener",      -- 1 唯一名称
        "FactionTurnStart",          -- 2 事件名
        function(context) return true end,  -- 3 条件（返回 true 才执行回调）
        function(context)            -- 4 回调
            out("my_mod: turn " .. tostring(cm:turn_number()))
        end,
        true                         -- 5 persistent：true 持续监听，false 触发一次即移除
    )
    out("my_mod: listener registered")
end)
```

- **怎么做**：监听器名加 MOD 前缀，避免与其他 MOD 撞名；每局初始化都要 `out()` 一行证明注册成功。
- **验收**：日志出现注册行，且事件触发时出现回调行。

**常用事件名**（从 `游戏原文件\script\` 全库出现频次统计，频次高即主流用法）：

| 事件 | 时机 | 出现次数 |
|---|---|---|
| `FactionTurnStart` | 派系回合开始 | 219 |
| `ScriptEventPlayerFactionTurnStart` | 玩家派系回合开始（脚本事件） | 117 |
| `MissionSucceeded` | 任务成功 | 106 |
| `RitualCompletedEvent` | 仪式完成 | 104 |
| `BattleCompleted` | 战斗结束 | 97 |
| `DilemmaChoiceMadeEvent` | 两难选项已选 | 79 |
| `CharacterCompletedBattle` | 角色打完一场战斗 | 61 |
| `CharacterPerformsSettlementOccupationDecision` | 占城决策 | 58 |
| `WorldStartRound` | 新一轮开始 | 54 |
| `PooledResourceChanged` | 池资源变化 | 43 |
| `RegionFactionChangeEvent` | 地区易主 | 40 |
| `FactionTurnEnd` | 派系回合结束 | 39 |
| `BuildingCompleted` | 建筑完成 | 31 |
| `PendingBattle` | 待处理战斗 | 30 |
| `DilemmaIssuedEvent` | 两难已发布 | 27 |
| `ResearchCompleted` | 科技完成 | 25 |
| `CharacterCreated` | 角色创建 | 23 |
| `CharacterTurnStart` | 角色回合开始 | 18 |
| `CharacterConvalescedOrKilled` | 角色康复/死亡 | 15 |
| `UnitTrained` | 单位训练完成 | 13 |
| `CharacterRecruited` | 角色招募 | 10 |

- **怎么做**：写新事件前，先在 `游戏原文件\script\` 里 grep 该事件名，抄一处现成用法。
- **验收**：grep 有命中，且监听器条件函数字段名（如 `context:faction()`、`context:character()`)与现成用法一致。

**按派系名挂回合开始监听**：`cm:add_faction_turn_start_listener_by_name(listener_name, faction_name, callback, persistent)`（`lib_campaign_manager.lua` L2813）。

## 5. `cm:` 与 faction 对象 API 速查

### 5.1 常用 `cm:`（`campaign_manager`）

| 功能 | 签名 | 位置 |
|---|---|---|
| 取派系 | `cm:get_faction(faction_specifier, error_if_not_found)` | L8053 |
| 取派系列表 | `cm:get_faction_list()` / `cm:get_factions_by_culture(key)` / `cm:get_factions_by_subculture(key)` | L3858/3999/4016 |
| 强制结盟 | `cm:force_alliance(faction_a, faction_b, make_allies)` | 引擎提供；用法见 `script/campaign/wh3_main_chaos/wh3_tol_something_rotten_in_kislev.lua` L667 |
| 生成军队 | `cm:create_force(faction_key, unit_list, region_key, x, y, exclude_named_characters, success_callback)` | L6453 |
| 生成带将领军队 | `cm:create_force_with_general(faction_key, unit_list, region_key, x, y, agent_type, agent_subtype, forename, clan_name, family_name, other_name, make_faction_leader, success_callback, force_diplomatic_discovery, no_background_trait)` | L6670 |
| 应用效果捆绑 | `cm:apply_effect_bundle(bundle_key, faction_name, turns)`（`turns=0` 永久） | L14820 |
| 移除效果捆绑 | `cm:remove_effect_bundle(bundle_key, faction_name)` | L14851 |
| 应用到部队/角色/地区 | `cm:apply_effect_bundle_to_force(...)` / `_to_characters_force(...)` / `_to_region(...)` | L14873/14926/14979 |
| 新建自定义捆绑 | `cm:create_new_custom_effect_bundle(bundle_key)` → bundle 对象 | 引擎提供；用法见 `script/campaign/main_warhammer/wh_start.lua` L545 |
| 自定义捆绑入派系 | `cm:apply_custom_effect_bundle_to_faction(effect_bundle, faction_object)` | 引擎提供；同上 L553 |
| 触发两难 | `cm:trigger_dilemma(faction_key, dilemma_key, on_trigger_callback)` | L15746 |
| 存档值 | `cm:get_saved_value(name)` / `cm:set_saved_value(name, value)` | L1416/1840 |
| 缓存值 | `cm:get_cached_value(name, generator_callback)` | L1426 |
| 延迟回调（**秒**） | `cm:callback(fn, interval_seconds, name?)` | L3673 |
| 重复回调（**秒**） | `cm:repeat_callback(fn, interval_seconds, name?)` | L3684 |
| 取消回调 | `cm:remove_callback(name)` | L3693 |
| 真实时间回调（**毫秒**） | `cm:real_callback(fn, interval_ms, name?)` | L3704 |
| 回合数 | `cm:turn_number()` | L4360 |
| 是否新档 | `cm:is_new_game()` | L4220 |
| 是否多人 | `cm:is_multiplayer()` | L4206 |
| 本地派系 | `cm:get_local_faction_name(force)` | L3747 |
| 自定义战场 | `cm:add_custom_battlefield(...)` | L17361 |

> ⚠️ 坑：使用 `cm:add_turn_callback` → **该函数不存在**（`lib_campaign_manager.lua` 全库 grep 无命中）。回合逻辑用 `core:add_listener` + `FactionTurnStart` / `WorldStartRound`，或 `cm:add_faction_turn_start_listener_by_name`。
> ⚠️ 坑：把 `cm:callback` 的间隔当毫秒 → 它是**秒**；只有 `cm:real_callback` / 战斗 `bm:callback` 用毫秒。

### 5.2 faction 对象

| 方法 | 用途 |
|---|---|
| `faction:is_dead()` | 是否已灭亡 |
| `faction:is_null_interface()` | 是否是空接口（必须先查） |
| `faction:name()` | 派系 key |
| `faction:culture()` | 种族级文化，取值见 `cultures_tables.key`（如震旦 `wh3_main_cth_cathay`、巴托尼亚 `wh_main_brt_bretonnia`），**脚本里很少用** |
| `faction:subculture()` | 具体文化归属，取值见 `cultures_subcultures_tables.subculture`（如 `wh3_main_sc_cth_cathay`），**派系检查用这个** |
| `faction:has_effect_bundle(bundle_key)` | 是否已有某捆绑 |
| `faction:allied_with(other_faction)` | 是否同盟 |

- **怎么做**：任何拿到 faction 的地方先写统一存活检查：

```lua
local function is_faction_alive(faction_key)
    local faction = cm:get_faction(faction_key)
    return faction and not faction:is_null_interface() and not faction:is_dead()
end
```

- **验收**：脚本对已灭亡派系 key 调用时不报错、日志有明确跳过信息。

> ⚠️ 坑：把 `wh3_main_sc_cth_cathay`与 `faction:culture()`比较会失败；该键属于subculture。`culture()`用 `cultures_tables.key`（如 `wh3_main_cth_cathay`），`subculture()`用 `cultures_subcultures_tables.subculture`；按目标范围选方法，不能混用键域。

## 6. Effect Bundle 动态操作

```lua
-- 1) 用 DB 里预定义的捆绑
cm:apply_effect_bundle("my_bundle_key", "wh3_main_cth_the_western_provinces", 0)  -- 0 = 永久
cm:remove_effect_bundle("my_bundle_key", "wh3_main_cth_the_western_provinces")

-- 2) 运行时新建自定义捆绑
local bundle = cm:create_new_custom_effect_bundle("my_custom_bundle")
bundle:add_effect("wh3_main_effect_...", "faction_to_faction_own_unseen", 10)
bundle:set_duration(0)  -- 0 = 永久
cm:apply_custom_effect_bundle_to_faction(bundle, cm:get_faction("wh3_main_cth_the_western_provinces"))
```

**常用 scope**：

| scope | 作用对象 |
|---|---|
| `faction_to_faction_own_unseen` | 派系→自身（不显示 UI） |
| `faction_to_force_own_unseen` | 派系→所有部队 |
| `faction_to_province_own_unseen` | 派系→所有行省 |
| `faction_to_region_own_unseen` | 派系→所有地区 |
| `faction_to_character_own_unseen` | 派系→所有角色 |
| `force_to_force_own` | 部队→自身 |

- **怎么做**：`add_effect` 的 effect key 必须存在于 `effects_tables`，scope 必须来自 `campaign_effect_scopes_tables`；先抄一条原版同类行。
- **验收**：游戏内该派系效果面板出现预期条目；日志无 `Invalid reference`。

## 7. 存档值：跨档迁移

| API | 说明 |
|---|---|
| `cm:get_saved_value(name)` | 返回 `boolean` / `number` / `string` 或 `nil`（L1413） |
| `cm:set_saved_value(name, value)` | 自动随存档保存与加载，**无需**注册 `add_loading_game_callback` / `add_saving_game_callback`（L1412） |
| `cm:get_cached_value(name, generator)` | 首次调用生成并写入，之后从存档读回（L1422-1452） |

- **怎么做**：用"键存在即已做过"的幂等模式，避免读档重复发奖励：

```lua
local KEY = "my_mod_initial_units_granted"
cm:add_first_tick_callback(function()
    if cm:get_saved_value(KEY) then return end   -- 已发过，直接退出
    -- …发放逻辑…
    cm:set_saved_value(KEY, true)
end)
```

- **验收**：发奖励 → 存档 → 读档，奖励不再重复；`get_saved_value` 首次为 `nil`，之后为 `true`。

> ⚠️ 坑：把 Lua 全局变量当持久化 → 读档后为 `nil`，状态丢失。
> ⚠️ 坑：新档与读档共用一段初始化且没做幂等 → 读档重复触发（重复发布任务/重复发装备）。

## 8. 教程场景（18 / 22）

### 8.1 自定义开局军队（教程 18）

- 脚本名即"构造函数名"：**文件名与内部函数名两处必须一致**（教程 18 第二步：上下两处蓝框文字必须相同）。
- 四个字段：

| 字段 | 对应表 | 说明 |
|---|---|---|
| `faction` | `factions_tables.key` | 势力代码 |
| `subtype` | `agent_subtypes_tables.key` | 将领/英雄子分类 |
| `forename` | `names_tables.id`，本地化键名前缀 `names_name_` | 将领名字（如 `names_name_2147344345`）；可按中文名在本地化库反查 id |
| `units` | `main_units_tables.unit` | 单位代码（逗号分隔；`land_units` 键见 `create_force` 的 unit list） |

- **怎么做**：取码查当前 `游戏原文件/db/` 对应表。`create_force` / `create_force_with_general` 的 `unit_list` 取 **`land_units` 键**（当前 `lib_campaign_manager.lua` L6434、L6638）。
- **验收**：进新游戏后目标派系开局军队与脚本一致；`luac5.1.exe -p` 通过；日志出现脚本自身 `out()`。
- **选人界面不会变**：改动需动 `startpos.esf`，兼容性代价大，一般不推荐（教程 18 结论）。

### 8.2 召唤（教程 22，六种触发场景）

| # | 场景 | 备注 |
|---|---|---|
| 1 | 开局进入招募池 | 仅新游戏 |
| 2 | 直接召唤入招募池 | 兼容旧存档；配合条件可防重复作用 |
| 3 | 建筑完成进入招募池 | 用 `BuildingCompleted` 事件 |
| 4 | 英雄召唤至指定坐标 | 需坐标 |
| 5 | 科技解锁领主 | — |
| 6 | 占领某地召唤领主 | 地区码查 `regions_tables` |

- **怎么做**：按当前原版 `spawn_character_to_pool`参数填写姓名键与不朽布尔值，不能沿用WH2教程断言“脚本召唤必无专名与不朽”。9.0.3 `wh3_main_chaos/wh3_boris.lua`原版调用第10参数为 `true`；接线及适用范围见25册§2.1–§2.2，角色实际名字和不朽仍需游戏验收。
- **验收**：触发条件满足后目标单位出现在招募池或地图上；读档重进不重复召唤（用 §7 幂等键）。
- 坐标从目标战役的当前角色/区域接口取得并记录；生成军队前核对地形可用位置，按当前 `cm` 接口检查与游戏实测。

## 9. 调试

| 手段 | 用法 |
|---|---|
| `out(msg)` | 写入 `script_log_*.txt`；`out.inc_tab()` / `out.dec_tab()` 缩进 |
| `ModLog(msg)` | 同时写 `lua_mod_log.txt` 与游戏控制台（`lib_mod_loader.lua` L41-68） |
| `script_error(msg)` | 输出错误并可能中止脚本；参数非法时的统一报错方式 |
| `luac5.1.exe -p <file>` | 提交前语法检查 |

- **怎么做**：关键分支各加一条带 MOD 前缀的 `out()`，用日志确认"走到哪一步"。
- **验收**：日志里能按顺序看到每条边界输出；缺哪条就知道断在哪。

**常见脚本失效原因**：

| 现象 | 首要怀疑 |
|---|---|
| 完全没有输出 | 目录放错（§1）；文件带 BOM；Lua 5.1 语法错误 |
| 读档后失效 | 用了 `_new` 系列（§3） |
| 监听器不触发 | 顶层注册（§4）；事件名拼写错；条件函数恒 false |
| 效果不生效 | effect key / scope 不在原表；bundle key 不存在 |
| 重复执行 | 未做幂等（§7） |
| 回调不按预期时间 | 把 `cm:callback` 当毫秒（§5.1） |

## 10. 验收清单

- [ ] 脚本目录名取自 `campaigns_tables.script_path` 末段，或通用脚本放 `script/campaign/mod/`
- [ ] 文件 UTF-8 无 BOM；`luac5.1.exe -p` 通过；无 `goto` / `//` / `~`
- [ ] 监听器在 `cm:add_first_tick_callback` 内注册，监听器名带 MOD 前缀
- [ ] 每局初始化用 `add_first_tick_callback`；仅新档逻辑才用 `_new`
- [ ] 所有 `cm:get_faction` 结果都过了 `nil` / `is_null_interface()` / `is_dead()` 检查
- [ ] 派系判定用 `subculture()` 而非 `culture()`
- [ ] 持久化状态用 `cm:get_saved_value` / `set_saved_value`，且初始化幂等
- [ ] 关键分支有 `out()` 日志，且已在最新 `script_log_*.txt` 中确认
- [ ] key、目录与字段均已按当前原版核对。
