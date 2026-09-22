# criar-endpoint-icone-whatsapp.ps1 — cria e ativa no n8n um endpoint GET que
# serve o PNG dourado do WhatsApp (assets de e-mail da TWK).
#
# Por quê: o canal Gmail-MCP remove <img> do HTML; e-mails com imagem saem via
# n8n ("MAESTRO — Enviar email") e a imagem precisa de URL pública. Este
# workflow responde https://theworldkeys-n8n.xis4ee.easypanel.host/webhook/twk-icon-whatsapp
#
# Uso:  $env:N8N_API_KEY = "<chave criada em Settings -> n8n API>"
#       powershell -ExecutionPolicy Bypass -File .\docs\notificacoes\criar-endpoint-icone-whatsapp.ps1
#
# Aprovado pelo fundador em 2026-08-28 (chat: "O que você recomendar eu aceito" — Opção B).

$ErrorActionPreference = 'Stop'
if (-not $env:N8N_API_KEY) { throw 'Defina $env:N8N_API_KEY antes de rodar (n8n -> Settings -> n8n API -> Create key).' }

$base    = 'https://theworldkeys-n8n.xis4ee.easypanel.host/api/v1'
$headers = @{ 'X-N8N-API-KEY' = $env:N8N_API_KEY; 'accept' = 'application/json'; 'Content-Type' = 'application/json' }

$png = "C:\Users\bianc\OneDrive\Área de Trabalho\Agentes IA\Agente de Suporte e Concierge\public\icons\whatsapp.png"
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($png))

$wf = [ordered]@{
  name     = 'TWK — Servir ícone WhatsApp (assets de e-mail)'
  settings = @{ executionOrder = 'v1' }
  nodes    = @(
    [ordered]@{
      id = 'a1000000-0000-0000-0000-000000000001'; name = 'Webhook'
      type = 'n8n-nodes-base.webhook'; typeVersion = 2.1; position = @(-400, 0)
      parameters = [ordered]@{ httpMethod = 'GET'; path = 'twk-icon-whatsapp'; responseMode = 'responseNode'; options = @{} }
    },
    [ordered]@{
      id = 'a1000000-0000-0000-0000-000000000002'; name = 'Base64 do ícone'
      type = 'n8n-nodes-base.set'; typeVersion = 3.4; position = @(-180, 0)
      parameters = [ordered]@{
        assignments = @{ assignments = @(@{ id = 'b64'; name = 'b64'; value = $b64; type = 'string' }) }
        options = @{}
      }
    },
    [ordered]@{
      id = 'a1000000-0000-0000-0000-000000000003'; name = 'Converter em binário'
      type = 'n8n-nodes-base.convertToFile'; typeVersion = 1.1; position = @(40, 0)
      parameters = [ordered]@{ operation = 'toBinary'; sourceProperty = 'b64'; options = @{ fileName = 'whatsapp.png'; mimeType = 'image/png' } }
    },
    [ordered]@{
      id = 'a1000000-0000-0000-0000-000000000004'; name = 'Responder (binário)'
      type = 'n8n-nodes-base.respondToWebhook'; typeVersion = 1.1; position = @(260, 0)
      parameters = [ordered]@{
        respondWith = 'binary'
        options = @{ responseHeaders = @{ entries = @(@{ name = 'Cache-Control'; value = 'public, max-age=31536000' }) } }
      }
    }
  )
  connections = [ordered]@{
    'Webhook'              = @{ main = ,@(@{ node = 'Base64 do ícone';      type = 'main'; index = 0 }) }
    'Base64 do ícone'      = @{ main = ,@(@{ node = 'Converter em binário'; type = 'main'; index = 0 }) }
    'Converter em binário' = @{ main = ,@(@{ node = 'Responder (binário)';  type = 'main'; index = 0 }) }
  }
}

$body = $wf | ConvertTo-Json -Depth 12
$created = Invoke-RestMethod -Method Post -Uri "$base/workflows" -Headers $headers -Body $body
Write-Host ("Workflow criado: id=" + $created.id)

Invoke-RestMethod -Method Post -Uri "$base/workflows/$($created.id)/activate" -Headers $headers | Out-Null
Write-Host "Workflow ativado."

Start-Sleep -Seconds 2
$url = 'https://theworldkeys-n8n.xis4ee.easypanel.host/webhook/twk-icon-whatsapp'
try {
  $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
  Write-Host ("Teste GET: HTTP " + $r.StatusCode + " · Content-Type " + $r.Headers['Content-Type'] + " · " + $r.RawContentLength + " bytes")
  Write-Host ("URL pública do ícone: " + $url)
} catch {
  Write-Warning ("Workflow criado/ativado, mas o GET de teste falhou: " + $_.Exception.Message)
}
