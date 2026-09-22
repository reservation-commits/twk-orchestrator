# Aplicador Clé d'Or — substitui o HTML dos nós Gmail pelos templates aprovados.
# Uso:
#   $env:N8N_API_KEY = "<sua chave criada em Settings → n8n API>"
#   powershell -ExecutionPolicy Bypass -File .\docs\notificacoes\aplicar-cle-dor.ps1                    # todos os workflows
#   powershell -ExecutionPolicy Bypass -File .\docs\notificacoes\aplicar-cle-dor.ps1 -WorkflowId <id>   # um por vez
#   ... -DryRun  → mostra o que faria, sem gravar nada
# Antes de cada gravação, o workflow inteiro é salvo em docs\notificacoes\backup-n8n\ (plano de rollback).

param(
  [string]$WorkflowId = '',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
if (-not $env:N8N_API_KEY) { throw 'Defina $env:N8N_API_KEY antes de rodar (n8n → Settings → n8n API → Create key).' }

$base    = 'https://theworldkeys-n8n.xis4ee.easypanel.host/api/v1'
$headers = @{ 'X-N8N-API-KEY' = $env:N8N_API_KEY; 'accept' = 'application/json' }
$root    = Split-Path $PSScriptRoot -Parent | Split-Path -Parent   # raiz do repo (2 níveis acima de docs\notificacoes)
$tplDir  = Join-Path $PSScriptRoot 'templates'
$bakDir  = Join-Path $PSScriptRoot 'backup-n8n'
New-Item -ItemType Directory -Force $bakDir | Out-Null

# Manifesto: workflow → (nó Gmail → arquivo de template)
$manifest = @{
  'ztI9ws9F6BAGJSGr' = @{  # 1 - nova reserva
    'Confirmação Automática Usuário'         = 'cle-dor-confirmacao-cliente.html'
    'Solicitação Enviada Usuário'            = 'familia\wf1-solicitacao-enviada-cliente.html'
    'Solicitação Enviada Estabelecimento'    = 'cle-dor-novo-pedido-restaurante.html'
    'Confirmação Automática Estabelecimento' = 'familia\wf3-aceite-restaurante.html'
    'Restaurante Sem Email Usuário'          = 'familia\wf1-problema-contato-cliente.html'
    # 'Restaurante sem Email Estabelecimento' fica como está (decisão do fundador, 25/08)
  }
  'YDOdJQ46C8okIIdm' = @{  # 3 - resposta do restaurante
    'Customer (Accept)'       = 'familia\wf3-aceite-cliente.html'
    'Customer (Decline)'      = 'familia\wf3-recusa-cliente.html'
    'Customer (Reschedule)'   = 'familia\wf3-reagendamento-proposto-cliente.html'
    'Establishment (Accept)'  = 'familia\wf3-aceite-restaurante.html'
    'Establishment (Decline)' = 'familia\wf3-recusa-restaurante.html'
  }
  '8sKe89Lz5Vzpy3a5' = @{  # 4 - resposta ao reagendamento
    'Confirmado - Cliente'         = 'familia\wf4-reagendamento-confirmado-cliente.html'
    'Confirmado - Estabelecimento' = 'familia\wf4-reagendamento-confirmado-restaurante.html'
    'Recusado - Cliente'           = 'familia\wf4-reagendamento-recusado-cliente.html'
    'Recusado - Estabelecimento'   = 'familia\wf4-reagendamento-recusado-restaurante.html'
  }
  '6sIa2gOyhVdZyAc6' = @{  # 5 - botão de cancelamento
    'Cancel Button - Usuário'       = 'familia\wf5-cancelamento-cliente.html'
    'Cancel Button - Establishment' = 'familia\wf5-cancelamento-restaurante.html'
  }
  'xn33VGxkjsasnGlo' = @{  # 6 - desativação de conta
    'Send a message' = 'familia\wf6-desativacao-conta.html'
  }
  'WwHnwL8P0hkcgCaz' = @{  # alteração na reserva
    'notifica cliente'          = 'familia\alteracao-cliente.html'
    'Recusado - Estabelecimento' = 'familia\alteracao-restaurante.html'   # nome herdado; é o aviso de atualização
  }
  '1pc2qJX4kYkBni3s' = @{  # resetar senha
    'Send a message' = 'familia\reset-senha.html'
  }
  'TkC4zLu3uA6B01Ii' = @{  # parceria — aprovação
    'Send a message' = 'familia\parceria-aprovada.html'
  }
  '6ONkRN-zDsy0qpvXBn6NH' = @{  # parceria — recebimento
    'Send a message' = 'familia\parceria-recebida.html'
  }
  'k5bNbCQSzGd1u3ZK' = @{  # code para restaurante existente (listing-otp)
    'Send a message' = 'familia\listing-otp-code.html'
  }
  # '2 - 6h e 12h pendente' (TvyfkENpfds0MpgJ): pendente de compartilhamento/mapeamento — fora deste manifesto por ora.
}

$targets = if ($WorkflowId) { @($WorkflowId) } else { $manifest.Keys }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

foreach ($wfId in $targets) {
  if (-not $manifest.ContainsKey($wfId)) { Write-Warning "Workflow $wfId não está no manifesto — pulando."; continue }
  $map = $manifest[$wfId]

  $wf = Invoke-RestMethod -Method Get -Uri "$base/workflows/$wfId" -Headers $headers
  Write-Host ("`n=== {0} ({1}) ===" -f $wf.name, $wfId) -ForegroundColor Cyan

  # Backup integral (rollback: reimportar este JSON no n8n)
  $bakPath = Join-Path $bakDir ("{0}-{1}.json" -f $wfId, $stamp)
  $wf | ConvertTo-Json -Depth 100 | Out-File -FilePath $bakPath -Encoding utf8
  Write-Host "  backup: $bakPath"

  $changed = 0
  foreach ($node in $wf.nodes) {
    if ($map.ContainsKey($node.name)) {
      $tplPath = Join-Path $tplDir $map[$node.name]
      if (-not (Test-Path $tplPath)) { throw "Template não encontrado: $tplPath" }
      $html = [IO.File]::ReadAllText($tplPath, [System.Text.Encoding]::UTF8)
      $node.parameters.message = '=' + $html    # '=' liga o modo expressão do n8n (necessário para os {{ }})
      $changed++
      Write-Host ("  [OK] nó '{0}' ← {1}" -f $node.name, $map[$node.name]) -ForegroundColor Green
    }
  }
  if ($changed -eq 0) { Write-Warning '  nenhum nó do manifesto encontrado — nomes mudaram? Nada gravado.'; continue }

  if ($DryRun) { Write-Host "  DRY-RUN: $changed nó(s) seriam atualizados. Nada gravado." -ForegroundColor Yellow; continue }

  # PUT aceita somente estes campos
  $body = @{ name = $wf.name; nodes = $wf.nodes; connections = $wf.connections; settings = $wf.settings } | ConvertTo-Json -Depth 100
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  Invoke-RestMethod -Method Put -Uri "$base/workflows/$wfId" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $bytes | Out-Null
  Write-Host ("  GRAVADO: {0} nó(s) atualizados." -f $changed) -ForegroundColor Green
}

Write-Host "`nConcluído. Confira no n8n se os workflows seguem ATIVOS (o PUT preserva, mas verifique) e faça um teste real de cada fluxo." -ForegroundColor Cyan
