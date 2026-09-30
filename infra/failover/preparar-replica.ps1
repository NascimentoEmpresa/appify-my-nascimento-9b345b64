# ============================================================================
#  Carrega o backup de producao na replica self-hosted
# ============================================================================
#
#  Este script existe porque a replica sobe VAZIA. Ele faz o caminho completo:
#  descriptografa o backup, cria os papeis, restaura e conserta as permissoes.
#
#  AS DUAS CORRECOES QUE DESCOBRIMOS NOS ENSAIOS (e que nao sao obvias):
#
#  1) OS PAPEIS PRECISAM EXISTIR ANTES DA RESTAURACAO.
#     `CREATE POLICY ... TO authenticated` FALHA se o papel nao existir, e
#     falha em SILENCIO. Medido em 29/09/2026: sem os papeis, de 1.447
#     politicas de RLS apenas 35 eram restauradas. Um banco com os dados
#     completos e 2% da seguranca - todo usuario enxergando tudo.
#
#  2) O DUMP NAO CARREGA OS GRANTS.
#     Ele e gerado com --no-privileges (necessario para restaurar em qualquer
#     Postgres). Sem os GRANTs, o PostgREST nao enxerga as tabelas e a
#     aplicacao abre em branco - parece backup quebrado, mas e so permissao.
#
#  USO:
#    .\preparar-replica.ps1 -Backup "C:\...\backup-AAAAMMDD.dump.gpg"
# ============================================================================

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Backup,

    [int]$Porta = 55432,
    [string]$Usuario = "postgres",
    [switch]$PularDescriptografia
)

$ErrorActionPreference = "Stop"
function Log { param([string]$t, [string]$c = "Gray") Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $t) -ForegroundColor $c }

