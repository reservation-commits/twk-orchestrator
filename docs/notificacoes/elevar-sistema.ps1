# Elevação do sistema de notificações TWK — 3 estágios:
#   1) Aplica os 23 templates Clé d'Or (chama aplicar-cle-dor.ps1)
#   2) Corrige a injeção de SQL do workflow "1 - nova reserva" (query parametrizada)
#   3) Cria o workflow "Lembretes de reserva — 24h e 4h" (nasce DESATIVADO; ativar só após teste)
# Uso:  $env:N8N_API_KEY = "..." ; powershell -ExecutionPolicy Bypass -File .\docs\notificacoes\elevar-sistema.ps1 [-DryRun]

param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
if (-not $env:N8N_API_KEY) { throw 'Defina $env:N8N_API_KEY antes de rodar.' }

$base    = 'https://theworldkeys-n8n.xis4ee.easypanel.host/api/v1'
$headers = @{ 'X-N8N-API-KEY' = $env:N8N_API_KEY; 'accept' = 'application/json' }
$tplDir  = Join-Path $PSScriptRoot 'templates'
$bakDir  = Join-Path $PSScriptRoot 'backup-n8n'
New-Item -ItemType Directory -Force $bakDir | Out-Null
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'

function Put-Workflow($wf) {
  $body  = @{ name = $wf.name; nodes = $wf.nodes; connections = $wf.connections; settings = $wf.settings } | ConvertTo-Json -Depth 100
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  Invoke-RestMethod -Method Put -Uri "$base/workflows/$($wf.id)" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $bytes | Out-Null
}

# ============ ESTÁGIO 1 — Templates Clé d'Or ============
Write-Host "`n########## ESTÁGIO 1 — Aplicação dos templates ##########" -ForegroundColor Magenta
$applier = Join-Path $PSScriptRoot 'aplicar-cle-dor.ps1'
if ($DryRun) { & $applier -DryRun } else { & $applier }

# ============ ESTÁGIO 2 — Correção da injeção de SQL (workflow 1) ============
Write-Host "`n########## ESTÁGIO 2 — SQL parametrizado no workflow 1 ##########" -ForegroundColor Magenta
$wf1Id = 'ztI9ws9F6BAGJSGr'
$wf1 = Invoke-RestMethod -Method Get -Uri "$base/workflows/$wf1Id" -Headers $headers
$wf1 | ConvertTo-Json -Depth 100 | Out-File (Join-Path $bakDir "$wf1Id-sqlfix-$stamp.json") -Encoding utf8
$sqlNode = $wf1.nodes | Where-Object { $_.name -eq 'Execute a SQL query' }
if (-not $sqlNode) { throw "Nó 'Execute a SQL query' não encontrado no workflow 1." }
Write-Host ("  Query atual: " + ($sqlNode.parameters.query -replace "`n", ' '))
$sqlNode.parameters.query = "UPDATE public.reservations`nSET booking_status = 'Accept'`nWHERE reservation_code = `$1;"
$sqlNode.parameters.options = @{ queryReplacement = "={{ `$('Webhook').item.json.body.reservation.reservation_code }}" }
Write-Host "  Nova query : UPDATE ... WHERE reservation_code = `$1  (parametro seguro via queryReplacement)" -ForegroundColor Green
if ($DryRun) { Write-Host '  DRY-RUN: nada gravado.' -ForegroundColor Yellow }
else { Put-Workflow $wf1; Write-Host '  GRAVADO.' -ForegroundColor Green }

# ============ ESTÁGIO 3 — Workflow de lembretes 24h/4h ============
Write-Host "`n########## ESTÁGIO 3 — Criação do fluxo de lembretes ##########" -ForegroundColor Magenta

$gmailCred = @{ gmailOAuth2 = @{ id = 'hkcgjRyX7AH55iMJ'; name = 'Gmail account' } }
$pgCred    = @{ postgres    = @{ id = 'QSEOM0Wb5DzGkuXy'; name = 'Postgres account 2' } }

