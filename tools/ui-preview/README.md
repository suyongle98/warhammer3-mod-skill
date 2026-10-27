# UI 离线预览（可选）

将本地 HTML 截成带“非游戏截图”标记的 PNG，另存同名 JSON 报告。用于查看实际素材、文字和近似布局；不解析 TWUI、不执行 CCO，不证明游戏效果。完整工作流见 [43 §6](../../references/43-UI布局与运行时.md)。

## 准备自己的环境

需要 Node.js、已安装的 Chrome，以及 `playwright-core`。本包不附浏览器、npm 依赖、Python、布局适配器或游戏资源；已有环境可直接复用，无需固定安装位置。

1. 核实自己的 Chrome 可执行文件和 `playwright-core` 模块目录。需要安装模块时，可在自选工具目录使用 `npm install playwright-core`；这个包本身不下载浏览器。
2. 复制 `runtime.example.json` 为 `runtime.local.json`，填写真实路径。JSON 中 Windows 路径用 `/` 或双反斜杠。`chrome` 指可执行文件，`playwright` 指模块目录；只有使用 `--build-python` 时才需要 `python`。
3. 所有尖括号值都必须替换；`runtime.local.json` 已被 Git 忽略，分享时不要带上个人配置。也可用 `--config <配置.json>` 指定外置配置。

## 使用

```powershell
node preview.js '<本地预览.html>' --out '<新输出.png>' --width 1600 --height 934
node preview.js '<本地预览.html>' --config '<配置.json>'
```

在本目录运行，或使用脚本的真实完整路径。Windows 可把 HTML 拖给 `preview.bat`；已有 PNG/JSON 默认拒绝覆盖，确需覆盖才加 `--overwrite`。

项目适配器须从正式布局、当前状态、图片和 LOC 生成 HTML，标记手填值及未模拟规则。`--build-python <生成器.py>` 会明确执行该文件，只传已检查过的预览生成器；不能传会重建正式 MOD 源或资源的脚本。

HTTP(S) 资源被阻止，使用本地文件或 data URL。报告记录输入/截图 SHA256、视口、缺图、失败请求与页面异常；输入指纹只覆盖 HTML，外链素材变化后要重新截图。

退出码：0＝本次渲染未检出上述错误；1＝页面/资源/渲染失败；2＝参数或环境失败。视觉重叠、文本裁切、实际字体、游戏自动布局和 UI 缩放仍需人工及实机验收。

## 自检

配置好自己的运行环境后执行 `node selftest.js`；使用外置配置时执行 `node selftest.js '<配置.json>'`。覆盖正常页面、缺图、页面异常、外网请求阻止和拒绝静默覆盖。测试输出在系统临时目录，不执行游戏。发布维护者的检查范围见 [VALIDATION](../../VALIDATION.md)。
