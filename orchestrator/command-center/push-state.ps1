# push-state.ps1 - sincroniza o estado local do Orquestrador com a Central hospedada.
# Uso:  powershell -File orchestrator\command-center\push-state.ps1 -CenterUrl https://maestro.seudominio.com -IngestToken <token>
param(
    [Parameter(Mandatory = $true)][string]$CenterUrl,
    [Parameter(Mandatory = $true)][string]$IngestToken,
    [string]$CenterToken  # opcional: com ele, os relatorios gerados pelo cerebro hospedado sao espelhados para o estado local
)
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..\..'
$today = Get-Date -Format 'yyyy-MM-dd'
$tasks = Get-Content (Join-Path $root 'orchestrator\state\tasks.jsonl') -Raw
$conhec = Get-Content (Join-Path $root 'orchestrator\state\conhecimento.md') -Raw
$logPath = Join-Path $root ("orchestrator\logs\audit-$today.jsonl")
$log = if (Test-Path $logPath) { Get-Content $logPath -Raw } else { '' }

$missoes = @{}
$mdir = Join-Path $root 'orchestrator\state\missoes'
if (Test-Path $mdir) {
    Get-ChildItem $mdir -Filter '*.md' | ForEach-Object { $missoes[$_.Name] = Get-Content $_.FullName -Raw }
}

# Regencia (ADR-012): relatos de hoje do Orquestrador local (JSON por agente)
$relatos = @{}
$rdir = Join-Path $root ('orchestratorcommand-centerstateelatos' + $today)
if (Test-Path $rdir) {
    Get-ChildItem $rdir -Filter '*.json' | ForEach-Object { $relatos["$today/" + $_.Name] = Get-Content $_.FullName -Raw }
}

$payload = @{ tasks_jsonl = $tasks; conhecimento_md = $conhec; log_date = $today; log_jsonl = $log; missoes = $missoes; relatos = $relatos } | ConvertTo-Json -Depth 3
$r = Invoke-RestMethod -Method Post -Uri "$CenterUrl/api/ingest" -Headers @{ Authorization = "Bearer $IngestToken" } -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($payload))
Write-Output "Estado sincronizado: $($r | ConvertTo-Json -Compress)"

# --- PULL: espelha os relatorios gerados pelo cerebro hospedado para o estado local ---
if ($CenterToken) {
    try {
        $hdr = @{ 'x-center-key' = $CenterToken }
        $remote = Invoke-RestMethod -Uri "$CenterUrl/api/missions" -Headers $hdr
        $novos = 0
        foreach ($mi in $remote.missions) {
            $localPath = Join-Path $mdir $mi.file
            if (-not (Test-Path $localPath)) {
                $doc = Invoke-RestMethod -Uri "$CenterUrl/api/mission?f=$([uri]::EscapeDataString($mi.file))" -Headers $hdr
                New-Item -ItemType Directory -Force $mdir | Out-Null
                Set-Content -Encoding utf8 -Path $localPath -Value $doc.content
                $novos++
            }
        }
        if ($novos -gt 0) { Write-Output ">>> $novos relatorio(s) do cerebro hospedado espelhado(s) para orchestrator\state\missoes." }
    } catch {
        Write-Output "Aviso: espelhamento de relatorios falhou ($($_.Exception.Message))."
    }
}

# --- PULL: coleta as Novas Missoes escritas na Central (inbox) e traz para o Orquestrador local ---
try {
    $inbox = Invoke-RestMethod -Method Post -Uri "$CenterUrl/api/inbox/consume" -Headers @{ Authorization = "Bearer $IngestToken" }
    if ($inbox.items -and $inbox.items.Count -gt 0) {
        $localInbox = Join-Path $root 'orchestrator\state\inbox-local.jsonl'
        foreach ($it in $inbox.items) { Add-Content -Encoding utf8 -Path $localInbox -Value ($it | ConvertTo-Json -Compress -Depth 5) }
        Write-Output ""
        Write-Output ">>> $($inbox.items.Count) NOVA(S) MISSAO(OES) coletada(s) da Central:"
        foreach ($it in $inbox.items) { Write-Output "    [$($it.prioridade)] $($it.titulo)" }
        Write-Output ">>> Abra a sessao do Claude na pasta e diga: 'processe a fila de missoes' (ou rode /briefing)."
    } else {
        Write-Output "Fila de missoes da Central: vazia."
    }
} catch {
    Write-Output "Aviso: nao foi possivel consultar a fila de missoes ($($_.Exception.Message))."
}
