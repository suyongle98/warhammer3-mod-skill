# check-tsv.ps1 — 校验战锤3 MOD 的 TSV 文件
#
# 用途：导入 RPFM 前一次性检查最容易出错的项，避免"整表静默不加载"。
# 用法：
#   pwsh -File check-tsv.ps1 -Path "<MODS>/su_qizhi/打包版/db"
#   pwsh -File check-tsv.ps1 -Path "<USER_PATH>" -MaxId 2147483647
#
# 检查项：
#   1. 编码无 BOM（作者当时环境实测全部 TSV 均为 UTF-8 无 BOM）
#   2. 元数据行格式 #<表名>;<版本>;<路径>
#   3. 所有行以制表符分隔且列数与表头一致
#   4. 首列数字主键 ≤ 2,147,483,647（可选，-CheckIds）
#   5. 结尾无多余空行
#
# 退出码：0 = 全部通过；1 = 发现问题

param(
    [Parameter(Mandatory = $true)][string]$Path,
    [switch]$CheckIds,
    [long]$MaxId = 2147483647
)

$ErrorActionPreference = 'Stop'
$problems = 0
$checked = 0

function Test-OneFile([string]$file) {
    $script:checked++
    $rel = $file
    $bytes = [System.IO.File]::ReadAllBytes($file)

    # 1. BOM
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        Write-Output "  [BOM]        $rel  → 存在 UTF-8 BOM，应删除"
        $script:problems++
    }

    $lines = [System.IO.File]::ReadAllLines($file, [System.Text.Encoding]::UTF8)
    if ($lines.Count -lt 2) { Write-Output "  [空文件]     $rel"; $script:problems++; return }

    # 2. 元数据行
    if ($lines[1] -notmatch '^#[^;]+;\d+;') {
        Write-Output "  [元数据行]   $rel  → 第2行不是 '#表名;版本;路径'：$($lines[1])"
        $script:problems++
    }

    # 3. 列数一致（跳过前两行：列名 + 元数据）
    $expected = ($lines[0] -split "`t").Count
    for ($i = 2; $i -lt $lines.Count; $i++) {
        $cols = ($lines[$i] -split "`t").Count
        if ($cols -ne $expected) {
            Write-Output "  [列数]       $rel  → 第 $($i+1) 行 $cols 列，表头 $expected 列"
            $script:problems++
            break
        }
    }

    # 4. 主键范围（可选）
    if ($CheckIds) {
        for ($i = 2; $i -lt $lines.Count; $i++) {
            $first = ($lines[$i] -split "`t")[0]
            $n = 0
            if ([long]::TryParse($first, [ref]$n) -and $n -gt $MaxId) {
                Write-Output "  [主键溢出]   $rel  → 第 $($i+1) 行 = $n > $MaxId"
                $script:problems++
                break
            }
        }
    }

    # 5. 结尾空行
    if ($lines.Count -gt 2 -and $lines[$lines.Count - 1] -eq '') {
        Write-Output "  [尾部空行]   $rel"
        $script:problems++
    }
}

if (Test-Path -LiteralPath $Path -PathType Container) {
    Get-ChildItem -LiteralPath $Path -Recurse -Filter '*.tsv' | ForEach-Object { Test-OneFile $_.FullName }
}
elseif (Test-Path -LiteralPath $Path) {
    Test-OneFile (Resolve-Path -LiteralPath $Path).Path
}
else {
    Write-Output "路径不存在：$Path"; exit 1
}

Write-Output ""
Write-Output "检查 $checked 个文件，发现 $problems 个问题。"
if ($problems -gt 0) { exit 1 } else { exit 0 }
