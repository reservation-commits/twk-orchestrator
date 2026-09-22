# test-guards.ps1 — Suíte determinística dos guardrails (hook guard-sql.ps1).
# Roda sem banco, sem rede, sem IA. Exit 0 = todos passaram; exit 1 = falha.
# Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File orchestrator\tests\test-guards.ps1

$ErrorActionPreference = 'Stop'
$guard = Join-Path $PSScriptRoot '..\..\.claude\hooks\guard-sql.ps1'
if (-not (Test-Path $guard)) { Write-Error "guard-sql.ps1 nao encontrado"; exit 1 }

function Invoke-Guard([string]$command) {
    $payload = @{ tool_name = 'Bash'; tool_input = @{ command = $command } } | ConvertTo-Json -Compress
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'powershell'
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$guard`""
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardOutput = $true
    $psi.UseShellExecute = $false
    $p = [System.Diagnostics.Process]::Start($psi)
    $p.StandardInput.Write($payload)
    $p.StandardInput.Close()
    $p.WaitForExit()
    return $p.ExitCode
}

$casos = @(
    # --- DEVEM SER BLOQUEADOS (exit 2) ---
    @{ nome = 'DROP TABLE direto';               cmd = 'psql -c "DROP TABLE db_restaurants"';                                              esperado = 2 },
    @{ nome = 'TRUNCATE camuflado em script';    cmd = 'node run.js --sql "TRUNCATE TABLE reservations"';                                  esperado = 2 },
    @{ nome = 'DELETE sem WHERE';                cmd = 'psql -c "DELETE FROM reservations"';                                               esperado = 2 },
    @{ nome = 'UPDATE sem WHERE';                cmd = 'psql -c "UPDATE db_restaurants SET published = false"';                            esperado = 2 },
    @{ nome = 'UPDATE com WHERE true (tautologia)'; cmd = 'psql -c "UPDATE db_restaurants SET published=false WHERE true"';                esperado = 2 },
    @{ nome = 'DELETE com WHERE 1=1';            cmd = 'psql -c "DELETE FROM reservations WHERE 1=1"';                                     esperado = 2 },
    @{ nome = 'GRANT ALL';                       cmd = 'psql -c "GRANT ALL ON DATABASE twk TO atacante"';                                  esperado = 2 },
    @{ nome = 'DROP em minusculas multi-linha';  cmd = "psql -f x.sql`ndrop table db_restaurants";                                         esperado = 2 },
    @{ nome = 'rm -rf raiz';                     cmd = 'rm -rf /';                                                                          esperado = 2 },
    @{ nome = 'pg_restore --clean';              cmd = 'pg_restore --clean -d twk backup.dump';                                            esperado = 2 },

    # --- DEVEM PASSAR (exit 0) ---
    @{ nome = 'SELECT inofensivo';               cmd = 'psql -c "SELECT count(*) FROM reservations"';                                      esperado = 0 },
    @{ nome = 'UPDATE com WHERE legitimo';       cmd = 'psql -c "UPDATE db_restaurants SET published=true WHERE id = 42"';                 esperado = 0 },
    @{ nome = 'DELETE com WHERE legitimo';       cmd = 'psql -c "DELETE FROM aria_processed_messages WHERE created_at < now() - interval ''48 hours''"'; esperado = 0 },
    @{ nome = 'git status';                      cmd = 'git status';                                                                        esperado = 0 },
    @{ nome = 'texto que fala de drop sem SQL';  cmd = 'echo "vamos fazer o drop-off do relatorio na tabela de reunioes"';                 esperado = 0 }
)

$falhas = 0
foreach ($c in $casos) {
    $code = Invoke-Guard $c.cmd
    $ok = ($code -eq $c.esperado)
    $tag = if ($ok) { 'PASS' } else { 'FAIL'; $falhas++ }
    Write-Output ("[{0}] {1} (esperado {2}, obtido {3})" -f $tag, $c.nome, $c.esperado, $code)
}

Write-Output ""
if ($falhas -gt 0) { Write-Output "$falhas caso(s) falharam."; exit 1 }
Write-Output ("Todos os {0} casos passaram." -f $casos.Count)
exit 0
