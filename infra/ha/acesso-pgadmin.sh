#!/usr/bin/env bash
# ============================================================================
#  ACESSO AO BANCO1 PELO pgAdmin 4
#
#  A DIFERENCA EM RELACAO A SUPABASE
#  Na Supabase bastava host + porta + senha: o banco atendia na internet.
#  Aqui NAO atende, e isso e de proposito. Conferido em 19/10/2026:
#
#      127.0.0.1:5000   HAProxy (sempre o lider)   <- so local
#      127.0.0.1:5001   HAProxy (leitura)          <- so local
#      10.77.0.11:5432  Postgres                   <- so pelo tunel WireGuard
#      0.0.0.0:8443     sshd
#      *:443            Caddy (a API do ERP)
#
#  Nao existe porta de banco aberta para a internet. Entao o pgAdmin entra
#  pela aba **SSH Tunnel** -- ela existe exatamente para isto. O pgAdmin abre
#  o SSH, e por dentro dele fala com o 127.0.0.1:5000 do servidor.
#
#  Abrir a 5432 para a internet seria o caminho curto e e justamente o que
#  derrubou tanta gente: Postgres exposto apanha varredura de senha o dia
#  inteiro, e o papel `postgres` daqui e superusuario.
#
#  POR QUE A PORTA 5000, E NAO A 5432
#  A 5000 e o HAProxy, que pergunta ao Patroni quem e o lider. Se houver
#  troca de lider, o pgAdmin continua falando com quem aceita escrita. Apontar
#  direto para o Postgres de um no significa, no dia do failover, estar
#  conectado no standby e receber "cannot execute in a read-only transaction"
#  sem entender por que.
#
#  O USUARIO DO TUNEL NAO TEM SHELL
#  A chave criada aqui entra num usuario que so sabe encaminhar porta:
#  `restrict,port-forwarding,permitopen="127.0.0.1:5000"`. Quem tiver essa
#  chave nao roda comando, nao le arquivo, nao abre sessao -- so alcanca o
#  banco. O controle do que a pessoa FAZ no banco e do papel do Postgres,
#  nao da chave.
#
#  OS DOIS PAPEIS, E a verdade sobre o segundo
#    --leitura   SELECT em tudo, mais BYPASSRLS. Nao escreve nada.
#                O BYPASSRLS esta ai de proposito: sem ele a RLS esconde
#                linhas e a tabela parece VAZIA para quem esta investigando
#                -- o erro mais caro de diagnostico deste projeto. Em troca,
#                esse papel enxerga dado pessoal de funcionario. Nao e papel
#                para distribuir por costume.
#    --migracao  As 680 tabelas do `public` pertencem ao `postgres`, que e
#                SUPERUSUARIO. `CREATE POLICY` exige ser dono da tabela.
#                Entao nao existe "papel que roda migration mas e limitado":
#                esse papel e superusuario na pratica, com outro nome.
#                Com ele da para apagar o banco inteiro.
#                Agora que a migration entra sozinha no merge, pense duas
#                vezes antes de dar este a alguem.
#
#  USO
#    bash infra/ha/acesso-pgadmin.sh --conferir
#    bash infra/ha/acesso-pgadmin.sh --criar eduardo --migracao
#    bash infra/ha/acesso-pgadmin.sh --criar joao    --leitura
#    bash infra/ha/acesso-pgadmin.sh --remover joao
# ============================================================================
set -uo pipefail

BANCO1="${BANCO1:-216.238.120.171}"
PORTA_SSH="${PORTA_SSH:-8443}"
USUARIO_TUNEL="${USUARIO_TUNEL:-pgtunel}"
MODO="${1:---conferir}"
NOME="${2:-}"
PAPEL="${3:-}"

no() { ssh -p "$PORTA_SSH" -o BatchMode=yes -o ConnectTimeout=25 \
         -o StrictHostKeyChecking=accept-new "root@$BANCO1" "$@"; }
psql_no() { no "SUP=\$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-)
  PGPASSWORD=\"\$SUP\" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -At -c \"$1\""; }

