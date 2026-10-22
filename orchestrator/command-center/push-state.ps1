# push-state.ps1 - sincroniza o estado local do Orquestrador com a Central hospedada.
# Uso:  powershell -File orchestrator\command-center\push-state.ps1
#       (sem parametros, le CENTER_URL / INGEST_TOKEN / CENTER_TOKEN de ~\.twk\central.env - fora do OneDrive, nada na linha de comando)
#       powershell -File orchestrator\command-center\push-state.ps1 -CenterUrl https://maestro.seudominio.com -IngestToken <token>
param(
    [string]$CenterUrl,
    [string]$IngestToken,
    [string]$CenterToken  # opcional: com ele, os relatorios gerados pelo cerebro hospedado sao espelhados para o estado local
)
$ErrorActionPreference = 'Stop'

# --- credenciais: parametro > ~\.twk\central.env (2026-10-07) ---
$envFile = Join-Path $HOME '.twk\central.env'
if (Test-Path $envFile) {
    foreach ($linha in Get-Content $envFile) {
        if ($linha -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$') {
            $k = $matches[1]; $v = $matches[2].Trim('"', "'")
            if ($k -eq 'CENTER_URL' -and -not $CenterUrl) { $CenterUrl = $v }
            if ($k -eq 'INGEST_TOKEN' -and -not $IngestToken) { $IngestToken = $v }
            if ($k -eq 'CENTER_TOKEN' -and -not $CenterToken) { $CenterToken = $v }
        }
    }
}
if (-not $CenterUrl -or -not $IngestToken) { throw "Faltam CenterUrl/IngestToken: passe por parametro ou grave CENTER_URL e INGEST_TOKEN em $envFile" }
$CenterUrl = $CenterUrl.TrimEnd('/')
Write-Output "Central: $CenterUrl"

# Leitura de arquivo SEMPRE por .NET, em UTF-8 (2026-10-07): no Windows PowerShell 5.1, a string que sai de
# Get-Content -Raw carrega propriedades ocultas (PSPath, PSParentPath...) e, com duas ou mais delas numa tabela,
# o ConvertTo-Json entra em loop (CPU 100%, memoria crescendo, nunca termina) - foi por isso que a sincronizacao
# "travava". Alem disso Get-Content sem -Encoding le arquivo sem BOM como ANSI e corrompe os acentos.
function Ler([string]$p) { return [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) }

$root = Join-Path $PSScriptRoot '..\..'
$today = Get-Date -Format 'yyyy-MM-dd'
$tasks = Ler (Join-Path $root 'orchestrator\state\tasks.jsonl')
$conhec = Ler (Join-Path $root 'orchestrator\state\conhecimento.md')
$logPath = Join-Path $root ("orchestrator\logs\audit-$today.jsonl")
$log = if (Test-Path $logPath) { Ler $logPath } else { '' }

$missoes = @{}
$mdir = Join-Path $root 'orchestrator\state\missoes'
if (Test-Path $mdir) {
    Get-ChildItem $mdir -Filter '*.md' | ForEach-Object { $missoes[$_.Name] = Ler $_.FullName }
}

# Regencia (ADR-012): relatos do Orquestrador local (JSON por agente). Vai o ULTIMO dia que existe
# (hoje, se houver) - a Central mostra a data do relato, entao um relato antigo e honesto; nenhum e lacuna.
# (corrigido em 2026-10-06: o caminho tinha perdido as barras e os relatos nunca subiam)
$relatos = @{}
$relRaiz = Join-Path $root 'orchestrator\command-center\state\relatos'
if (Test-Path $relRaiz) {
    $ultimoDia = Get-ChildItem $relRaiz -Directory | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' } | Sort-Object Name | Select-Object -Last 1
    if ($ultimoDia) {
        Get-ChildItem $ultimoDia.FullName -Filter '*.json' | ForEach-Object { $relatos[$ultimoDia.Name + '/' + $_.Name] = Ler $_.FullName }
        Write-Output "Relatos: $($relatos.Count) arquivo(s) de $($ultimoDia.Name)"
    }
}

# Casas de teste (fundador, 2026-09-06): fonte unica no repositorio; a Central hospedada recebe a copia (v4.5.2)
$excluidos = $null
$exPath = Join-Path $root 'orchestrator\state\excluidos-teste.json'
if (Test-Path $exPath) { $excluidos = (Ler $exPath) | ConvertFrom-Json }
else { Write-Output "Aviso: $exPath nao encontrado - a Central hospedada contara as casas de teste." }

# Panorama: metricas que so nascem nesta maquina (porta de qualidade, avaliacoes, sentinela, Guardiao, convites)
$plataformaLocal = $null
try {
    & node (Join-Path $PSScriptRoot 'plataforma-exportar.js') | Out-Null
    $plataformaLocal = (Ler (Join-Path $root 'orchestrator\state\plataforma-local.json')) | ConvertFrom-Json
} catch { Write-Output "Aviso: exportacao do Panorama falhou ($($_.Exception.Message))." }

# Guardiao da Reserva (v4.6): a ultima varredura, compacta (contagens, lote, fila, clientes a avisar, livro-razao,
# relatorio) - e o que a pagina do Guardiao e a ferramenta frota_kpis mostram na Central hospedada.
$guardiao = $null
try {
    & node (Join-Path $PSScriptRoot 'guardiao.js') --exportar | Out-Null
    $guardiao = (Ler (Join-Path $root 'orchestrator\state\guardiao-sincronizado.json')) | ConvertFrom-Json
} catch { Write-Output "Aviso: exportacao do Guardiao falhou ($($_.Exception.Message))." }

# Rotinas hospedadas (A1, 2026-10-22): o Guardiao que roda dentro da Central precisa do registro de opt-out
# (fail-closed: sem registro legivel, nenhum contato) e a Sentinela precisa dos compromissos. Ambos sao
# arquivos interinos do repositorio; aqui vai a copia, como ja acontece com excluidos-teste.json.
$listing = $null
$lcPath = Join-Path $root 'orchestrator\state\listing-consent.jsonl'
if (Test-Path $lcPath) { $listing = Ler $lcPath }
$compromissos = $null
$cpPath = Join-Path $root 'orchestrator\state\compromissos.jsonl'
if (Test-Path $cpPath) { $compromissos = Ler $cpPath }

$payload = @{ tasks_jsonl = $tasks; conhecimento_md = $conhec; log_date = $today; log_jsonl = $log; missoes = $missoes; relatos = $relatos; plataforma_local = $plataformaLocal; guardiao = $guardiao; excluidos_teste = $excluidos; listing_consent_jsonl = $listing; compromissos_jsonl = $compromissos } | ConvertTo-Json -Depth 12
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
