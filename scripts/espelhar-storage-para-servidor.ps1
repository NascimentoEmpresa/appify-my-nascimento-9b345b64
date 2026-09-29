# ============================================================================
#  Espelha os arquivos do Storage da Supabase no servidor de arquivos da empresa
# ============================================================================
#
#  POR QUE EXISTE
#  -------------
#  O backup do banco (backup_banco.yml) NAO inclui os arquivos do Storage - ele
#  guarda so os metadados. Restaurar aquele dump devolve *a lista* de arquivos,
#  nao os arquivos. E a mesma limitacao que a propria Supabase avisa na tela de
#  backups dela.
#
#  Medido em 28/09/2026: sao 7.380 arquivos e 4.465 MB - quase 3x o tamanho do
#  banco (1,61 GB). Crescimento so em setembro: 6.213 arquivos, 3.415 MB. Os
#  tres maiores buckets sao checklist-faturamento-anexos (1,5 GB),
#  malote-anexos (757 MB) e treinamentos (474 MB).
#
#  Ate 29/09/2026 esses arquivos tinham ZERO copias. Num desastre total, o banco
#  restaurado diria que 7.380 arquivos existem e nenhum abriria.
#
#  POR QUE NAO CABE NO GITHUB ACTIONS
#  ----------------------------------
#  Dois motivos. Volume: 4,4 GB por execucao, crescendo, e artifact e imutavel -
#  nao da para mandar so o que mudou. E rede: o runner nao alcanca
#  \\192.168.100.60, que e a rede interna da empresa.
#
#  POR QUE `copy` E NAO `sync`
#  ---------------------------
#  `rclone sync` apaga no destino o que sumiu na origem. Num BACKUP isso e
#  exatamente o contrario do que se quer: se alguem apagar um anexo por engano,
#  o backup tem que continuar com ele. `copy` so acrescenta e atualiza, nunca
#  apaga. O espelho fica maior que a origem com o tempo, e esta certo assim.
#
#  A DIRECAO E UMA SO: Supabase -> servidor. Este script nunca escreve na
#  Supabase. Trocar a ordem dos argumentos do rclone escreveria arquivos de
#  volta em producao, por isso a origem e o destino sao montados em variaveis
#  separadas e conferidos antes.
#
#  ATENCAO AO CONTEUDO
#  -------------------
#  Diferente do dump do banco, estes arquivos vao para o servidor EM CLARO -
#  eles nao passam por criptografia. Sao curriculos, documentos de demissao,
#  fotos de cracha e anexos fiscais. A pasta de destino merece permissao
#  restrita no servidor, porque concentra num lugar so o que hoje esta espalhado.
#
#  CREDENCIAIS
#  -----------
#  Lidas do worker\.env, que e git-ignorado. Nenhuma credencial aparece aqui.
#  Criar em: Supabase > Storage > S3 > New access key. Depois por no worker\.env:
#
#    SUPABASE_S3_ACCESS_KEY_ID=...
#    SUPABASE_S3_SECRET_ACCESS_KEY=...
#
#  COMO USAR
#  ---------
#    powershell -ExecutionPolicy Bypass -File scripts\espelhar-storage-para-servidor.ps1
#
#  Primeira execucao baixa os 4,4 GB inteiros. As seguintes levam so o que mudou.
# ============================================================================

[CmdletBinding()]
param(
    [string]$Destino  = "S:\1- SERVIDOR\Analise de dados\Grupo Nascimento\Analise de Sistemas\Eduardo\BACKUP-STORAGE",
    [string]$Endpoint = "https://fwmzeaztjxrxxzxzxmgc.storage.supabase.co/storage/v1/s3",
    [string]$Regiao   = "sa-east-1",

    # Quantos downloads simultaneos. 4 e conservador de proposito: o objetivo e
    # nao competir com o uso normal do sistema pela banda da empresa.
    [int]$Paralelos = 4,

    # Só lista o que faria, sem baixar nada.
    [switch]$Ensaio,
    [switch]$SemAlerta
)

$ErrorActionPreference = "Stop"
$Inicio = Get-Date

function Log {
    param([string]$Texto, [string]$Cor = "Gray")
    Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $Texto) -ForegroundColor $Cor
}

