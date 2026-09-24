# =====================================================================
#  MONITOR DO BANCO - Supabase (projeto erp-nascimento-dev01)
# =====================================================================
#
#  Mostra, em barras de 0 a 100%, os indicadores que realmente previram
#  as quedas de 31/08, 21/09 e 23/09 de 2026. Os numeros NAO sao
#  estimativa: vem do mesmo endpoint de metricas que alimenta o painel
#  da Supabase.
#
#  COMO USAR
#      cd "C:\Users\Eduardo Monteiro\Desktop\Projeto_ERP_LOVABLE"
#      .\scripts\monitor-supabase.ps1
#  Para sair: CTRL + C
#
#  ARQUIVO DE STATUS
#      A cada leitura grava o estado atual em:
#          scripts\status-banco.txt
#      E esse o arquivo que o alerta manda voce abrir por SSH.
#      Para ver por SSH:  type scripts\status-banco.txt
#
#  ALERTA
#      Passando de 75% em qualquer indicador, manda DM no Discord (o
#      mesmo canal que o worker ja usa) dizendo o que passou e o caminho
#      do arquivo. Repete no maximo a cada 30 min por indicador.
#      Rodar com -SemAlerta desliga o envio.
#
#  SEGREDOS
#      Lidos de worker\.env, que esta fora do git. Nenhuma chave neste
#      arquivo.
#
#  NOTA DE ENCODING
#      Este arquivo e ASCII puro de proposito. O PowerShell 5.1 le .ps1
#      como ANSI quando nao ha BOM, e acento/travessao viram lixo que
#      quebra o parser. Os blocos das barras saem por [char] 0x2588.
# =====================================================================

param(
    # 60s de proposito: o endpoint de metricas da Supabase so atualiza
    # cerca de uma vez por minuto. Medido em 24/09/2026 - o mesmo valor
    # voltou identico em leituras de 6s e de 46s. Buscar mais rapido que
    # isso baixa 510 KB para receber o dado repetido.
    [int]$Segundos = 60,
    [int]$Alerta   = 75,
    [switch]$SemAlerta,

    # Le UMA vez, grava o arquivo de status e sai. E o modo para quando
    # voce so quer olhar agora: o arquivo fica fresco na hora, sem precisar
    # deixar janela aberta. Tambem e o modo certo para agendar no Windows.
    # CPU e IOWAIT nao aparecem aqui - eles precisam de duas leituras.
    [switch]$UmaVez
)

$ErrorActionPreference = "Stop"

# Limite de conexoes: vem das PROPRIAS metricas
# (max_connections_connection_count), entao trocar o tamanho da maquina
# - Micro 60, Small 90, Medium 120 - e percebido sozinho. Este valor e so
# o plano B, caso a metrica suma de uma versao futura.
$MaxConexoesPadrao = 90

$BlocoCheio = [char]0x2588
$BlocoVazio = [char]0x2591

# ---- credenciais, lidas do worker\.env ------------------------------
$Raiz       = Split-Path -Parent $PSScriptRoot
$EnvFile    = Join-Path $Raiz "worker\.env"
$ArqStatus  = Join-Path $PSScriptRoot "status-banco.txt"

if (-not (Test-Path $EnvFile)) {
    Write-Host "Nao encontrei $EnvFile - sem ele nao da para ler as metricas." -ForegroundColor Red
    exit 1
}

