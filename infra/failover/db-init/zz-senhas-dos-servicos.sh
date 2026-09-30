#!/bin/bash
# ============================================================================
#  Alinha a senha das contas de servico com a do .env  (roda UMA vez, no
#  primeiro boot do banco, antes de qualquer servico conectar)
# ============================================================================
#
#  O PROBLEMA QUE ISTO RESOLVE
#  A imagem supabase/postgres ja vem com os papeis authenticator,
#  supabase_auth_admin e supabase_storage_admin criados - mas com senha PROPRIA
#  dela, nao a do nosso .env. O resultado, medido em 30/09/2026:
#
#    rest-1 | FATAL: password authentication failed for user "authenticator"
#    auth-1 | failed SASL auth ... user "supabase_auth_admin"
#
#  e os dois containers em "Restarting (1)" para sempre. O sintoma na tela e a
#  aplicacao inteira em branco - parece backup quebrado, e e so senha.
#
#  POR QUE NAO DA PARA CORRIGIR DEPOIS, POR SQL
#  Porque nao da mesmo. A imagem carrega a extensao supautils, e
#  `supautils.reserved_roles` lista exatamente esses tres. Rodando um
#  ALTER ROLE como o usuario `postgres` (que NAO e superusuario nesta imagem,
#  apesar do nome) vem:
#
#    ERROR: "authenticator" is a reserved role, only superusers can modify it
#
#  O unico superusuario e `supabase_admin` (`supautils.superuser`), e a senha
#  dele nao esta em lugar nenhum do nosso lado. Entao a janela para fazer isso
#  e agora: durante a inicializacao, quando o entrypoint ainda alcanca o banco
#  pelo socket local.
#
#  ONDE ISTO E MONTADO
#  Em /docker-entrypoint-initdb.d/ (ver docker-compose.yml, servico db). O nome
#  comeca com "zz" de proposito: o entrypoint roda os arquivos em ordem
#  alfabetica e a propria imagem tem um migrate.sh ali. Queremos ser os
#  ultimos.
#
#  ATENCAO: scripts de initdb rodam SO na primeira criacao do volume. Se o
#  volume db-dados ja existir, este arquivo e ignorado - para reaplicar:
#    docker compose down -v && docker compose up -d
#  (o -v apaga o banco; depois recarregue com ./preparar-replica.sh)
# ============================================================================
set -euo pipefail

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD nao definida}"
BANCO="${POSTGRES_DB:-postgres}"

echo "[zz-senhas] alinhando senha de authenticator / supabase_auth_admin / supabase_storage_admin"

# Precisa ser o supabase_admin: e o unico que a supautils deixa mexer nos
# papeis reservados. Pelo socket local, durante o initdb, ele entra sem senha.
psql -v ON_ERROR_STOP=1 --username supabase_admin --dbname "$BANCO" <<SQL
alter user authenticator          with login password '${POSTGRES_PASSWORD}';
alter user supabase_auth_admin    with login password '${POSTGRES_PASSWORD}';
alter user supabase_storage_admin with login password '${POSTGRES_PASSWORD}';
SQL

echo "[zz-senhas] pronto"