function LerEnv {
    $EnvPath = Join-Path (Split-Path $PSScriptRoot -Parent) "worker\.env"
    if (-not (Test-Path $EnvPath)) { throw "worker\.env nao encontrado em $EnvPath" }
    $Cfg = @{}
    Get-Content $EnvPath | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $Cfg[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    return $Cfg
}

function Avisar {
    param([string]$Mensagem)
    if ($SemAlerta) { Log "  (alerta suprimido por -SemAlerta)"; return }
    try {
        $Cfg = LerEnv
        $Token = $Cfg["DISCORD_BOT_TOKEN"]; $User = $Cfg["DISCORD_USER_ID"]
        if (-not $Token -or -not $User) { Log "  sem credenciais de Discord - ninguem avisado." "DarkYellow"; return }
        $UA = "DiscordBot (https://github.com/NascimentoEmpresa/appify-my-nascimento-9b345b64, 1.0)"
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
    Log "Espelho do Storage da Supabase para o servidor da empresa" "Cyan"

    # -----------------------------------------------------------------------
    # 1. Ferramenta e credenciais
    # -----------------------------------------------------------------------
    $Rclone = Get-Command rclone -ErrorAction SilentlyContinue
    if (-not $Rclone) {
        $Candidato = Join-Path $env:USERPROFILE "bin\rclone.exe"
        if (Test-Path $Candidato) { $Rclone = $Candidato } else {
            throw "rclone nao encontrado. Baixe de https://rclone.org/downloads/ e ponha em $env:USERPROFILE\bin."
        }
    } else { $Rclone = $Rclone.Source }

    $Cfg = LerEnv
    $ChaveId = $Cfg["SUPABASE_S3_ACCESS_KEY_ID"]
    $Segredo = $Cfg["SUPABASE_S3_SECRET_ACCESS_KEY"]
    if (-not $ChaveId -or -not $Segredo) {
        throw "Faltam SUPABASE_S3_ACCESS_KEY_ID / SUPABASE_S3_SECRET_ACCESS_KEY no worker\.env. Crie em Supabase > Storage > S3 > New access key."
    }

    # O rclone e configurado por VARIAVEL DE AMBIENTE, nao por arquivo de
    # configuracao: assim a chave nao fica gravada em disco em rclone.conf.
    $env:RCLONE_CONFIG_SUPA_TYPE              = "s3"
    $env:RCLONE_CONFIG_SUPA_PROVIDER          = "Other"
    $env:RCLONE_CONFIG_SUPA_ENDPOINT          = $Endpoint
    $env:RCLONE_CONFIG_SUPA_REGION            = $Regiao
    $env:RCLONE_CONFIG_SUPA_ACCESS_KEY_ID     = $ChaveId
    $env:RCLONE_CONFIG_SUPA_SECRET_ACCESS_KEY = $Segredo
    # Supabase nao implementa HeadBucket como a AWS; sem isto o rclone falha
    # antes de listar.
    $env:RCLONE_CONFIG_SUPA_NO_CHECK_BUCKET   = "true"

    # -----------------------------------------------------------------------
    # 2. Destino acessivel
    # -----------------------------------------------------------------------
    $RaizDestino = Split-Path $Destino -Qualifier
    if (-not (Test-Path $RaizDestino)) {
        throw "A unidade $RaizDestino nao esta acessivel. A unidade de rede pode ter caido."
    }
    if (-not (Test-Path $Destino)) {
        New-Item -ItemType Directory -Path $Destino -Force | Out-Null
        Log "Pasta de destino criada: $Destino" "Yellow"
    }

    # -----------------------------------------------------------------------
    # 3. A origem responde?
    # -----------------------------------------------------------------------
    Log "Listando os buckets..."
    $Buckets = @(& $Rclone lsd "SUPA:" --retries 2)
    if ($LASTEXITCODE -ne 0) {
        throw "Nao consegui listar os buckets. Confira a chave S3 e se o 'S3 protocol connection' esta ligado no painel."
    }
    Log "  $($Buckets.Count) buckets encontrados"

    # -----------------------------------------------------------------------
    # 4. Copiar
    # -----------------------------------------------------------------------
    # ORIGEM e DESTINO em variaveis separadas e nesta ordem. Inverter os dois
    # argumentos do rclone escreveria arquivos de volta em PRODUCAO.
    $Origem = "SUPA:"
    $Para   = $Destino

    $Flags = @(
        "--transfers", $Paralelos
        "--checkers", 8
        "--retries", 3
        "--low-level-retries", 5
        # `copy` nunca apaga no destino; ver o cabecalho deste arquivo.
        "--stats", "30s"
        "--stats-one-line"
        "--log-level", "NOTICE"
    )
    if ($Ensaio) { $Flags += "--dry-run"; Log "ENSAIO: nada sera baixado" "Yellow" }

    Log "Copiando $Origem -> $Para"
    & $Rclone copy $Origem $Para @Flags
    if ($LASTEXITCODE -ne 0) { throw "rclone copy terminou com erro (exit $LASTEXITCODE)." }

    # -----------------------------------------------------------------------
    # 5. Conferir o que chegou
    # -----------------------------------------------------------------------
    $Arquivos = Get-ChildItem -Path $Destino -Recurse -File
    $TotalGB  = [math]::Round(($Arquivos | Measure-Object Length -Sum).Sum / 1GB, 2)
    $Minutos  = [math]::Round((New-TimeSpan -Start $Inicio -End (Get-Date)).TotalMinutes, 1)
    Log ("Pronto: {0} arquivos, {1} GB, em {2} min" -f $Arquivos.Count, $TotalGB, $Minutos) "Green"

    # Sanidade: em 28/09/2026 eram 7.380 arquivos. Bem menos que isso significa
    # que a copia parou no meio - e espelho pela metade da falsa seguranca.
    if (-not $Ensaio -and $Arquivos.Count -lt 5000) {
        Avisar ":warning: **Espelho do Storage suspeito**`nSó $($Arquivos.Count) arquivos no servidor; em 28/09 eram 7.380. A cópia pode ter parado no meio."
    }

} catch {
    Log "FALHOU: $($_.Exception.Message)" "Red"
    Avisar ":x: **Espelho do Storage FALHOU**`n$($_.Exception.Message)"
    exit 1
} finally {
    # Nao deixar a chave viva no ambiente depois que o script termina.
    Get-ChildItem env: | Where-Object { $_.Name -like "RCLONE_CONFIG_SUPA_*" } |
        ForEach-Object { Remove-Item ("env:" + $_.Name) -ErrorAction SilentlyContinue }
}
