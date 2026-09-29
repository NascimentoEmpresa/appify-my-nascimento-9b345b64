# ============================================================================
#  Copia o backup do banco do GitHub para o servidor de arquivos da empresa
# ============================================================================
#
#  POR QUE EXISTE
#  -------------
#  Ate 29/09/2026 o backup do banco existia num lugar so: os artifacts do
#  GitHub Actions, com 14 dias de retencao. Isso deixava dois furos:
#
#    1. Um fornecedor so. Perder a conta do GitHub = perder todo o historico.
#    2. Catorze dias. Um problema descoberto no dia 15 nao teria backup bom.
#
#  O servidor de arquivos da empresa (S:) resolve os dois: e outro fornecedor
#  (a propria empresa) e nao tem prazo de validade. Em 29/09/2026 ele tinha
#  370 GB livres de 1,1 TB - o suficiente para anos, considerando ~6 GB em
#  regime permanente com a politica de retencao abaixo.
#
#  POR QUE NAO E O GITHUB ACTIONS QUE COPIA
#  ----------------------------------------
#  O runner do GitHub nao alcanca \\192.168.100.60 - e rede interna da empresa.
#  A copia tem que ser puxada de dentro. Hoje isso e uma tarefa agendada na
#  maquina do Eduardo; quando o servidor Linux chegar, ele assume e a maquina
#  sai da jogada.
#
#  LIMITACAO QUE PRECISA ESTAR CLARA
#  ---------------------------------
#  Enquanto rodar no PC do Eduardo, a copia so acontece com o PC ligado. Se
#  ficar dias desligado, o S: fica defasado - e o script avisa por DM quando
#  detecta isso.
#
#  E o S: e UM servidor, sem imutabilidade. Um ransomware na rede da empresa
#  alcanca ele. Isto e uma terceira localizacao sob controle diferente
#  (Supabase / GitHub / servidor interno), nao um cofre. O Object Lock em
#  nuvem continua sendo o passo seguinte.
#
#  O ARQUIVO JA VEM CRIPTOGRAFADO
#  ------------------------------
#  O que se copia e o .dump.gpg, cifrado com a chave publica do Eduardo pelo
#  proprio workflow. Nem o servidor de arquivos nem quem tiver acesso a ele
#  consegue ler. Ver docs/restaurar-backup.md.
#
#  COMO USAR
#  ---------
#    powershell -ExecutionPolicy Bypass -File scripts\copiar-backup-para-servidor.ps1
#
#  Agendar uma vez (no PowerShell como Administrador):
#    $acao = New-ScheduledTaskAction -Execute "powershell.exe" `
#      -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PWD\scripts\copiar-backup-para-servidor.ps1`""
#    $gatilho = New-ScheduledTaskTrigger -Daily -At 19:30
#    Register-ScheduledTask -TaskName "Backup ERP para servidor" -Action $acao -Trigger $gatilho
#
#  19:30 e depois do backup das 18:00, com folga para os ~11 min de execucao.
# ============================================================================

[CmdletBinding()]
param(
    # Destino combinado com o Eduardo em 29/09/2026.
    [string]$Destino = "S:\1- SERVIDOR\Analise de dados\Grupo Nascimento\Analise de Sistemas\Eduardo\BACKUP-BANCO",

    [string]$Repo = "NascimentoEmpresa/appify-my-nascimento-9b345b64",

    # Retencao. Diarios recentes para voltar pouco tempo; semanais e mensais
    # para voltar meses sem guardar 700 arquivos.
    [int]$ManterDiarios  = 30,
    [int]$ManterSemanais = 12,
    [int]$ManterMensais  = 12,

    # Quantos dias sem copia nova antes de considerar que algo esta errado.
    [int]$AlertarSeAtrasoDias = 3,

    [switch]$SemAlerta
)

$ErrorActionPreference = "Stop"
$Inicio = Get-Date

function Log {
    param([string]$Texto, [string]$Cor = "Gray")
    Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $Texto) -ForegroundColor $Cor
}