# ── --conferir ─────────────────────────────────────────────────────────────
if [ "$MODO" = "--conferir" ]; then
  echo "== quem ja tem chave de tunel no banco1"
  no "if id $USUARIO_TUNEL >/dev/null 2>&1; then
        awk '{for(i=1;i<=NF;i++) if (\$i ~ /^(ssh-|ecdsa-)/) {print \"   \" \$(NF)}}' \
          /home/$USUARIO_TUNEL/.ssh/authorized_keys 2>/dev/null || echo '   (nenhuma)'
      else echo '   usuario $USUARIO_TUNEL ainda nao existe'; fi"
  echo
  echo "== papeis de login no banco (fora os da propria pilha)"
  psql_no "select rolname||'  super='||rolsuper||'  bypassrls='||rolbypassrls
             from pg_roles where rolcanlogin
              and rolname not in ('postgres','authenticator','replicator','supabase_auth_admin','supabase_storage_admin')
            order by 1" | sed 's/^/   /'
  echo
  echo "   Criar:  bash infra/ha/acesso-pgadmin.sh --criar <nome> --leitura|--migracao"
  exit 0
fi

# ── --remover ──────────────────────────────────────────────────────────────
if [ "$MODO" = "--remover" ]; then
  [ -n "$NOME" ] || { echo "falta o nome" >&2; exit 2; }
  echo "== removendo o acesso de $NOME"
  no "sed -i '/pgadmin-$NOME\$/d' /home/$USUARIO_TUNEL/.ssh/authorized_keys 2>/dev/null; echo '   chave retirada'"
  psql_no "drop role if exists acesso_$NOME" | sed 's/^/   /'
  echo "   papel removido. A chave local em ~/.ssh/pgadmin-$NOME pode ser apagada."
  exit 0
fi

# ── --criar ────────────────────────────────────────────────────────────────
[ "$MODO" = "--criar" ] || { sed -n '2,66p' "$0"; exit 2; }
[ -n "$NOME" ] || { echo "falta o nome: --criar <nome> --leitura|--migracao" >&2; exit 2; }
case "$PAPEL" in --leitura|--migracao) ;; *) echo "falta --leitura ou --migracao" >&2; exit 2 ;; esac
case "$NOME" in *[!a-z0-9_]*) echo "nome so com minusculas, numeros e _" >&2; exit 2 ;; esac

CHAVE="$HOME/.ssh/pgadmin-$NOME"
FICHA="$HOME/pgadmin-$NOME.txt"

# 1. a chave. -m PEM porque o pgAdmin usa paramiko, que tropeca no formato
#    novo do OpenSSH em varias versoes -- e o erro que ele mostra fala de
#    "not a valid key", sem dizer que o problema e o formato.
if [ -f "$CHAVE" ]; then
  echo "== reaproveitando a chave que ja existe em $CHAVE"
else
  echo "== gerando a chave"
  ssh-keygen -q -t rsa -b 4096 -m PEM -N '' -C "pgadmin-$NOME" -f "$CHAVE" || exit 1
fi

# 2. o usuario do tunel e a chave restrita
echo "== instalando a chave no banco1, sem shell e so com a porta do banco"
PUB=$(cat "$CHAVE.pub")
no "set -e
  id $USUARIO_TUNEL >/dev/null 2>&1 || useradd -m -s /usr/sbin/nologin $USUARIO_TUNEL
  mkdir -p /home/$USUARIO_TUNEL/.ssh && chmod 700 /home/$USUARIO_TUNEL/.ssh
  touch /home/$USUARIO_TUNEL/.ssh/authorized_keys
  # idempotente: tira a linha antiga deste nome antes de pos a nova
  sed -i '/pgadmin-$NOME\$/d' /home/$USUARIO_TUNEL/.ssh/authorized_keys
  # restrict desliga TUDO; port-forwarding volta so o encaminhamento, e o
  # permitopen limita o destino as duas portas do HAProxy.
  printf '%s %s\n' 'restrict,port-forwarding,permitopen=\"127.0.0.1:5000\",permitopen=\"127.0.0.1:5001\"' '$PUB' \
    >> /home/$USUARIO_TUNEL/.ssh/authorized_keys
  chmod 600 /home/$USUARIO_TUNEL/.ssh/authorized_keys
  chown -R $USUARIO_TUNEL:$USUARIO_TUNEL /home/$USUARIO_TUNEL/.ssh
  echo '   chave instalada para $USUARIO_TUNEL'" || exit 1

# 3. o papel no banco. Senha so com letras e numeros: ela vai dentro de uma
#    string SQL e dentro de um arquivo que uma pessoa vai copiar e colar.
SENHA=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28)
[ "${#SENHA}" -ge 20 ] || { echo "nao consegui gerar senha" >&2; exit 1; }

