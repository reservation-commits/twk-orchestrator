# agendar.ps1 - registra no Agendador de Tarefas do Windows os ciclos da Regencia do MAESTRO e o gate do Guardiao.
# v2 (2026-09-04) apos incidente: (1) toda tarefa roda via wrapper .cmd com stdout/stderr em orchestrator\logs\tarefas\ (antes: sem log, impossivel diagnosticar);
# (2) -WakeToRun para acordar o notebook; (3) gatilho horario corrigido (Daily + repeticao; antes era Once e expirava no mesmo dia);
# (4) limite de execucao curto para nunca ficar preso.
# Uso:  powershell -ExecutionPolicy Bypass -File orchestrator\command-center\regencia\agendar.ps1 [-Remover]
# Limite conhecido: tarefas em modo "Interactive" so rodam com o usuario logado. A versao hospedada da Regencia (REGENCIA_ENABLED=on na Central) e a solucao definitiva.
param([switch]$Remover)
$ErrorActionPreference = 'Stop'
$node = (Get-Command node).Source
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$logDir = Join-Path $repo 'orchestrator\logs\tarefas'
New-Item -ItemType Directory -Force $logDir | Out-Null
$nomes = @('TWK MAESTRO Regencia (diario)', 'TWK MAESTRO Regencia (horario)', 'TWK Guardiao Reserva (gate canario)', 'TWK Ciclo do Cliente (diario)')
if ($Remover) { foreach ($n in $nomes) { Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction SilentlyContinue }; Write-Output 'Tarefas removidas.'; exit 0 }

# Wrapper: cmd /c "node <script> <args> >> <log> 2>&1" - registra tudo o que o processo imprime.
function Acao($script, $args, $logName) {
  $log = Join-Path $logDir ($logName + '-%DATE:~-4%%DATE:~3,2%%DATE:~0,2%.log')
  $cmd = '/c ""' + $node + '" "' + $script + '" ' + $args + ' >> "' + $log + '" 2>&1"'
  New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmd -WorkingDirectory $repo
}
$regencia = Join-Path $repo 'orchestrator\command-center\regencia\run.js'
$guardiao = Join-Path $repo 'orchestrator\agents\guardiao-reserva\run.js'
$ciclo = Join-Path $repo 'orchestrator\agents\ciclo-cliente\run.js'
# Aprovacao permanente do fundador (chat 2026-09-11) para o ciclo do cliente entrar em operacao diaria; o run.js
# continua exigindo a frase e mantem ledger + consentimento + limite de 40 por execucao.
$ciclOk = '--apply --aprovacao "fundador, chat 2026-09-11: aprovado o ciclo do cliente (vespera, pos-visita, boas-vindas) em operacao diaria"'

$cfg = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Minutes 12) -MultipleInstances IgnoreNew -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)

$gatD = New-ScheduledTaskTrigger -Daily -At 08:00
$gatH = New-ScheduledTaskTrigger -Daily -At 08:30
$gatH.Repetition = (New-ScheduledTaskTrigger -Once -At 08:30 -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Hours 13)).Repetition
$gatG = New-ScheduledTaskTrigger -Daily -At 09:00
$gatC = New-ScheduledTaskTrigger -Daily -At 09:15

Register-ScheduledTask -TaskName $nomes[0] -Action (Acao $regencia '' 'regencia-diario') -Trigger $gatD -Settings $cfg -Description 'Despacho diario do MAESTRO ao fundador (Regencia TWK) - com log' -Force | Out-Null
Register-ScheduledTask -TaskName $nomes[1] -Action (Acao $regencia '--modo horario' 'regencia-horario') -Trigger $gatH -Settings $cfg -Description 'Ciclo horario da Regencia: alerta critico novo (TWK) - com log' -Force | Out-Null
Register-ScheduledTask -TaskName $nomes[2] -Action (Acao $guardiao '--gate --canario "Paris,Athens,Marrakesh" --max-emails 20' 'guardiao-gate') -Trigger $gatG -Settings $cfg -Description 'Guardiao da Reserva: lote do canario para aprovacao na Central (TWK) - com log' -Force | Out-Null
Register-ScheduledTask -TaskName $nomes[3] -Action (Acao $ciclo $ciclOk 'ciclo-cliente') -Trigger $gatC -Settings $cfg -Description 'Ciclo do cliente: vespera, pos-visita e boas-vindas (TWK) - com log' -Force | Out-Null
Write-Output ('Tarefas registradas (v2, com log em ' + $logDir + '): Regencia diario 08:00 - horario 08:30-21:30 - Guardiao gate 09:00 - Ciclo do cliente 09:15. Ver: Get-ScheduledTask | ? TaskName -like "TWK *"')