# ---------------------------------------------------------------------------
# Aviso por DM. Mesmo destino do vigia e do backup: uma pessoa so, nunca canal.
# ---------------------------------------------------------------------------
function Avisar {
    param([string]$Mensagem)
    if ($SemAlerta) { Log "  (alerta suprimido por -SemAlerta)"; return }

    # As credenciais vivem no worker\.env, que e git-ignorado. Nenhuma
    # credencial aparece neste arquivo.
    $EnvPath = Join-Path (Split-Path $PSScriptRoot -Parent) "worker\.env"
    if (-not (Test-Path $EnvPath)) { Log "  worker\.env nao encontrado - sem aviso." "DarkYellow"; return }

    $Cfg = @{}
    Get-Content $EnvPath | ForEach-Object {
        if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $Cfg[$Matches[1]] = $Matches[2].Trim('"').Trim("'") }
    }
    $Token = $Cfg["DISCORD_BOT_TOKEN"]
    $User  = $Cfg["DISCORD_USER_ID"]
    if (-not $Token -or -not $User) { Log "  DISCORD_BOT_TOKEN/USER_ID ausentes - sem aviso." "DarkYellow"; return }

    try {
        $UA = "DiscordBot (https://github.com/$Repo, 1.0)"
        $H  = @{ Authorization = "Bot $Token" }
        $Canal = Invoke-RestMethod -Method Post -Uri "https://discord.com/api/v10/users/@me/channels" `
            -Headers $H -ContentType "application/json" -UserAgent $UA `
            -Body (@{ recipient_id = $User } | ConvertTo-Json)
        Invoke-RestMethod -Method Post -Uri "https://discord.com/api/v10/channels/$($Canal.id)/messages" `
            -Headers $H -ContentType "application/json" -UserAgent $UA `
            -Body (@{ content = $Mensagem } | ConvertTo-Json) | Out-Null
        Log "  aviso enviado por DM." "DarkGray"
    } catch {
        Log "  nao consegui avisar no Discord: $($_.Exception.Message)" "DarkYellow"
    }
}

