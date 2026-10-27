# diff-row.ps1 -- field-by-field diff: a MOD row vs the VANILLA row it was cloned from
#
# WHY THIS EXISTS
#   "Clone a vanilla row, then change a few fields" is the only sane way to write a
#   70+ column ability row. But the clone source MUST be semantically equivalent.
#   If you clone e.g. a "cast on a friendly unit" ability and then hand-flip the
#   target flags, the target-flag group can contradict itself:
#
#       affect_self / target_self / target_friends / target_enemies / target_ground
#       only_affect_target / num_effected_friendly_units / effect_range / target_intercept_range
#
#   The engine does NOT error on this. The ability just appears in the bar and
#   cannot be cast ("can target others, but nothing happens when you click").
#   See references/21-技能与法术制作.md section 3.1.
#
#   This script prints every field that differs, so you can confirm that ONLY the
#   fields you meant to change are different -- and that no target flag drifted.
#
# USAGE (PowerShell 5.1+ / pwsh)
#   powershell -NoProfile -ExecutionPolicy Bypass -File diff-row.ps1 `
#     -Table unit_special_abilities_tables `
#     -ModTsv "<WORKSPACE>/@su_wzw/db/unit_special_abilities_tables/su_wzw.tsv" `
#     -ModKey su_wzw_banner_active_seven_in_seven_out `
#     -VanKey wh2_dlc15_item_abilities_lucky_banner
#
#   # compare every row of a mod table against its own vanilla template
#   powershell -NoProfile -ExecutionPolicy Bypass -File diff-row.ps1 `
#     -Table unit_abilities_tables -ModTsv "...\su_wzw.tsv" -ModKey "*" -VanKey wh2_dlc15_banner_passive_da_immortulz
#
# EXIT CODE: 0 = compared OK (diffs are listed; identical rows are reported too)
#            1 = table / row not found

param(
    [Parameter(Mandatory = $true)][string]$Table,
    [Parameter(Mandatory = $true)][string]$ModTsv,
    [Parameter(Mandatory = $true)][string]$ModKey,
    [Parameter(Mandatory = $true)][string]$VanKey,
    [string]$VanDb = $env:WH3_DB_DIR
)

$ErrorActionPreference = 'Stop'
if (-not $VanDb -and $env:WH3_EXPORT_DIR) { $VanDb = Join-Path $env:WH3_EXPORT_DIR 'db' }
if (-not $VanDb) { Write-Output 'Provide -VanDb, WH3_DB_DIR or WH3_EXPORT_DIR'; exit 2 }

$vanFile = Join-Path $VanDb "$Table\data__.tsv"
if (-not (Test-Path -LiteralPath $vanFile)) { Write-Output "vanilla table not found: $vanFile"; exit 1 }
if (-not (Test-Path -LiteralPath $ModTsv)) { Write-Output "mod tsv not found: $ModTsv"; exit 1 }

$vanLines = [System.IO.File]::ReadAllLines($vanFile, [System.Text.Encoding]::UTF8)
$modLines = [System.IO.File]::ReadAllLines($ModTsv, [System.Text.Encoding]::UTF8)
$hdr = $vanLines[0] -split "`t"
$tab = [char]9

if ($modLines.Count -lt 2 -or $vanLines.Count -lt 2) { Write-Output "invalid TSV: header and metadata required"; exit 1 }
$vanMeta = [regex]::Match($vanLines[1], '^#([^;]+);(\d+);')
$modMeta = [regex]::Match($modLines[1], '^#([^;]+);(\d+);')
if (-not $vanMeta.Success -or -not $modMeta.Success -or $vanMeta.Groups[1].Value -cne $Table -or $modMeta.Groups[1].Value -cne $Table -or $vanMeta.Groups[2].Value -cne $modMeta.Groups[2].Value) {
    Write-Output 'schema mismatch: table name or version differs'; exit 1
}
if ($modLines[0] -cne $vanLines[0]) {
    Write-Output "schema mismatch: column names/order differ; run modcheck before field diff"
    exit 1
}
foreach ($entry in @(@{ Name = 'vanilla'; Lines = $vanLines }, @{ Name = 'mod'; Lines = $modLines })) {
    for ($i = 2; $i -lt $entry.Lines.Count; $i++) {
        if ($entry.Lines[$i].Length -eq 0) { continue }
        if (($entry.Lines[$i] -split "`t").Count -ne $hdr.Count) {
            Write-Output "invalid column count: $($entry.Name) line $($i + 1)"
            exit 1
        }
    }
}

function Get-Rows($lines, $key) {
    $out = @()
    for ($i = 2; $i -lt $lines.Count; $i++) {          # skip header and metadata
        $l = $lines[$i]
        if ($l.Length -eq 0) { continue }
        if ($l.StartsWith('#')) { continue }          # metadata row
        $cells = $l -split $tab
        if ($cells[0] -clike $key) { $out += , $cells }
    }
    return , $out
}

$van = Get-Rows $vanLines $VanKey
if ($van.Count -eq 0) { Write-Output "vanilla row not found: $VanKey"; exit 1 }
if ($van.Count -ne 1) { Write-Output "template key is ambiguous: $VanKey; use a table with a unique first-column key"; exit 1 }
$mods = Get-Rows $modLines $ModKey
if ($mods.Count -eq 0) { Write-Output "mod row not found: $ModKey"; exit 1 }

Write-Output "table : $Table"
Write-Output "van   : $VanKey"
Write-Output "mod   : $ModKey  ($($mods.Count) row(s))"
Write-Output ""

$total = 0
foreach ($mod in $mods) {
    $v = $van[0]
    for ($i = 0; $i -lt $van.Count; $i++) { if ($van[$i][0] -ceq $mod[0]) { $v = $van[$i] } }
    Write-Output "--- $($mod[0])"
    $n = 0
    for ($i = 0; $i -lt $hdr.Count; $i++) {
        $a = if ($i -lt $v.Count) { $v[$i] } else { '' }
        $b = if ($i -lt $mod.Count) { $mod[$i] } else { '' }
        if ($a -cne $b) {
            $n++
            Write-Output ("    {0,-36} van = {1,-22} mod = {2}" -f $hdr[$i], $a, $b)
        }
    }
    if ($n -eq 0) { Write-Output "    IDENTICAL (nothing differs)" }
    else { Write-Output "    $n field(s) differ -- verify each was intended" }
    $total += $n
}
Write-Output ""
Write-Output "total differing fields: $total"
exit 0
