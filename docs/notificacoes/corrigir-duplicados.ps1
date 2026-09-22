# Correção dos envios duplicados — workflow "1 - nova reserva"
# Causa: webhook em modo responseNode com o nó de resposta no fim de um único ramo
#        + sub-workflow 6h/12h com waitForSubWorkflow ligado (execução presa por 6-12h,
#        site sem resposta -> timeout -> retry -> e-mails duplicados).
# Correção: resposta imediata para todos os ramos (Webhook -> Respond to Webhook -> Code)
#           e waitForSubWorkflow = false.
# Uso: $env:N8N_API_KEY = "..." ; powershell -ExecutionPolicy Bypass -File .\docs\notificacoes\corrigir-duplicados.ps1 [-DryRun]

param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
if (-not $env:N8N_API_KEY) { throw 'Defina $env:N8N_API_KEY antes de rodar.' }

$base    = 'https://theworldkeys-n8n.xis4ee.easypanel.host/api/v1'
$headers = @{ 'X-N8N-API-KEY' = $env:N8N_API_KEY; 'accept' = 'application/json' }
$bakDir  = Join-Path $PSScriptRoot 'backup-n8n'
New-Item -ItemType Directory -Force $bakDir | Out-Null
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$wfId    = 'ztI9ws9F6BAGJSGr'

$wf = Invoke-RestMethod -Method Get -Uri "$base/workflows/$wfId" -Headers $headers
$wf | ConvertTo-Json -Depth 100 | Out-File (Join-Path $bakDir "$wfId-fixdup-$stamp.json") -Encoding utf8
Write-Host "backup: $bakDir\$wfId-fixdup-$stamp.json"

# 1) Resposta imediata: Webhook -> Respond to Webhook -> Code in JavaScript
$conn = $wf.connections
$conn.Webhook.main[0] = @(@{ node = 'Respond to Webhook'; type = 'main'; index = 0 })
$respondConn = @{ main = @(, @(@{ node = 'Code in JavaScript'; type = 'main'; index = 0 })) }
$conn | Add-Member -NotePropertyName 'Respond to Webhook' -NotePropertyValue $respondConn -Force
# remove o antigo elo Execute a SQL query -> Respond to Webhook (o nó SQL vira fim de ramo)
$conn.'Execute a SQL query'.main[0] = @()
Write-Host '[1] Resposta movida para o inicio: Webhook -> Respond to Webhook -> Code in JavaScript' -ForegroundColor Green

# 2) Desacoplar o sub-workflow de 6h/12h
$sub = $wf.nodes | Where-Object { $_.name -eq '6h e 12h pendente' }
if (-not $sub) { throw "Nó '6h e 12h pendente' não encontrado." }
$sub.parameters.options.waitForSubWorkflow = $false
Write-Host '[2] waitForSubWorkflow = false (fluxo-pai termina em segundos; lembrete roda sozinho)' -ForegroundColor Green

if ($DryRun) { Write-Host 'DRY-RUN: nada gravado.' -ForegroundColor Yellow; return }

$body  = @{ name = $wf.name; nodes = $wf.nodes; connections = $wf.connections; settings = $wf.settings } | ConvertTo-Json -Depth 100
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
Invoke-RestMethod -Method Put -Uri "$base/workflows/$wfId" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $bytes | Out-Null
Write-Host 'GRAVADO. Confira no n8n que o workflow segue ATIVO e faça uma reserva de teste.' -ForegroundColor Cyan
Write-Host 'Depois: em Executions, PARE as execucoes em andamento duplicadas (as que estao esperando 6-12h da mesma reserva), deixando apenas uma por reserva.' -ForegroundColor Cyan
