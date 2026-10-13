#!/bin/bash
# Espelha os ARQUIVOS de anexo entre banco1 e banco2.
#
# POR QUE ISTO EXISTE
# O banco e replicado de forma sincrona: transacao confirmada esta nos dois nos.
# Os ARQUIVOS nao. O storage-api esta com STORAGE_BACKEND=file, e "file" quer
# dizer disco local do container. Medido em 13/10/2026:
#
#   upload no banco1  -> 200
#   download no banco1 -> 200 "arquivo-criado-no-banco1"
#   download no banco2 -> 500  (a LINHA existe, os bytes nao)
#
# Repare no 500, nao 404: o anexo APARECE na lista do ERP -- porque a lista vem
# do banco, que e compartilhado -- e estoura ao abrir. Sem este espelho, uma
# troca de primario transforma todo anexo enviado no outro no em link quebrado.
#
# AS DUAS DECISOES QUE IMPORTAM
#
# 1. -X (xattr) e OBRIGATORIO. O content-type do anexo nao mora no banco: mora
#    em extended attribute no proprio arquivo:
#       user.supabase.content-type="application/pdf"
#       user.supabase.cache-control="no-cache"
#    Copia sem -X entrega o byte certo e o download morre com ENODATA, num erro
#    que nao fala de arquivo nenhum. Ja aconteceu com tar neste projeto.
#
# 2. --ignore-existing, e NUNCA --delete. O caminho de cada arquivo termina na
#    versao (.../prova.txt/7b7a326b-...), ou seja o conteudo de um caminho nunca
#    muda. Entao nao existe conflito a resolver: quem ja tem, ja tem o certo.
#    Sem --delete porque os dois nos rodam isto um contra o outro; com --delete,
#    o no que ainda nao recebeu um arquivo novo apagaria o original no outro.
#    O custo e arquivo orfao ocupando disco depois de uma exclusao -- barato, e
#    resolvivel depois por uma faxina que confira contra storage.objects.
#
# O QUE ISTO NAO RESOLVE
# A janela do intervalo do timer. Anexo enviado e provedor caindo no mesmo
# minuto = arquivo so no no que caiu, e ele volta quando o no voltar. O banco
# tem perda zero; o anexo tem ate 1 minuto. Alternativa seria backend S3
# compartilhado -- que elimina a janela e, em troca, devolve ao desenho um
# fornecedor unico para os anexos, que e exatamente o que este projeto existe
# para evitar. Decisao registrada, nao esquecida.
set -u

PEER="${1:-}"
if [ -z "$PEER" ]; then
  case "$(hostname)" in
    banco1) PEER=10.77.0.12 ;;
    banco2) PEER=10.77.0.11 ;;
    *) echo "nao sei quem e o par de $(hostname); passe o IP como argumento" >&2; exit 2 ;;
  esac
fi

VOLUME="${VOLUME:-erp-pilha_storage-arquivos}"
CHAVE="${CHAVE:-/root/.ssh/espelho_anexos}"

DESTINO=$(docker volume inspect "$VOLUME" --format '{{.Mountpoint}}' 2>/dev/null)
if [ -z "$DESTINO" ]; then
  echo "volume $VOLUME nao existe nesta maquina -- a pilha ja subiu aqui?" >&2
  exit 1
fi
mkdir -p "$DESTINO"

# O par responde o mesmo caminho, mas nao assumimos: perguntamos.
ORIGEM=$(ssh -i "$CHAVE" -o BatchMode=yes -o ConnectTimeout=10 \
         -o StrictHostKeyChecking=accept-new "root@$PEER" \
         "docker volume inspect $VOLUME --format '{{.Mountpoint}}'" 2>/dev/null)
if [ -z "$ORIGEM" ]; then
  echo "nao consegui perguntar o caminho ao par $PEER" >&2
  exit 1
fi

exec rsync -aX --ignore-existing --timeout=120 \
  -e "ssh -i $CHAVE -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new" \
  "root@$PEER:$ORIGEM/" "$DESTINO/"
