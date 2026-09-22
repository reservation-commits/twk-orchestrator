# validate-handoff.ps1 - SubagentStop: valida que o retorno de um subagente que emitiu
# um bloco ```handoff obedece ao contrato (campos obrigatorios).
# Registra o evento na auditoria. Falha de schema vira anomalia no log (nao bloqueia o stop -
# o Orquestrador trata a anomalia ao ler o log, mantendo degradacao graciosa).
# IMPORTANTE: manter este arquivo 100% ASCII (PowerShell 5.1 le .ps1 sem BOM como ANSI).

$ErrorActionPreference = 'SilentlyContinue'
$raw = [Console]::In.ReadToEnd()
if (-not $raw) { exit 0 }
try { $evt = $raw | ConvertFrom-Json } catch { exit 0 }

$root = Get-Location
$logDir = Join-Path $root 'orchestrator\logs'
if (-not (Test-Path $logDir)) { exit 0 }
$logFile = Join-Path $logDir ("audit-" + (Get-Date -Format 'yyyy-MM-dd') + ".jsonl")

function Write-Audit($obj) {
    # UTF-8 sem BOM (Add-Content -Encoding utf8 grava BOM ao criar o arquivo e quebra a 1a linha).
    try { [System.IO.File]::AppendAllText($logFile, (($obj | ConvertTo-Json -Compress) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false))) } catch {}
}

$msg = $evt.last_assistant_message
if (-not $msg) { $msg = $evt.output }

$anomalia = $null
if ($msg -and $msg -match '(?s)```handoff\s*(\{.*?\})\s*```') {
    $json = $Matches[1]
    try {
        $h = $json | ConvertFrom-Json
        foreach ($campo in @('task_id', 'trace_id', 'origem', 'destino')) {
            if (-not $h.$campo) { $anomalia = "handoff sem campo obrigatorio '$campo'" }
        }
        if (-not $anomalia -and $h.resultado) {
            foreach ($campo in @('status', 'resumo')) {
                if (-not $h.resultado.$campo) { $anomalia = "resultado sem campo obrigatorio '$campo'" }
            }
        }
    } catch { $anomalia = 'bloco handoff nao e JSON valido' }
}

Write-Audit @{
    ts      = (Get-Date).ToUniversalTime().ToString('o')
    evento  = if ($anomalia) { 'handoff_invalido' } else { 'subagent_stop' }
    detalhe = $anomalia
    sessao  = $evt.session_id
}

exit 0