# --- credenciais da replica, geradas por gerar-chaves.mjs --------------------
$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) { throw "Falta o .env. Rode: node gerar-chaves.mjs" }
$cfg = @{}
Get-Content $envPath | ForEach-Object {
    if ($_ -match '^\s*([A-Z_]+)=(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim() }
}
$env:PGPASSWORD = $cfg["POSTGRES_PASSWORD"]

$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$pgrestore = "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe"
if (-not (Test-Path $psql)) { throw "psql nao encontrado em $psql" }

function Sql { param([string]$q, [string]$db = "postgres")
    & $psql -h localhost -p $Porta -U $Usuario -d $db -At -c $q
}

try {
    Log "Preparando a replica" "Cyan"

    # --- 1. a replica esta no ar? -------------------------------------------
    $vivo = Sql "select 1"
    if ($vivo -ne "1") { throw "A replica nao respondeu na porta $Porta. Rode: docker compose up -d" }
    Log "  replica respondendo na porta $Porta"

    # --- 2. descriptografar --------------------------------------------------
    $dump = $Backup
    if (-not $PularDescriptografia) {
        if (-not $Backup.EndsWith(".gpg")) { throw "Esperado um .dump.gpg. Use -PularDescriptografia se ja estiver em claro." }
        $dump = Join-Path $env:TEMP ("replica-" + [guid]::NewGuid().ToString("N").Substring(0,8) + ".dump")
        $gpg = Join-Path $env:LOCALAPPDATA "Programs\Git\usr\bin\gpg.exe"
        if (-not (Test-Path $gpg)) { $gpg = "gpg" }
        Log "Descriptografando (vai pedir a sua senha da chave)..." "Yellow"
        & $gpg --pinentry-mode loopback -o $dump -d $Backup
        if ($LASTEXITCODE -ne 0) { throw "Falha ao descriptografar. Senha errada?" }
        Log ("  " + [math]::Round((Get-Item $dump).Length / 1MB, 1) + " MB em claro (temporario)")
    }

    # --- 3. CORRECAO 1: criar os papeis ANTES ---------------------------------
    Log "Criando os papeis da Supabase (antes da restauracao)..."
    $papeis = @('anon','authenticated','authenticator','cli_login_postgres','dashboard_user',
                'service_role','supabase_admin','supabase_auth_admin','supabase_etl_admin',
                'supabase_functions_admin','supabase_privileged_role','supabase_read_only_user',
                'supabase_realtime_admin','supabase_replication_admin','supabase_storage_admin')
    foreach ($p in $papeis) {
        Sql "do `$`$ begin if not exists (select 1 from pg_roles where rolname='$p') then create role `"$p`" nologin noinherit; end if; end `$`$;" | Out-Null
    }
    Log ("  " + (Sql "select count(*) from pg_roles where rolname not like 'pg_%'") + " papeis presentes")

    # --- 3b. CORRECAO 3: AS EXTENSOES TAMBEM PRECISAM EXISTIR ANTES ----------
    # O backup e gerado por schema (public, auth, storage, espelho). Isso deixa
    # o schema "extensions" da Supabase FORA do dump, e junto com ele nenhuma
    # EXTENSION vem. Conferido em 30/09/2026 com pg_restore -l: o dump tem
    # 8.276 entradas e ZERO do tipo EXTENSION.
    #
    # Sem pre-criar, o restore perde coisa em silencio (exit 1 no meio de 8 mil
    # objetos nao chama atencao nenhuma):
    #   public.gin_trgm_ops        -> pg_trgm. Perde o indice de busca por nome
    #                                 em "EMPREGADOS" (13.369 linhas).
    #   EXCLUDE USING gist         -> btree_gist. Perde as DUAS travas de
    #                                 sobreposicao: vigencia em
    #                                 planejamento_orcamentario e sala/horario
    #                                 em reuniao. Sem elas o banco passa a
    #                                 aceitar reserva duplicada.
    #   extensions.gen_random_bytes-> pgcrypto no schema extensions. E DEFAULT
    #                                 de coluna em sup_compra_pedido_envio:
    #                                 sem a funcao a TABELA nao e criada, e
    #                                 caem com ela 2 indices, 2 FKs e 1 policy.
    #
    # Medido: sem este bloco a replica vem com 640 tabelas / 1.299 policies em
    # vez de 641 / 1.312. Parece certo e nao esta.
    Log "Criando os schemas e extensoes que o dump nao traz..."
    Sql "create schema if not exists extensions;" | Out-Null
    Sql "create extension if not exists pg_trgm    with schema public;"        | Out-Null
    Sql "create extension if not exists btree_gist with schema public;"        | Out-Null
    Sql "create extension if not exists unaccent   with schema public;"        | Out-Null
    Sql "create extension if not exists pgcrypto   with schema extensions;"    | Out-Null
    # uuid-ossp NAO entra aqui, por dois motivos:
    #   1) o schema do ERP nao chama uuid_generate_* em lugar nenhum (conferido
    #      em 30/09/2026: zero ocorrencias no dump), e o Postgres 18 ja tem
    #      gen_random_uuid() nativo;
    #   2) o nome tem hifen e exige aspas duplas no SQL. O PowerShell 5.1 come
    #      aspas dupla ao passar argumento para executavel nativo, entao o psql
    #      recebia create extension uuid-ossp SEM aspas e dava
    #      "syntax error at or near -".
    Log ("  " + (Sql "select count(*) from pg_extension") + " extensoes instaladas")

    # --- 4. restaurar ---------------------------------------------------------
    Log "Restaurando (erros de papel/extensao sao esperados)..."
    $inicio = Get-Date
    # ATENCAO (PowerShell 5.1): NAO usar `2>&1 |` com executavel nativo aqui.
    # Cada linha de stderr do pg_restore virava um NativeCommandError e, com
    # $ErrorActionPreference="Stop", o PRIMEIRO aviso benigno do dump
    # ("schema public already exists") matava o pipeline e derrubava o restore
    # inteiro. Medido em 30/09/2026: o script morreu em 1 SEGUNDO e deixou a
    # replica com 0 tabelas - e a mensagem na tela nao dizia isso.
    # Start-Process grava os dois fluxos em arquivo sem passar pelo pipeline,
    # entao aviso de stderr nao interrompe mais nada.
    $logSaida = Join-Path $env:TEMP "restore-replica.log"
    $logErro  = Join-Path $env:TEMP "restore-replica.err.log"
    $argsRestore = @("-h","localhost","-p","$Porta","-U",$Usuario,"-d","postgres",
                     "--no-owner","--no-privileges","--jobs","2",$dump)
    $proc = Start-Process -FilePath $pgrestore -ArgumentList $argsRestore -NoNewWindow -Wait -PassThru `
                          -RedirectStandardOutput $logSaida -RedirectStandardError $logErro
    if ($proc.ExitCode -ne 0) {
        # pg_restore devolve codigo != 0 tambem por aviso isolado. Isso NAO e
        # fatal por si so - quem decide se a replica serve e a conferencia do
        # passo 6 (contagem de policies). So registramos onde olhar.
        Log ("  pg_restore saiu com codigo " + $proc.ExitCode + " - detalhes em " + $logErro) "Yellow"
    }
    Log ("  restaurado em " + [math]::Round((New-TimeSpan $inicio (Get-Date)).TotalMinutes,1) + " min")

    # --- 5. CORRECAO 2: devolver os GRANTs -----------------------------------
    Log "Aplicando os GRANTs (o dump nao os traz)..."
    foreach ($esquema in @('public','storage')) {
        Sql "grant usage on schema $esquema to anon, authenticated, service_role;" | Out-Null
        Sql "grant all on all tables in schema $esquema to anon, authenticated, service_role;" | Out-Null
        Sql "grant all on all sequences in schema $esquema to anon, authenticated, service_role;" | Out-Null
        Sql "grant all on all functions in schema $esquema to anon, authenticated, service_role;" | Out-Null
    }
    # authenticator precisa poder assumir os outros papeis - e assim que o
    # PostgREST troca de identidade conforme o token recebido.
    Sql "grant anon, authenticated, service_role to authenticator;" | Out-Null

    # --- 5b. CORRECAO 4: AS CONTAS DE SERVICO PRECISAM PODER FAZER LOGIN ------
    # Os papeis do passo 3 nascem NOLOGIN e sem senha, e para a RESTAURACAO
    # isso basta: eles so precisam EXISTIR para as policies se agarrarem neles.
    # Mas na stack em container quem conecta no banco sao os servicos, e eles
    # autenticam por SENHA:
    #   rest    (PostgREST)   -> authenticator
    #   auth    (GoTrue)      -> supabase_auth_admin
    #   storage (Storage API) -> supabase_storage_admin
    # Sem este bloco os tres sobem em restart loop com
    # "password authentication failed", e o sintoma na tela e a aplicacao
    # inteira em branco. Parece backup quebrado; e so login de servico.
    Log "Habilitando login das contas de servico (rest/auth/storage)..."
    foreach ($conta in @('authenticator','supabase_auth_admin','supabase_storage_admin')) {
        Sql "alter role `"$conta`" with login password '$($cfg['POSTGRES_PASSWORD'])';" | Out-Null
    }

    # O GoTrue e o Storage rodam migration propria no boot e precisam mandar no
    # proprio schema. O dump e restaurado com --no-owner, entao 'auth' e
    # 'storage' chegam pertencendo a postgres e os dois servicos nao
    # conseguiriam alterar nada.
    Sql "alter schema auth owner to supabase_auth_admin;"                          | Out-Null
    Sql "alter schema storage owner to supabase_storage_admin;"                    | Out-Null
    Sql "grant all on all tables in schema auth to supabase_auth_admin;"           | Out-Null
    Sql "grant all on all sequences in schema auth to supabase_auth_admin;"        | Out-Null
    Sql "grant all on all tables in schema storage to supabase_storage_admin;"     | Out-Null
    Sql "grant all on all sequences in schema storage to supabase_storage_admin;"  | Out-Null
    Log ("  " + (Sql "select count(*) from pg_roles where rolcanlogin and rolname like 'supabase%' or rolname='authenticator'") + " contas de servico com login")

    # --- 6. conferir ----------------------------------------------------------
    Log "Conferindo o que chegou..." "Cyan"
    $tab = Sql "select count(*) from information_schema.tables where table_schema in ('public','auth','storage','espelho') and table_type='BASE TABLE'"
    $pol = Sql "select count(*) from pg_policies where schemaname='public'"
    $emp = Sql "select count(*) from public.""EMPREGADOS"""
    $usr = Sql "select count(*) from auth.users"
    Log ("  tabelas ..... $tab")
    Log ("  policies RLS  $pol   <- se vier baixo (dezenas), os papeis falharam" ) "Yellow"
    Log ("  EMPREGADOS .. $emp")
    Log ("  logins ...... $usr")

    if ([int]$pol -lt 500) {
        Log "ALERTA: poucas policies de RLS. A replica NAO esta segura para uso." "Red"
        exit 1
    }
    Log "Replica pronta. Rode validar-replica.sql para a conferencia de visibilidade." "Green"

} catch {
    Log "FALHOU: $($_.Exception.Message)" "Red"
    exit 1
} finally {
    if (-not $PularDescriptografia -and $dump -and (Test-Path $dump)) {
        Remove-Item $dump -Force -ErrorAction SilentlyContinue
        Log "  dump em claro removido" "DarkGray"
    }
    Remove-Item env:PGPASSWORD -ErrorAction SilentlyContinue
}