$tpl24 = '=' + [IO.File]::ReadAllText((Join-Path $tplDir 'familia\lembrete-24h.html'), [System.Text.Encoding]::UTF8)
$tpl4  = '=' + [IO.File]::ReadAllText((Join-Path $tplDir 'familia\lembrete-4h.html'),  [System.Text.Encoding]::UTF8)

$setupSql = @'
CREATE TABLE IF NOT EXISTS public.email_reminders_sent (
  reservation_code varchar NOT NULL,
  kind varchar NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reservation_code, kind)
);
'@

$selectSql = @'
WITH upcoming AS (
  SELECT r.reservation_code, r.booking_date, r.reservation_time, r.booking_details,
         d.name AS restaurant_name, u.name AS user_name, u.email AS user_email,
         (r.booking_date + r.reservation_time) AS starts_at
    FROM public.reservations r
    JOIN public.db_restaurants d ON r.restaurant_id = d.restaurant_id
    JOIN nextauth."User" u ON r.customer_id = u.id
   WHERE LOWER(r.booking_status) = 'accept'
     AND u.email IS NOT NULL
     AND r.booking_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 2
)
SELECT up.*, k.kind
  FROM upcoming up
  CROSS JOIN LATERAL (VALUES ('24h'), ('4h')) AS k(kind)
 WHERE (
         (k.kind = '24h' AND up.starts_at BETWEEN NOW() + INTERVAL '23 hours 30 minutes' AND NOW() + INTERVAL '24 hours 30 minutes')
      OR (k.kind = '4h'  AND up.starts_at BETWEEN NOW() + INTERVAL '3 hours 30 minutes'  AND NOW() + INTERVAL '4 hours 30 minutes')
       )
   AND NOT EXISTS (
         SELECT 1 FROM public.email_reminders_sent s
          WHERE s.reservation_code = up.reservation_code AND s.kind = k.kind
       )
 LIMIT 200;
'@

$formatJs = @'
const d = $json.booking_date ? new Date($json.booking_date) : null;
let formattedDate = "";
if (d && !isNaN(d.getTime())) {
  const p = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value || "";
  formattedDate = `${g("weekday")}, ${g("day")} ${g("month")} ${g("year")}`;
}
let formattedTime = "";
const t = String($json.reservation_time || "");
const m = t.match(/^(\d{1,2}):(\d{2})/);
if (m) {
  formattedTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(2000, 0, 1, Number(m[1]), Number(m[2])));
}
return { ...$json, formattedDate, formattedTime, user_name: $json.user_name || "Guest" };
'@

