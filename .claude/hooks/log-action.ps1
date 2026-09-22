# log-action.ps1 - PostToolUse: camada fria de auditoria. Registra toda acao em JSONL.
# Nunca bloqueia (exit 0 sempre). Trace_id vem de orchestrator/state/current_trace.txt quando existe.
# IMPORTANTE: manter este arquivo 100% ASCII (PowerShell 5.1 le .ps1 sem BOM como ANSI).

$ErrorActionPreference = 'SilentlyContinue'
$raw = [Console]::In.ReadToEnd()
if (-not $raw) { exit 0 }

try { $evt = $raw | ConvertFrom-Json } catch { exit 0 }

try {
    $root = Get-Location
    $logDir = Join-Path $root 'orchestrator\logs'
    if (-not (Test-Path $logDir)) { exit 0 }

    $traceFile = Join-Path $root 'orchestrator\state\current_trace.txt'
    $trace = if (Test-Path $traceFile) { (Get-Content $traceFile -TotalCount 1).Trim() } else { 'trc-sem-tarefa-00' }

    $inputSummary = ''
    if ($evt.tool_input) {
        $inputSummary = ($evt.tool_input | ConvertTo-Json -Compress -Depth 3)
        if ($inputSummary.Length -gt 500) { $inputSummary = $inputSummary.Substring(0, 500) + '...[truncado]' }
    }

    $entry = @{
        ts       = (Get-Date).ToUniversalTime().ToString('o')
        evento   = 'tool_use'
        trace_id = $trace
        tool     = $evt.tool_name
        input    = $inputSummary
        sessao   = $evt.session_id
    } | ConvertTo-Json -Compress

    # UTF-8 SEM BOM: Add-Content -Encoding utf8 no PowerShell 5.1 grava BOM ao CRIAR o arquivo, e a
    # primeira linha de cada dia deixava de ser JSON valido (22 arquivos afetados ate 2026-09-21).
    $logFile = Join-Path $logDir ("audit-" + (Get-Date -Format 'yyyy-MM-dd') + ".jsonl")
    [System.IO.File]::AppendAllText($logFile, $entry + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
} catch {}

exit 0
