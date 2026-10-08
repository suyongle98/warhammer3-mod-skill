# 33 · DDS 贴图检查与恢复

> 适用：WH3 9.0.2 的材质贴图维护 ｜ 事实截止：2026-10-08。
> 来源：scnjwyc 技能包 `b92d85e` 的贴图分类方法；Microsoft DDS / DXGI 文档；本地 Node 头检查工具。
> 边界：格式依据与检查流程已核对；本次没有转换生产贴图、回填 pack 或游戏内验收。上游案例的发灰、眼部异常不作为作者环境实测。

## 1. 先追材质，再判断格式

沿 `VariantMeshDefinition`、`wsmodel`（存在时）、活动 `.rigid_model_v2` 的实际材质引用取得 DDS。以完整 pack 内路径匹配，不能因文件名相同就当成同一张贴图。颜色、法线、材质通道分别处理；线性法线/材质图不能套颜色图的 sRGB 输出规则。

**保留可信原图的格式、宽高、Mip 与通道语义。** 不根据已经损坏或丢失 Alpha 的当前图反推原始格式；恢复应回到原版 pack、作者原始包或可核对的版本库 Blob。记录来源版本和 SHA256。传统 DDS 头没有显式 DXGI sRGB 标志，不能据此断言该图在游戏中按线性颜色采样。

| 原始形式 | 格式事实与检查重点 |
|---|---|
| DXT1 / BC1 | 可有 1-bit 透明；FourCC 本身不能区分实际是否用了透明像素，需解码 Alpha 或检查压缩块 |
| DXT3 / BC2 | 保留其显式 Alpha 语义；不能只因有 Alpha 就一律重压成 DXT5 |
| DXT5 / BC3 | 支持插值 Alpha，复核眼部、发丝、衣物边缘与材质用途 |
| DX10 BC7 | 保留原图的 UNORM / UNORM_SRGB；作者环境 ImageMagick 是否能编码此格式需另查，不能宣称已支持 |
| DX10 BC6H | HDR RGB 压缩，不保存 Alpha；不能作为 LDR 角色颜色图的统一恢复目标 |
| BC4 / BC5 / 未识别格式 | 先查材质通道用途和当前解码器；不要强行按颜色图转换 |

BC6H 输出再转 BC3 不能恢复已经丢失的 Alpha。BC6H 用于 HDR 资源本身不是错误；上述约束限于恢复原来有明确 LDR/Alpha 语义的角色贴图。

## 2. 只读头检查

```powershell
& 'node' '<技能根目录>\scripts\dds-inspect.js' '<原始.dds>' '<候选.dds>'
```

双击或拖放使用 `scripts/dds-inspect.bat`。输出 JSON：SHA256、宽高、Mip、传统 FourCC 或 DXGI 编号、格式和颜色空间标记、Alpha 检查提示。成功退出 0；文件/头错误为 1；参数错误为 2。

工具**只检查头信息并计算文件 SHA**，不解码像素、不验证压缩载荷是否完整、不证明引擎兼容或 Alpha 实际保留。未知 DXGI 显示 `UNKNOWN`，头可读不表示格式可用。宽高/Mip 的来源值和原始标志也会输出；没有显式 Mip 时按单层解释，并保留原始计数供审查。

像素验收使用工具清单与准备内的可用解码器；不支持的 BC7/HDR 图需要用户提供兼容解码/编码工具或 PNG 与 Alpha 分离预览。Alpha 的含义由材质决定，不能把所有 Alpha 都当透明度。

## 3. 批量恢复与替换

1. 在 MOD 源目录外准备批次；原始字节存为不可变输入，候选另存，避免检查资料被打进 pack。
2. 清单记录完整相对路径、原始来源与 SHA、当前 SHA、候选 SHA、尺寸、Mip、格式、材质用途。任何待恢复文件缺可信来源时，保留待处理状态。
3. 候选逐张与原始尺寸/Mip/用途对拍，解码检查方向、颜色与 Alpha；保留无需修改的原图字节，避免重复有损压缩。
4. 整批预检：没有缺失、重复、歧义同名或清单外输出；目标路径落在指定 MOD 源目录；原始输入 SHA 未变。按完整相对路径回填，不猜测平铺文件名的对应关系。
5. 备份本批要覆盖的当前源文件后应用；逐张读回 SHA。中途失败时恢复已写文件，报告恢复结果和未完成项。
6. 打包按 `03` 与项目规则执行。用户已授权打包时，用现成工具导出本批内部 DDS 并比对源 SHA；诊断通过仍须游戏内验收。

Mip 改变、格式改变或分辨率改变若本就是任务目标，应单独记录批准的差异及效果验证，不把恢复流程变成禁止任何资源优化的规则。

## 4. 验收与来源

- [ ] 来源、活动材质、完整路径可追溯；原始输入未被转换覆盖。
- [ ] 头信息对拍，候选像素、Alpha、方向已看过；未知/不支持格式没有自动转换。
- [ ] 如已回填，清单外源文件未变，源/pack 读回一致；打包与部署状态分别报告。
- [ ] 游戏内近景/远景、眼睛/发丝边缘、不同光照检查完成；未测项明确记录。

来源：[上游贴图流程](https://github.com/scnjwyc/warhammer3-mod-development-skill/blob/b92d85eadd82a1d94b6e4e9cf519313ee1624e02/skills/warhammer-character-textures/references/batch-workflow.md)、[Microsoft DDS_HEADER](https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-header)、[DXGI_FORMAT](https://learn.microsoft.com/en-us/windows/win32/api/dxgiformat/ne-dxgiformat-dxgi_format)、[BC6H/BC7](https://learn.microsoft.com/en-us/windows/win32/direct3d11/texture-block-compression-in-direct3d-11)。详细融入范围见 `91` §7。