try {
    Log "Copia do backup do banco para o servidor da empresa" "Cyan"

    # -----------------------------------------------------------------------
    # 1. O destino esta acessivel?
    # -----------------------------------------------------------------------
    # Unidade de rede cai, e cair em silencio e o pior caso: o script acharia
    # que copiou e nao copiou nada.
    $RaizDestino = Split-Path $Destino -Qualifier
    if (-not (Test-Path $RaizDestino)) {
        throw "A unidade $RaizDestino nao esta acessivel. A unidade de rede pode ter caido."
    }
    if (-not (Test-Path $Destino)) {
        New-Item -ItemType Directory -Path $Destino -Force | Out-Null
        Log "Pasta de destino criada: $Destino" "Yellow"
    }

    # -----------------------------------------------------------------------
    # 2. Qual e o backup mais recente que passou?
    # -----------------------------------------------------------------------
    Log "Procurando a ultima execucao bem-sucedida do backup..."
    # Sem `2>&1`: no PowerShell 5.1 redirecionar stderr de executavel nativo
    # embrulha cada linha num ErrorRecord e faz $? virar $false mesmo com exit
    # code 0. E o -join porque o JSON pode vir em varias linhas, e o pipe manda
    # linha a linha para o ConvertFrom-Json, que entao falha.
    $Json = (& gh run list --workflow=backup_banco.yml --status success -L 1 `
        --json databaseId,createdAt -R $Repo) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "gh run list falhou (exit $LASTEXITCODE)." }

    $Execucao = @($Json | ConvertFrom-Json)
    if (-not $Execucao -or $Execucao.Count -eq 0) {
        throw "Nenhuma execucao bem-sucedida do backup encontrada."
    }
    $RunId = $Execucao[0].databaseId
    $Quando = [datetime]$Execucao[0].createdAt
    Log "  execucao $RunId, de $($Quando.ToLocalTime().ToString('dd/MM/yyyy HH:mm'))"

    $Atraso = (New-TimeSpan -Start $Quando.ToLocalTime() -End $Inicio).Days
    if ($Atraso -ge $AlertarSeAtrasoDias) {
        Avisar ":warning: **Backup do banco defasado**`nA execucao bem-sucedida mais recente tem $Atraso dias. Confira o workflow ``Backup do banco`` no Actions."
    }

    # -----------------------------------------------------------------------
    # 3. Baixar - e so se ainda nao tivermos
    # -----------------------------------------------------------------------
    $Temp = Join-Path $env:TEMP ("backup-erp-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
    New-Item -ItemType Directory -Path $Temp -Force | Out-Null

    try {
        Log "Baixando o artefato..."
        & gh run download $RunId -D $Temp -R $Repo | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "gh run download falhou para a execucao $RunId." }

        # -File e obrigatorio: o `gh run download` cria uma PASTA com o nome do
        # artefato e poe o arquivo dentro. Sem -File, o Get-ChildItem devolve a
        # pasta primeiro, e DirectoryInfo nao tem .Length - o tamanho vira 0 e
        # a checagem seguinte aborta sem explicar direito o porque.
        $Arquivo = Get-ChildItem -Path $Temp -Recurse -File -Filter "*.dump.gpg" | Select-Object -First 1
        if (-not $Arquivo) {
            throw "Nenhum .dump.gpg no artefato. O workflow pode ter publicado em texto claro - verifique AGORA."
        }

        # -------------------------------------------------------------------
        # 4. Conferir que presta ANTES de guardar
        # -------------------------------------------------------------------
        # Guardar arquivo quebrado e pior que nao guardar: da falsa seguranca.
        $TamanhoMB = [math]::Round($Arquivo.Length / 1MB, 1)
        Log "  $($Arquivo.Name) - $TamanhoMB MB"

        if ($Arquivo.Length -lt 50MB) {
            throw "Arquivo com apenas $TamanhoMB MB - esperado mais de 100 MB. Copia provavelmente truncada."
        }

        # Os cinco primeiros bytes de um dump em texto claro sao "PGDMP". Se
        # aparecerem aqui, a criptografia falhou e o arquivo NAO pode ir para
        # um servidor compartilhado.
        $Bytes = [System.IO.File]::ReadAllBytes($Arquivo.FullName)[0..4]
        if ([System.Text.Encoding]::ASCII.GetString($Bytes) -eq "PGDMP") {
            throw "O arquivo esta em TEXTO CLARO. Nao vou copiar para o servidor compartilhado."
        }

        # -------------------------------------------------------------------
        # 5. Copiar - idempotente
        # -------------------------------------------------------------------
        $Alvo = Join-Path $Destino $Arquivo.Name
        if (Test-Path $Alvo) {
            Log "  ja existe no servidor, nada a fazer." "DarkGray"
        } else {
            Copy-Item $Arquivo.FullName $Alvo
            $Copiado = Get-Item $Alvo
            if ($Copiado.Length -ne $Arquivo.Length) {
                Remove-Item $Alvo -Force
                throw "A copia ficou com tamanho diferente do original. Removida."
            }
            Log "  copiado para $Alvo" "Green"
        }
    } finally {
        Remove-Item $Temp -Recurse -Force -ErrorAction SilentlyContinue
    }

    # -----------------------------------------------------------------------
    # 6. Retencao
    # -----------------------------------------------------------------------
    # O nome traz a data: backup-AAAAMMDD-HHMMSS.dump.gpg. A data sai do nome,
    # nao do LastWriteTime, porque copiar mexe no LastWriteTime e isso faria a
    # regra apagar o arquivo errado.
    Log "Aplicando retencao..."
    $Todos = Get-ChildItem -Path $Destino -Filter "backup-*.dump.gpg" | ForEach-Object {
        if ($_.Name -match 'backup-(\d{4})(\d{2})(\d{2})-') {
            [pscustomobject]@{
                Arquivo = $_
                Data    = Get-Date -Year $Matches[1] -Month $Matches[2] -Day $Matches[3] -Hour 0 -Minute 0 -Second 0
            }
        }
    } | Sort-Object Data -Descending

    $Guardar = New-Object System.Collections.Generic.HashSet[string]

    # Diarios: os N mais recentes.
    $Todos | Select-Object -First $ManterDiarios | ForEach-Object { [void]$Guardar.Add($_.Arquivo.Name) }

    # Semanais: o mais recente de cada semana, nas N semanas mais recentes.
    $Todos | Group-Object { "{0}-{1}" -f $_.Data.Year, (Get-Date $_.Data -UFormat %V) } |
        Select-Object -First $ManterSemanais | ForEach-Object {
            [void]$Guardar.Add(($_.Group | Sort-Object Data -Descending | Select-Object -First 1).Arquivo.Name)
        }

    # Mensais: o mais recente de cada mes, nos N meses mais recentes.
    $Todos | Group-Object { "{0:yyyy-MM}" -f $_.Data } |
        Select-Object -First $ManterMensais | ForEach-Object {
            [void]$Guardar.Add(($_.Group | Sort-Object Data -Descending | Select-Object -First 1).Arquivo.Name)
        }

    $Apagar = $Todos | Where-Object { -not $Guardar.Contains($_.Arquivo.Name) }
    if ($Apagar) {
        foreach ($X in $Apagar) {
            Remove-Item $X.Arquivo.FullName -Force
            Log "  removido $($X.Arquivo.Name)" "DarkGray"
        }
    }

    $Restantes = Get-ChildItem -Path $Destino -Filter "backup-*.dump.gpg"
    $TotalGB = [math]::Round(($Restantes | Measure-Object Length -Sum).Sum / 1GB, 2)
    Log ("Pronto: {0} backups no servidor, {1} GB, em {2:N0}s" -f `
        $Restantes.Count, $TotalGB, (New-TimeSpan -Start $Inicio -End (Get-Date)).TotalSeconds) "Green"

} catch {
    Log "FALHOU: $($_.Exception.Message)" "Red"
    Avisar ":x: **Copia do backup para o servidor FALHOU**`n$($_.Exception.Message)"
    exit 1
}
