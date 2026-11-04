#!/usr/bin/env bash
# ============================================================================
#  DIAGNÓSTICO DA PRODUÇÃO EM UM BLOCO DE TEXTO — para colar no Claude
#
#  Uso (no terminal do PC, no prompt do Claude Code):
#     ! bash infra/observabilidade/diagnostico.sh            (últimos 10 min)
#     ! MINUTOS=30 bash infra/observabilidade/diagnostico.sh
#
#  Por que existe (item 8, 03/11/2026): na queda daquele dia a investigação
#  levou horas de garimpo — e um `docker logs` no Kong de 4,8 GB AGRAVOU a
#  queda. Este script junta, em ~100 linhas, tudo o que o post-mortem precisou
#  (docs/incidentes/2026-11-03-post-mortem.md), nos DOIS nós, sem passar pelo
#  dockerd e com nice/ionice. A saída inteira cabe numa mensagem: cole e
#  pronto, a causa costuma estar escrita nela.
#
#  Só LÊ. Não muda nada em lugar nenhum.
#
#  As seções, e o que cada uma responde:
#    [1] máquina ......... CPU/carga/memória/disco agora e a cada 10 min hoje
#    [2] patroni ......... quem é o líder, lag, última troca
#    [3] api (kong) ...... req/min, 4xx, 5xx por minuto; top rotas; tempo de
#                          resposta (rt=) quando o log já tiver o campo
#    [4] postgrest ....... pool esgotado (PGRST003), schema cache que falhou,
#                          reconexões, LISTEN cortado — por minuto
#    [5] postgres ........ conexões por app, o que está rodando agora e há
#                          quanto tempo, quem espera lock, timeouts recentes
#                          por alvo, top consultas (pg_stat_statements, se ligado)
#    [6] containers ...... CPU/memória de cada container agora
#    [7] origem .......... de onde vem o tráfego (app oficial x dev local)
# ============================================================================
set -uo pipefail

MIN="${MINUTOS:-10}"
NOS=("216.238.120.171:banco1" "172.237.48.8:banco2")
PORTA="${PORTA_SSH:-8443}"

no() { ssh -o BatchMode=yes -o ConnectTimeout=10 -p "$PORTA" "root@$1" "${@:2}"; }

echo "=== DIAGNÓSTICO $(date -u +'%Y-%m-%d %H:%M UTC') · janela ${MIN} min ==="

for par in "${NOS[@]}"; do
  IP="${par%%:*}"; NOME="${par##*:}"
  echo
  echo "################ $NOME ($IP)"
  no "$IP" MIN="$MIN" NOME="$NOME" 'bash -s' <<'REMOTO'
set -uo pipefail
desde=$(date -u -d "-$MIN min" +%s)

echo "[1] máquina: $(nproc) núcleos · carga $(cut -d" " -f1-3 /proc/loadavg) · $(free -m | awk "/Mem/{printf \"mem %d/%d MB (disponível %d)\", \$3,\$2,\$7}") · disco $(df -h / | awk "NR==2{print \$5\" de \"\$2}")"
LC_ALL=C mpstat 1 2 2>/dev/null | awk '/Average/{printf "    cpu agora: usr %s%% sys %s%% iowait %s%% steal %s%% idle %s%%\n",$3,$5,$6,$9,$12}'
LC_ALL=C sar -u 2>/dev/null | awk 'NR>3 && $1 ~ /^[0-9]/ && $NF ~ /^[0-9.]+$/ && (100-$NF)>60 {printf "    sar hoje %s: %.0f%% ocupada\n",$1,100-$NF}' | tail -6

echo "[2] patroni:"
/opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml list 2>/dev/null | grep -E "banco|Member" | sed 's/^/    /'
/opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml history 2>/dev/null | grep -E "^\| +[0-9]" | tail -1 | sed 's/^/    última troca: /'

