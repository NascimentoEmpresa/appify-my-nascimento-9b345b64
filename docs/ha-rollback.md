# Rollback da virada — uma página, para ler com pressa

> **A regra que manda em tudo:** o ERP **não fica fora do ar em momento
> nenhum**. O congelamento não é tela de manutenção — o sistema continua
> abrindo, consultando e navegando; ele só recusa **salvar**. E o botão de
> volta devolve o salvamento sem reiniciar nada.

## O botão de volta

```bash
bash infra/ha/rollback-virada.sh --descongelar
```

Leva segundos. **Enquanto o `.env` da `main` não tiver sido trocado, essa
linha sozinha já é o rollback completo** — tudo ainda aponta para a Supabase.

## Onde estamos na escada (cada degrau tem o seu desfazer)

| # | Passo | Desfazer | Custo de voltar |
|---|---|---|---|
| 1 | schema + recópia no cluster | nada a fazer | **zero** — não toca na produção |
| 2 | **congelar a escrita** (`--congelar`) | `--descongelar` | segundos |
| 3 | auth/storage, sequences, anexos | nada a fazer | zero — só escreve no cluster |
| 4 | `--abrir-cluster` | `--fechar-cluster` | segundos |
| 5 | **`.env` da `main` → cluster** | `git revert` + push | ~2 min (build do Lovable) |
| 6 | `worker/.env` → cluster | devolver a URL e reiniciar | segundos |
| 7 | cron ligado no cluster | `--ligar` só depois; para desligar, `update cron.job set active=false` | segundos |
| 8 | webhook da Meta / redirect do Discord | repor a URL antiga no painel | minutos |
| 9 | **primeiro salvamento de usuário no cluster** | **ponto sem volta** | ver abaixo |

**O ponto sem volta é o degrau 9, não o 5.** Entre o 5 e o 9 ainda dá para
voltar sem perder nada; depois dele, voltar significa perder o que foi salvo no
cluster (ou copiar de volta à mão).

## Rollback completo, se já passou do degrau 5

Na ordem, de cima para baixo:

```bash
# 1. a producao volta a salvar  (o mais importante, faca primeiro)
bash infra/ha/rollback-virada.sh --descongelar

# 2. o frontend volta para a Supabase
git revert <commit que mudou o .env> && git push origin main
#    o Lovable reconstroi sozinho a partir da main (~2 min)

# 3. o worker volta
#    worker/.env: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY de volta aos da Supabase
#    e reiniciar o worker

# 4. o cluster volta a ser copia, para nao receber escrita por engano
bash infra/ha/rollback-virada.sh --fechar-cluster

# 5. o cron do cluster para
ssh -p 8443 root@216.238.120.171 \
  "PGPASSWORD=\$(grep -m1 '^PG_SENHA_SUPER=' /opt/erp/infra/failover/.env | cut -d= -f2-) \
   psql -h 127.0.0.1 -p 5000 -U postgres -d postgres -c 'update cron.job set active=false'"

# 6. se o webhook da Meta ja tiver sido trocado, repor:
#    https://fwmzeaztjxrxxzxzxmgc.supabase.co/functions/v1/whatsapp-webhook
```

## Como saber, a qualquer momento, onde estamos

```bash
bash infra/ha/rollback-virada.sh --conferir
```

Ele diz, dos dois lados, quantas permissões de escrita existem (0 = congelado),
quantas linhas tem o `CHAMADO_SISTEMA`, para onde o `.env` e o `worker/.env`
apontam, e se o `app.grpnascimento.com.br` responde 200.

## A fotografia do antes (16/10/2026, 20h27)

```
PRODUCAO   3712 permissoes de escrita   680 tabelas   CHAMADO_SISTEMA 649
CLUSTER       0 permissoes (fechado)    661 tabelas   CHAMADO_SISTEMA 0
.env da main -> https://fwmzeaztjxrxxzxzxmgc.supabase.co
worker/.env  -> https://fwmzeaztjxrxxzxzxmgc.supabase.co
commit da main: 04d1754d
app.grpnascimento.com.br: 200
```

**É para esses números que o rollback volta.** `3712` é o alvo do
`--descongelar`: se depois dele a produção estiver com `0`, o rollback não
terminou.

## O que NÃO é rollback

- **Desligar o cluster.** Não resolve nada e tira a rede de proteção.
- **Mexer nas funções de RLS.** O que congela é o `GRANT`, nunca a política —
  mexer em política no meio de uma virada é como trocar o pneu andando.
- **Restaurar backup da produção.** Nada da virada escreve na produção além do
  `REVOKE`/`GRANT` de permissão. Não há dado a restaurar.
