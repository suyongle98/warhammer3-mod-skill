# MOD 静态检查

```text
node check.js <mod-dir> --vanilla <current-export/db> [--ref <reference-export>] [--no-refs] [--strict-en] [--quiet] [--json]
```

DB 改动必须提供原版 DB 目录；也可设置 WH3_DB_DIR 或 WH3_EXPORT_DIR。补丁/汉化给 --ref；不存在的目录拒绝，不会无资料默默通过。--loc 是旧接口保留参数，当前检查不读取全局原版 loc；同路径补丁 loc 的完整性依靠 --ref。

检查 BOM、TSV 元数据与列数、对拍原版表头/版本、首列键重复、loc 和启发式引用闭合，另有少量精确列引用。数字主键提示不是完整 schema 类型校验；I64、复合键、资源路径、动画和游戏效果需另外检查。

Lua 文件存在时，设置 WH3_LUAC 为 Lua 5.1 编译器实际路径才做 -p 语法检查；没有时明确警告。退出 0 无阻塞错误（仍需读警告），1 有错误，2 参数/环境错误。文本语言提示以中文制作场景为主，其他目标语言按需要审阅。

静态通过后再用 RPFM 与游戏核验。脚本无需 npm 包，原版 TSV 和第三方程序需使用者自备。

## 2026-10-27 分享版补充

已按当前来源登记 cooking_recipe_required_ingredients_tables（ingredient + recipe）及 building_level_required_buildings_tables（building_level + required）的复合键，并补 effect/目标的列级引用规则。其他表仍有首列启发式与覆盖盲区，不能当作完整 schema 类型/主键校验。继续使用 --vanilla 或环境变量提供自己的原版；Lua 语法检查仍需 WH3_LUAC。