K=$(docker inspect -f '{{.LogPath}}' erp-pilha-kong-1 2>/dev/null)
if [ -n "$K" ]; then
  echo "[3] api (kong), por minuto (UTC):  req  4xx  5xx  rt_p95"
  # só a cauda do arquivo: 60 MB cobrem bem mais que 30 min de pico
  LC_ALL=C nice -n 19 ionice -c3 tail -c 60000000 "$K" | sed 's/\\"/"/g' | awk -v desde="$desde" '
    match($0, /\[[0-9]+\/[A-Za-z]+\/[0-9]+:[0-9:]+ /) {
      ts=substr($0, RSTART+1, RLENGTH-2); split(ts, p, /[\/:]/)
      m=sprintf("%s:%s", p[4], p[5])
      cmd="date -u -d \"" p[1] " " p[2] " " p[3] " " p[4] ":" p[5] ":" p[6] "\" +%s";
      if (!(m in visto)) { cmd | getline e; close(cmd); visto[m]=e } ; if (visto[m] < desde) next
      if ($0 ~ /"OPTIONS /) next
      n[m]++; if (match($0, /" [0-9]{3} /)) { st=substr($0, RSTART+2, 3); if (st ~ /^5/) e5[m]++; else if (st ~ /^4/) e4[m]++ }
      if (match($0, /rt=[0-9.]+/)) { rt=substr($0,RSTART+3,RLENGTH-3)+0; k=m SUBSEP (++c[m]); v[k]=rt }
      if (match($0, /"(GET|POST|HEAD|PATCH|DELETE) \/[^ ?]+/)) { r=substr($0,RSTART+1,RLENGTH-1); gsub(/[0-9a-f]{8}-[0-9a-f-]{27}/,":id",r); rota[r]++ ; if (st ~ /^5/) rota5[r]++ }
      if (match($0, / [0-9][0-9][0-9] [0-9-]+ "https?:\/\/[^\/"]+/)) { o=substr($0,RSTART,RLENGTH); sub(/^ [0-9]+ [0-9-]+ "/,"",o); orig[o]++ } else orig["(sem referer)"]++
    }
    END {
      for (m in n) lin[m]=1; k2=asorti(lin, ord)
      for (i=1;i<=k2;i++) { m=ord[i]; p95="-"; if (c[m]>0) { delete a; for (j=1;j<=c[m];j++) a[j]=v[m SUBSEP j]; asort(a); p95=sprintf("%.2fs", a[int(0.95*c[m])>0?int(0.95*c[m]):1]) } ; printf "    %s  %5d %4d %4d  %s\n", m, n[m], e4[m]+0, e5[m]+0, p95 }
      print "    top rotas na janela (req · 5xx):"
      PROCINFO["sorted_in"]="@val_num_desc"; i=0; for (r in rota) { if (++i>12) break; printf "      %6d %5d  %s\n", rota[r], rota5[r]+0, r }
      print "[7] origem (referer):"; i=0; for (o in orig) { if (++i>6) break; printf "      %6d  %s\n", orig[o], o }
    }'
fi

R=$(docker inspect -f '{{.LogPath}}' erp-pilha-rest-1 2>/dev/null)
if [ -n "$R" ]; then
  echo "[4] postgrest (eventos na janela):"
  LC_ALL=C tail -c 20000000 "$R" | grep -v 'HTTP/1.1' | grep -oE '"time":"[0-9T:-]+|PGRST[0-9]{3}|Failed to load the schema cache|Attempting to reconnect|Failed listening|Schema cache loaded' \
   | awk -v desde="$desde" '/"time"/{ t=substr($0,9); cmd="date -u -d \"" t "\" +%s"; cmd | getline e; close(cmd); ok=(e>=desde); m=substr(t,12,5); next } ok { c[m" "$0]++ } END { for (k in c) printf "    %s  %dx\n", k, c[k] }' | sort | tail -20
  curl -s --max-time 3 http://127.0.0.1:3001/metrics 2>/dev/null | grep -E '^pgrst_db_pool_(available|waiting|max|timeouts_total)|^pgrst_schema_cache_loads_total' | sed 's/^/    /'
fi

if [ "$NOME" = "banco1" ]; then
  echo "[5] postgres:"
  sudo -u postgres psql -X -At -F' ' <<'SQL' 2>/dev/null | sed 's/^/    /'
select 'conexões: '||string_agg(n||' '||a, ' · ' order by n desc) from (select coalesce(nullif(application_name,''),usename) a, count(*) n from pg_stat_activity where backend_type='client backend' group by 1) x;
select 'max_connections '||current_setting('max_connections')||' · em uso '||count(*) from pg_stat_activity;
select 'RODANDO há '||to_char(now()-query_start,'MI:SS')||' ['||coalesce(wait_event_type||'/'||wait_event,'cpu')||'] '||usename||': '||left(regexp_replace(query,'\s+',' ','g'),150)
  from pg_stat_activity where state='active' and pid<>pg_backend_pid() and backend_type='client backend' order by query_start limit 8;
select 'ESPERANDO LOCK: pid '||pid||' bloqueado por '||pg_blocking_pids(pid)::text||': '||left(regexp_replace(query,'\s+',' ','g'),120)
  from pg_stat_activity where cardinality(pg_blocking_pids(pid))>0 limit 5;
SQL
  echo "    statement timeout na janela, por alvo:"
  journalctl -u patroni --since "-$MIN min" --no-pager -o cat 2>/dev/null | awk '
    /canceling statement due to statement timeout/ { esperando=1; next }
    esperando && /STATEMENT:/ { s=$0; if (match(s,/FROM "public"\."[^"]+"/)) a=substr(s,RSTART+15,RLENGTH-16); else if (s ~ /p_fonte/) a="rpc fluxo_caixa_ler_fonte"; else if (s ~ /pg_catalog|columns AS/) a="(schema cache do PostgREST)"; else a=substr(s,index(s,"STATEMENT:")+11,60); c[a]++; esperando=0 }
    END { for (k in c) printf "      %5d  %s\n", c[k], k }' | sort -rn | head -8
  echo "    erros do postgres na janela (os mais repetidos):"
  journalctl -u patroni --since "-$MIN min" --no-pager -o cat 2>/dev/null | grep -E " (FATAL|PANIC|ERROR): " | sed -E 's/^[0-9-]+ [0-9:.]+ UTC \[[0-9]+\] //' | cut -c1-110 | sort | uniq -c | sort -rn | head -6 | sed 's/^/    /'
  if sudo -u postgres psql -X -At -c "select 1 from pg_stat_statements limit 1" >/dev/null 2>&1; then
    echo "    top 8 consultas por tempo total (desde o último reset):"
    sudo -u postgres psql -X -At -F' | ' -c "select round(total_exec_time/1000)||'s', calls, round(mean_exec_time)||'ms', left(regexp_replace(query,'\s+',' ','g'),110) from pg_stat_statements order by total_exec_time desc limit 8" | sed 's/^/      /'
  else
    echo "    (pg_stat_statements desligado — ver infra/observabilidade/README.md, passo 5)"
  fi
fi

echo "[6] containers agora:"
docker stats --no-stream --format '    {{.Name}} cpu {{.CPUPerc}} mem {{.MemUsage}}' 2>/dev/null
REMOTO
done
echo
echo "=== fim ==="
