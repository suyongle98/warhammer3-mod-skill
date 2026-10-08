# RPFM pack 辅助工具

依赖 Node 与兼容 RPFM server，默认本地 127.0.0.1:45127 /mcp。设置 RPFM_SERVER 为实际可执行文件路径，或先手动启动 server。请先在 RPFM 配置 WH3 游戏路径、schema 和依赖；没有服务端就用 RPFM 界面，不猜软件位置。

```text
node inspect.js <pack-A> [pack-B]
node extract.js <pack> <output-dir> [path-prefix ...]
node pack.js <mod-source-dir> [output.pack]
```

这些是参数格式，尖括号要换实际路径。打包前执行 tools/modcheck/check.js。pack.js 导入 db/**/*.tsv 和 text/**/*.loc.tsv，其余顶层资源目录原样添加；根目录说明文件、打包版、_work、参考mod、.git 等不进 pack。默认输出 MOD目录/打包版/目录名.pack；显式输出地址按参数执行，运行前确认目标。

磁盘文件名的 __STAR__ 打包时还原为 *，用于 pack 内文件名含 Windows 非法字符的情况；普通下划线不会自动还原星号。DB 元数据与 pack 内路径要一致。

基于 RPFM server 5.0.6 的已验证接口封装：同一流水线保持同一 MCP session；new_packed_file 参数需 JSON 字符串；导入前先建文件；资源按目录递归加入。新版服务器接口可能变化，需要验证。未附第三方二进制，书中不会声明已安装或已启动。

本分享版对依赖缺失、脚本语法和迁移路径做了核验；打包/解包的游戏资源格式仍以相应工具版本和实际 MOD 为准。部署与公开发布按使用者授权执行。