echo "== criando o papel acesso_$NOME no banco"
if [ "$PAPEL" = "--leitura" ]; then
  SQL="do \$\$ begin
         if not exists (select 1 from pg_roles where rolname='acesso_$NOME') then
           execute format('create role acesso_$NOME login password %L', '$SENHA');
         else
           execute format('alter role acesso_$NOME login password %L', '$SENHA');
         end if;
       end \$\$;
       alter role acesso_$NOME nosuperuser nocreatedb nocreaterole bypassrls inherit;
       grant connect on database postgres to acesso_$NOME;
       grant pg_read_all_data to acesso_$NOME;"
  RESUMO="LEITURA — vê tudo (inclusive dado pessoal), não escreve nada."
else
  SQL="do \$\$ begin
         if not exists (select 1 from pg_roles where rolname='acesso_$NOME') then
           execute format('create role acesso_$NOME login password %L', '$SENHA');
         else
           execute format('alter role acesso_$NOME login password %L', '$SENHA');
         end if;
       end \$\$;
       alter role acesso_$NOME login nosuperuser inherit;
       grant connect on database postgres to acesso_$NOME;
       grant postgres to acesso_$NOME;"
  RESUMO="MIGRATION — na prática superusuário (as 680 tabelas são do postgres)."
fi
printf '%s\n' "$SQL" | no "SUP=\$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-)
  PGPASSWORD=\"\$SUP\" psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -q -v ON_ERROR_STOP=1 -f -" || exit 1
echo "   papel criado"

# 4. provar que o tunel funciona DE VERDADE, da maquina de quem vai usar.
#    Sem esta prova a pessoa descobre que nao funciona dentro do pgAdmin, onde
#    a mensagem de erro e generica.
echo "== provando o tunel (porta local 55432)"
ssh -i "$CHAVE" -p "$PORTA_SSH" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    -f -N -L 55432:127.0.0.1:5000 "$USUARIO_TUNEL@$BANCO1" 2>/dev/null
PID_TUNEL=$!
sleep 2
if (exec 3<>/dev/tcp/127.0.0.1/55432) 2>/dev/null; then
  echo "   tunel abriu e o banco atendeu do outro lado."
  PROVA="sim"
else
  echo "   ⚠ o tunel NAO abriu. Veja a nota no fim da ficha."
  PROVA="nao"
fi
pkill -f "55432:127.0.0.1:5000" 2>/dev/null

# 5. a ficha, para copiar campo a campo. A senha vai SO para este arquivo --
#    ela nao aparece na tela, porque tela de terminal costuma virar registro.
umask 077
cat > "$FICHA" <<FIM
pgAdmin 4 — conexão com o banco1 (cluster do ERP)
Criada em $(date '+%d/%m/%Y %H:%M') para: $NOME
Papel: $RESUMO

>>> ABA "General"
Name:            banco1 (produção)

>>> ABA "Connection"
Host name/address: 127.0.0.1
Port:              5000
Maintenance DB:    postgres
Username:          acesso_$NOME
Password:          $SENHA
   marque "Save password?"

>>> ABA "SSH Tunnel"
Use SSH tunneling:  ligado
Tunnel host:        $BANCO1
Tunnel port:        $PORTA_SSH
Username:           $USUARIO_TUNEL
Authentication:     Identity file
Identity file:      $(cygpath -w "$CHAVE" 2>/dev/null || echo "$CHAVE")
Password:           (deixe vazio — a chave não tem senha)

>>> ABA "Parameters"
   nada a preencher. SSL não é necessário: o tráfego já vai
   dentro do túnel SSH, cifrado. "sslmode=require" aqui só
   produz erro, porque o Postgres responde em 127.0.0.1 do
   servidor e não tem certificado próprio.

----------------------------------------------------------------
O host 127.0.0.1 na aba Connection NÃO é o seu PC. Ele é lido do
outro lado do túnel, dentro do servidor. É assim que o pgAdmin
funciona, e é o campo que mais confunde.

A porta 5000 é o HAProxy, que sempre aponta para o líder. Se o
banco1 cair e o banco2 assumir, a mesma conexão continua caindo
em quem aceita escrita.

Teste do túnel na criação: $PROVA
Se deu "nao": normalmente é a rede da empresa barrando a saída na
8443. Teste em outra rede ou pelo celular; a 443 aqui é do Caddy
e não pode ser usada para SSH.
FIM

echo
echo "   Ficha com TODOS os campos (inclusive a senha, que não imprimi aqui):"
echo "      $(cygpath -w "$FICHA" 2>/dev/null || echo "$FICHA")"
echo
echo "   Abra esse arquivo e preencha o pgAdmin campo a campo."
