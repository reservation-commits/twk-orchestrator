# guard-sql.ps1 - PreToolUse: bloqueio deterministico de SQL destrutivo e comandos catastroficos.
# Exit 2 = BLOQUEIA a acao e devolve o motivo ao agente. Exit 0 = permite.
# Regra: bloqueio por codigo, nunca por instrucao de prompt.
# IMPORTANTE: manter este arquivo 100% ASCII (PowerShell 5.1 le .ps1 sem BOM como ANSI).

$ErrorActionPreference = 'SilentlyContinue'
$raw = [Console]::In.ReadToEnd()
if (-not $raw) { exit 0 }

try { $evt = $raw | ConvertFrom-Json } catch { exit 0 }

$cmd = $evt.tool_input.command
if (-not $cmd) { $cmd = $evt.tool_input.query }
if (-not $cmd) { exit 0 }

$block = $null

# --- SQL destrutivo (DDL/DML de destruicao) ---
if ($cmd -match '(?i)\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW|ROLE)\b') {
    $block = "DROP/TRUNCATE bloqueado por guardrail. Mudanca estrutural de banco exige runbook + aprovacao humana registrada (ver CLAUDE.md, tabela de escalonamento)."
}
elseif ($cmd -match '(?i)\bDELETE\s+FROM\b' -and $cmd -notmatch '(?i)\bDELETE\s+FROM\b[\s\S]*\bWHERE\b') {
    $block = "DELETE sem WHERE bloqueado por guardrail. Adicione WHERE explicito ou escale para aprovacao humana."
}
elseif ($cmd -match '(?i)\bUPDATE\s+\S+\s+SET\b' -and $cmd -notmatch '(?i)\bUPDATE\b[\s\S]*\bWHERE\b') {
    $block = "UPDATE sem WHERE bloqueado por guardrail. Adicione WHERE explicito ou escale para aprovacao humana."
}
elseif ($cmd -match '(?i)\b(UPDATE|DELETE)\b' -and $cmd -match '(?i)\bWHERE\s+(true|1\s*=\s*1)\b') {
    $block = "UPDATE/DELETE com WHERE true (tautologia) bloqueado - equivale a operacao sem WHERE."
}
elseif ($cmd -match '(?i)\b(GRANT|REVOKE)\b.*\b(ALL|SUPERUSER)\b') {
    $block = "Mudanca de privilegios de banco bloqueada - exige aprovacao humana."
}

# --- Shell catastrofico ---
if (-not $block) {
    if ($cmd -match '(?i)rm\s+(-\w*[rf]\w*\s+)+(/|~|\$HOME|C:)\s*$' -or
        $cmd -match '(?i)Remove-Item\s+.*-Recurse.*-Force\s+(C:\\|\\\\|~)\s*$') {
        $block = "Remocao recursiva de raiz/home bloqueada por guardrail."
    }
    elseif ($cmd -match '(?i)(pg_dump\s+[^|]*\|\s*psql|pg_restore\s+--clean)') {
        $block = "Restore/clean de banco bloqueado - exige runbook de migracao com backup verificado."
    }
}

if ($block) {
    [Console]::Error.WriteLine("GUARDRAIL: $block")
    try {
        $logDir = Join-Path (Get-Location) 'orchestrator\logs'
        if (Test-Path $logDir) {
            $entry = @{ ts = (Get-Date).ToUniversalTime().ToString('o'); evento = 'guardrail_block'; motivo = $block; comando = $cmd.Substring(0, [Math]::Min(400, $cmd.Length)) } | ConvertTo-Json -Compress
            # UTF-8 sem BOM (Add-Content -Encoding utf8 grava BOM ao criar o arquivo e quebra a 1a linha).
            $logFile = Join-Path $logDir ("audit-" + (Get-Date -Format 'yyyy-MM-dd') + ".jsonl")
            [System.IO.File]::AppendAllText($logFile, $entry + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
        }
    } catch {}
    exit 2
}

exit 0