$Cfg = @{}
foreach ($Linha in Get-Content $EnvFile) {
    if ($Linha -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
        $Cfg[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
    }
}

$SupabaseUrl = $Cfg["SUPABASE_URL"]
$ServiceKey  = $Cfg["SUPABASE_SERVICE_ROLE_KEY"]
$DiscordTok  = $Cfg["DISCORD_BOT_TOKEN"]
$DiscordUser = $Cfg["DISCORD_USER_ID"]

if (-not $SupabaseUrl -or -not $ServiceKey) {
    Write-Host "Faltou SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no worker\.env." -ForegroundColor Red
    exit 1
}

$Projeto     = ([regex]::Match($SupabaseUrl, 'https://([^.]+)\.supabase\.co')).Groups[1].Value
$UrlMetricas = $SupabaseUrl + "/customer/v1/privileged/metrics"

$B64     = [Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes("service_role:" + $ServiceKey))
$Headers = @{ Authorization = "Basic $B64" }

# ---- utilidades -----------------------------------------------------

function Get-Barra {
    param([double]$Pct, [int]$Tamanho = 24)
    $Pct = [math]::Max(0, [math]::Min(100, $Pct))
    $Cheio = [int][math]::Round(($Pct / 100) * $Tamanho)
    return ([string]$BlocoCheio * $Cheio) + ([string]$BlocoVazio * ($Tamanho - $Cheio))
}

function Get-Cor {
    param([double]$Pct)
    if ($Pct -ge $Alerta) { return "Red" }
    if ($Pct -ge 60)      { return "Yellow" }
    return "Green"
}

# Soma TODAS as linhas de uma metrica (ha uma por CPU, por disco, etc.)
function Get-Soma {
    param([string]$Texto, [string]$Nome, [string]$FiltroRotulo = "")
    $Total = 0.0
    $Achou = $false
    $Padrao = '(?m)^' + [regex]::Escape($Nome) + '\{([^}]*)\}\s+([0-9.eE+\-]+)\s*$'
    foreach ($m in [regex]::Matches($Texto, $Padrao)) {
        if ($FiltroRotulo -ne "" -and $m.Groups[1].Value -notmatch $FiltroRotulo) { continue }
        $Total += [double]$m.Groups[2].Value
        $Achou = $true
    }
    if (-not $Achou) { return $null }
    return $Total
}

# Monta uma linha pronta: devolve o texto e escreve colorido na tela.
function Nova-Linha {
    param([string]$Rotulo, [double]$Pct, [string]$Detalhe)
    $Barra = Get-Barra $Pct
    $Cor   = Get-Cor $Pct
    Write-Host ("  {0,-10}" -f $Rotulo) -NoNewline -ForegroundColor Gray
    Write-Host "[" -NoNewline
    Write-Host $Barra -NoNewline -ForegroundColor $Cor
    Write-Host "] " -NoNewline
    Write-Host ("{0,3:N0}%" -f $Pct) -NoNewline -ForegroundColor $Cor
    Write-Host ("   {0}" -f $Detalhe) -ForegroundColor DarkGray
    return ("  {0,-10}[{1}] {2,3:N0}%   {3}" -f $Rotulo, $Barra, $Pct, $Detalhe)
}

# ---- alerta no Discord (texto livre, com trava anti-repeticao) ------
$UltimoAlerta = @{}

function Enviar-Alerta {
    param([string]$Indicador, [double]$Pct, [string]$Detalhe)

    if ($SemAlerta) { return }
    if (-not $DiscordTok -or -not $DiscordUser) { return }

    $Agora = Get-Date
    if ($UltimoAlerta.ContainsKey($Indicador)) {
        if (($Agora - $UltimoAlerta[$Indicador]).TotalMinutes -lt 30) { return }
    }

    $NL = [char]10
    $Texto = "ALERTA - banco de dados" + $NL +
             $Indicador.ToUpper() + " em " + [math]::Round($Pct) + "%  (" + $Detalhe + ")" + $NL +
             "Projeto: " + $Projeto + $NL + $NL +
             "Detalhe completo no arquivo:" + $NL +
             $ArqStatus + $NL + $NL +
             "Por SSH:  type """ + $ArqStatus + """" + $NL +
             "Momento: " + $Agora.ToString("dd/MM/yyyy HH:mm:ss")

    try {
        $H = @{ Authorization = "Bot $DiscordTok"; "Content-Type" = "application/json" }
        $Canal = Invoke-RestMethod -Method Post -Uri "https://discord.com/api/v10/users/@me/channels" -Headers $H -Body (@{ recipient_id = $DiscordUser } | ConvertTo-Json)
        $Url = "https://discord.com/api/v10/channels/" + $Canal.id + "/messages"
        Invoke-RestMethod -Method Post -Uri $Url -Headers $H -Body (@{ content = $Texto } | ConvertTo-Json) | Out-Null
        $UltimoAlerta[$Indicador] = $Agora
        Write-Host ("  -> alerta enviado ({0})" -f $Indicador) -ForegroundColor Magenta
    }
    catch {
        Write-Host ("  -> nao consegui alertar: {0}" -f $_.Exception.Message) -ForegroundColor DarkYellow
    }
}

# ---- laco principal -------------------------------------------------
$CpuAnt = $null; $IdleAnt = $null; $IowAnt = $null
$UltCpu = $null; $UltIow = $null; $UltQuando = $null

Write-Host ""
Write-Host ("  Conectando as metricas de {0}..." -f $Projeto) -ForegroundColor DarkGray

while ($true) {

    $Erro = $null
    try {
        $Txt = (Invoke-WebRequest -Uri $UrlMetricas -Headers $Headers -TimeoutSec 30 -UseBasicParsing).Content
    }
    catch {
        $Erro = $_.Exception.Message
    }

    $Linhas = New-Object System.Collections.ArrayList

    Clear-Host
    Write-Host ""
    Write-Host "  ==============================================================" -ForegroundColor Cyan
    Write-Host "            BANCO DE DADOS - SUPABASE - MONITOR" -ForegroundColor Cyan
    Write-Host "  ==============================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host ("   Projeto : {0}" -f $Projeto) -ForegroundColor DarkGray
    Write-Host ("   Momento : {0}" -f (Get-Date -Format "dd/MM/yyyy HH:mm:ss")) -ForegroundColor DarkGray
    Write-Host ""

    [void]$Linhas.Add("BANCO DE DADOS - SUPABASE - MONITOR")
    [void]$Linhas.Add("Projeto : " + $Projeto)
    [void]$Linhas.Add("Momento : " + (Get-Date -Format "dd/MM/yyyy HH:mm:ss"))
    [void]$Linhas.Add("")

    if ($Erro) {
        Write-Host "   *** NAO CONSEGUI LER AS METRICAS ***" -ForegroundColor Red
        Write-Host ("   {0}" -f $Erro) -ForegroundColor Red
        Write-Host ""
        Write-Host "   Se isso persistir, o banco pode estar fora do ar." -ForegroundColor Yellow
        [void]$Linhas.Add("*** NAO CONSEGUI LER AS METRICAS ***")
        [void]$Linhas.Add($Erro)
        [void]$Linhas.Add("Se persistir, o banco pode estar fora do ar.")
        $Linhas | Set-Content -Path $ArqStatus -Encoding UTF8
        Enviar-Alerta "acesso as metricas" 100 "endpoint nao respondeu"
        Start-Sleep -Seconds $Segundos
        continue
    }

    # CONEXOES - o teto vem da propria metrica, nao de constante no codigo
    $Conex = Get-Soma $Txt "pg_stat_database_num_backends"
    $MaxConexoes = Get-Soma $Txt "max_connections_connection_count"
    if (-not $MaxConexoes -or $MaxConexoes -le 0) { $MaxConexoes = $MaxConexoesPadrao }
    if ($Conex -ne $null) {
        $Pct = 100 * $Conex / $MaxConexoes
        $Det = "{0:N0} de {1:N0}" -f $Conex, $MaxConexoes
        [void]$Linhas.Add((Nova-Linha "CONEXOES" $Pct $Det))
        if ($Pct -ge $Alerta) { Enviar-Alerta "conexoes" $Pct $Det }
    }

    # MEMORIA
    $MemTot  = Get-Soma $Txt "node_memory_MemTotal_bytes"
    $MemDisp = Get-Soma $Txt "node_memory_MemAvailable_bytes"
    if ($MemTot -and $MemDisp) {
        $Pct = 100 * ($MemTot - $MemDisp) / $MemTot
        $Det = "{0:N0} MB livres de {1:N0} MB" -f ($MemDisp/1MB), ($MemTot/1MB)
        [void]$Linhas.Add((Nova-Linha "MEMORIA" $Pct $Det))
        if ($Pct -ge $Alerta) { Enviar-Alerta "memoria" $Pct $Det }
    }

    # SWAP - o aviso mais antecipado de todos
    $SwpTot  = Get-Soma $Txt "node_memory_SwapTotal_bytes"
    $SwpLivr = Get-Soma $Txt "node_memory_SwapFree_bytes"
    if ($SwpTot -and $SwpTot -gt 0) {
        $Pct = 100 * ($SwpTot - $SwpLivr) / $SwpTot
        $Det = "{0:N0} MB em disco de {1:N0} MB" -f (($SwpTot-$SwpLivr)/1MB), ($SwpTot/1MB)
        [void]$Linhas.Add((Nova-Linha "SWAP" $Pct $Det))
        if ($Pct -ge $Alerta) { Enviar-Alerta "swap" $Pct $Det }
    }

    # DISCO
    $DiscTot  = Get-Soma $Txt "node_filesystem_size_bytes"  'mountpoint="/data"'
    $DiscLivr = Get-Soma $Txt "node_filesystem_avail_bytes" 'mountpoint="/data"'
    if ($DiscTot -and $DiscLivr) {
        $Pct = 100 * ($DiscTot - $DiscLivr) / $DiscTot
        $Det = "{0:N1} GB livres de {1:N1} GB" -f ($DiscLivr/1GB), ($DiscTot/1GB)
        [void]$Linhas.Add((Nova-Linha "DISCO" $Pct $Det))
        if ($Pct -ge $Alerta) { Enviar-Alerta "disco" $Pct $Det }
    }

    # CPU e IOWAIT - precisam de duas amostras
    $CpuTot = Get-Soma $Txt "node_cpu_seconds_total"
    $Idle   = Get-Soma $Txt "node_cpu_seconds_total" 'mode="idle"'
    $Iow    = Get-Soma $Txt "node_cpu_seconds_total" 'mode="iowait"'

    # O contador so anda quando a Supabase atualiza o scrape (~1x por
    # minuto). Se voltar IGUAL, NAO mexemos na base de comparacao: se
    # mexessemos, o delta daria zero e a conta explodiria. Nesse caso
    # mostramos o ultimo valor calculado, marcado como tal.
    if ($CpuTot -ne $null) {
        if ($CpuAnt -eq $null) {
            $CpuAnt = $CpuTot; $IdleAnt = $Idle; $IowAnt = $Iow
        }
        elseif ($CpuTot -gt $CpuAnt) {
            $dTot   = $CpuTot - $CpuAnt
            $UltCpu = 100 * (1 - (($Idle - $IdleAnt) / $dTot))
            $UltIow = 100 * (($Iow  - $IowAnt)  / $dTot)
            $UltQuando = Get-Date
            $CpuAnt = $CpuTot; $IdleAnt = $Idle; $IowAnt = $Iow

            if ($UltCpu -ge $Alerta) { Enviar-Alerta "cpu" $UltCpu "uso medio de processador" }
            # IOwait alto e sintoma de falta de memoria, nao de disco lento.
            if ($UltIow -ge 20)      { Enviar-Alerta "iowait" $UltIow "CPU esperando disco - pressao de memoria" }
        }
    }

    Write-Host ""
    [void]$Linhas.Add("")
    if ($UltCpu -ne $null) {
        $Quando = "as " + $UltQuando.ToString("HH:mm:ss")
        [void]$Linhas.Add((Nova-Linha "CPU" $UltCpu ("medido " + $Quando)))
        [void]$Linhas.Add((Nova-Linha "IOWAIT" $UltIow "CPU parada esperando disco"))
    }
    else {
        Write-Host "   CPU e IOWAIT: aguardando a Supabase atualizar (ate 1 min)." -ForegroundColor DarkGray
        [void]$Linhas.Add("  CPU/IOWAIT: aguardando a Supabase atualizar (ate 1 min)")
    }

    [void]$Linhas.Add("")
    [void]$Linhas.Add("Limites: verde < 60% | amarelo 60-" + $Alerta + "% | vermelho >= " + $Alerta + "%")
    [void]$Linhas.Add("Painel: https://supabase.com/dashboard/project/" + $Projeto + "/observability/database")
    [void]$Linhas.Add("")
    [void]$Linhas.Add("ATENCAO: este arquivo so e atualizado enquanto o worker ou o monitor")
    [void]$Linhas.Add("estiverem rodando. Confira o 'Momento' la em cima antes de confiar no")
    [void]$Linhas.Add("numero. Para uma leitura nova agora:")
    [void]$Linhas.Add("    .\scripts\monitor-supabase.ps1 -UmaVez")
    $Linhas | Set-Content -Path $ArqStatus -Encoding UTF8

    Write-Host ""
    Write-Host "  --------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ("   Status gravado em: {0}" -f $ArqStatus) -ForegroundColor DarkGray

    if ($UmaVez) {
        Write-Host "   Leitura unica concluida (-UmaVez)." -ForegroundColor DarkGray
        break
    }

    $Modo = "alerta no Discord acima de $Alerta%"
    if ($SemAlerta) { $Modo = "alerta DESLIGADO (-SemAlerta)" }
    Write-Host ("   Atualiza a cada {0}s . {1}" -f $Segundos, $Modo) -ForegroundColor DarkGray
    Write-Host "   CTRL + C para sair." -ForegroundColor DarkGray

    Start-Sleep -Seconds $Segundos
}