$nodes = @(
  @{ name='A cada 30 min'; type='n8n-nodes-base.scheduleTrigger'; typeVersion=1.3; position=@(-600,0)
     parameters=@{ rule=@{ interval=@(@{ field='minutes'; minutesInterval=30 }) } } },
  @{ name='Garantir tabela de controle'; type='n8n-nodes-base.postgres'; typeVersion=2.6; position=@(-380,0)
     parameters=@{ operation='executeQuery'; query=$setupSql; options=@{} }; credentials=$pgCred },
  @{ name='Buscar reservas na janela'; type='n8n-nodes-base.postgres'; typeVersion=2.6; position=@(-160,0)
     parameters=@{ operation='executeQuery'; query=$selectSql; options=@{} }; credentials=$pgCred },
  @{ name='Formatar'; type='n8n-nodes-base.code'; typeVersion=2; position=@(60,0)
     parameters=@{ mode='runOnceForEachItem'; jsCode=$formatJs } },
  @{ name='Tipo de lembrete'; type='n8n-nodes-base.switch'; typeVersion=3.4; position=@(280,0)
     parameters=@{ rules=@{ values=@(
         @{ conditions=@{ options=@{ caseSensitive=$true; typeValidation='strict'; version=3 }
                          conditions=@(@{ leftValue='={{ $json.kind }}'; rightValue='24h'; operator=@{ type='string'; operation='equals' } })
                          combinator='and' }; renameOutput=$true; outputKey='24h' },
         @{ conditions=@{ options=@{ caseSensitive=$true; typeValidation='strict'; version=3 }
                          conditions=@(@{ leftValue='={{ $json.kind }}'; rightValue='4h'; operator=@{ type='string'; operation='equals' } })
                          combinator='and' }; renameOutput=$true; outputKey='4h' }
       ) }; options=@{ fallbackOutput='none' } } },
  @{ name='Lembrete 24h'; type='n8n-nodes-base.gmail'; typeVersion=2.2; position=@(520,-120)
     parameters=@{ sendTo='={{ $json.user_email }}'; subject='=See you tomorrow — {{ $json.restaurant_name }}'; message=$tpl24; options=@{ appendAttribution=$false } }
     credentials=$gmailCred },
  @{ name='Lembrete 4h'; type='n8n-nodes-base.gmail'; typeVersion=2.2; position=@(520,120)
     parameters=@{ sendTo='={{ $json.user_email }}'; subject='=Almost time — {{ $json.restaurant_name }}'; message=$tpl4; options=@{ appendAttribution=$false } }
     credentials=$gmailCred },
  @{ name='Registrar envio'; type='n8n-nodes-base.postgres'; typeVersion=2.6; position=@(760,0)
     parameters=@{ operation='executeQuery'
                   query="INSERT INTO public.email_reminders_sent (reservation_code, kind)`nVALUES (`$1, `$2)`nON CONFLICT DO NOTHING;"
                   options=@{ queryReplacement='={{ $json.reservation_code }}, {{ $json.kind }}' } }
     credentials=$pgCred }
)

$connections = @{
  'A cada 30 min'               = @{ main = @(, @(@{ node='Garantir tabela de controle'; type='main'; index=0 })) }
  'Garantir tabela de controle' = @{ main = @(, @(@{ node='Buscar reservas na janela'; type='main'; index=0 })) }
  'Buscar reservas na janela'   = @{ main = @(, @(@{ node='Formatar'; type='main'; index=0 })) }
  'Formatar'                    = @{ main = @(, @(@{ node='Tipo de lembrete'; type='main'; index=0 })) }
  'Tipo de lembrete'            = @{ main = @(
                                      , @(@{ node='Lembrete 24h'; type='main'; index=0 })
                                      , @(@{ node='Lembrete 4h';  type='main'; index=0 })
                                    ) }
  'Lembrete 24h'                = @{ main = @(, @(@{ node='Registrar envio'; type='main'; index=0 })) }
  'Lembrete 4h'                 = @{ main = @(, @(@{ node='Registrar envio'; type='main'; index=0 })) }
}

$newWf = @{ name = 'Lembretes de reserva — 24h e 4h (Clé d''Or)'; nodes = $nodes; connections = $connections; settings = @{ executionOrder = 'v1' } }

if ($DryRun) {
  Write-Host ('  DRY-RUN: criaria o workflow "{0}" com {1} nós (Schedule 30min → dedup em email_reminders_sent).' -f $newWf.name, $nodes.Count) -ForegroundColor Yellow
} else {
  $json  = $newWf | ConvertTo-Json -Depth 100
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $created = Invoke-RestMethod -Method Post -Uri "$base/workflows" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $bytes
  $created | ConvertTo-Json -Depth 100 | Out-File (Join-Path $bakDir ("lembretes-criado-$stamp.json")) -Encoding utf8
  Write-Host ("  CRIADO (desativado): id {0} — '{1}'" -f $created.id, $created.name) -ForegroundColor Green
  Write-Host '  Para ativar: abra no n8n, rode uma execução manual de teste e ligue o Active.' -ForegroundColor Cyan
}

Write-Host "`nConcluído. Checklist pós-execução: (1) workflows seguem ativos; (2) reserva de teste ponta a ponta; (3) criar reserva de teste ~24h no futuro e executar o fluxo de lembretes manualmente; (4) ativar lembretes; (5) rotacionar a API key." -ForegroundColor Magenta
