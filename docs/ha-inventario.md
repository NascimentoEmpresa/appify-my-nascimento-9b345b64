# Inventário para alta disponibilidade — o que depende da Supabase

Levantamento do que precisa de substituto **antes** de o banco primário sair da
Supabase. Sem isto, o corte descobriria as dependências no pior momento.

- Data: 05/10/2026 · **inventário fechado em 06/10/2026**
- Objetivo: failover **automático com escrita** (RPO ≈ 0), que exige controlar
  o commit do primário — impossível na Supabase hospedada
- Estado hoje: failover automático **de leitura**, atraso de até ~3h30

---

## 1. Já provado fora da Supabase

Isto não é teoria: roda hoje em `erp-failover.onrender.com`, com login real,
permissões idênticas e anexos servidos.

| Componente | Onde roda |
|---|---|
| Postgres 17 | container da Render |
| GoTrue (login) | idem |
| PostgREST (API) | idem |
| Storage (anexos) | idem, disco persistente |
| Edge Runtime (Deno) | idem |
| nginx (gateway, CORS) | idem |

---

## 2. O que é exclusivo da Supabase e precisa de substituto

### 2.1 `pg_net` · **RESOLVIDO EM PRODUÇÃO** ~~bloqueador~~

Extensão da Supabase para HTTP de dentro do Postgres. **Não existe** em RDS,
Cloud SQL, Neon ou Postgres puro. Todas as chamadas apontam para Edge Functions
com **URL fixa do projeto de produção**:

| Origem | Edge Function chamada | Disparo |
|---|---|---|
| `20260520143839_…` | `sla-escalonamento-tick` | pg_cron |
| `20260710000004_cobranca_motor_cron` | `regua-cobranca-tick` | pg_cron |
| `20260730000001_plano_acao_cron…` | `plano-acao-marcar-atrasadas` | pg_cron |
| `20260819000001_whatsapp_retomada` | `whatsapp-retomada-tick` | pg_cron |
| `20260914000001_novidades_ia_chamados` | `novidade-ia-chamado` | **gatilho** (1) |
| `20260914000004_canal_denuncia_alertas` | `comite-etica-alertas-tick` | pg_cron |
| `20260925000002_canal_denuncia_aviso_email` | *(e-mail ao comitê)* | **gatilho** (2) |

**Feito em 06/10/2026:** `20261006000001_fila_http_substitui_pg_net.sql` +
`worker/src/filaHttp.js`. O gatilho grava em `public.fila_http` na mesma
transação do dado; o worker entrega, com retentativa e alerta. Testado no
esquema real da réplica: o gatilho do Canal de Ética enfileirou
`comite-etica-nova-denuncia` com o `denuncia_id` certo, e o `ROLLBACK`
desfez a denúncia **e** a intenção juntas — a propriedade que o `pg_net`
não tinha. **Aplicado na produção em 06/10/2026** e conferido no banco:
`pg_get_functiondef` não encontra mais `net.http%` em **nenhuma** função, e
**nenhum** dos 5 agendamentos cita `net.http%`. A extensão `pg_net` segue
instalada, mas não é mais usada por nada — pode ser removida no corte sem
substituto.

**Correção ao que este documento dizia antes:** a estrutura não era a que o
repo sugeria. As 5 chamadas `-tick` não estão em função nenhuma — vivem
**dentro do comando do `cron.schedule`**, e os horários estão no repo
(`0 * * * *`, `0 6 * * *`, `*/5 * * * *`, `0 8 * * 1-5`). Só 2 funções de
gatilho tinham `net.http_post`.
O gatilho passa a inserir na fila em vez de fazer HTTP; o worker consome. É
melhor desenho mesmo ficando na Supabase: HTTP dentro de transação de banco
perde a chamada se a transação volta atrás.

**Autenticação:** as chamadas pegam a chave do Vault, não hardcoded — padrão
correto. Os 5 JWT literais encontrados em migrations são chave **`anon`**, que é
pública por natureza. **Não há vazamento de `service_role` no repo** (conferido
em 05/10/2026).

### 2.2 Vault e `app_config_runtime` — **eu havia errado aqui**

O documento dizia que as chamadas pegavam a chave do Vault. Conferido no
banco em 06/10/2026, o quadro real é outro:

- **1** função usa `vault.decrypted_secrets` (não todas);
- a versão real de `canal_denuncia_avisa_comite` lê de
  **`public.app_config_runtime`** (chaves `anon_key` e `functions_url`) —
  ou seja, para ela a URL **não** era fixa. Alguém já estava migrando do
  Vault para tabela de config;
- o schema `vault` **não existe na réplica** — então essa função falharia lá
  mesmo se `pg_net` existisse;
- `chamado_concluido_gera_novidade` tem a URL **e** a chave `anon` literais
  no corpo. A chave é pública por natureza; a URL fixa, não.

Com a fila (2.1), o banco deixa de precisar de Vault **e** de
`app_config_runtime` para este caminho: quem guarda chave e endereço é o
worker, no ambiente dele. `WHATSAPP_TICK_SECRET` precisa ser copiado do
Vault para `worker/.env` — é o único segredo que muda de casa.

### 2.3 `pg_cron` — **inventariado em 06/10/2026**

A extensão é criada por migration, e os agendamentos foram criados à mão no SQL
Editor — não existe `cron.schedule` no repo. O levantamento foi feito por `psql`
direto na produção, não por workflow: o repositório é público e o log do Actions
ficaria público também.

**São exatamente 5, todos ativos, nenhum extra escondido:**

| jobid | horário | nome | comando |
|---|---|---|---|
| 16 | `0 * * * *` | `sla-escalonamento-tick` | `SELECT public.enfileirar_tick('sla-escalonamento-tick')` |
| 17 | `0 * * * *` | `regua-cobranca-tick` | `SELECT public.enfileirar_tick('regua-cobranca-tick')` |
| 18 | `0 6 * * *` | `plano-acao-marcar-atrasadas` | `SELECT public.enfileirar_tick('plano-acao-marcar-atrasadas')` |
| 19 | `*/5 * * * *` | `whatsapp-retomada-tick` | `SELECT public.enfileirar_tick('whatsapp-retomada-tick')` |
| 20 | `0 8 * * 1-5` | `comite-etica-alertas` | `SELECT public.enfileirar_tick('comite-etica-alertas-tick')` |

Três conclusões:

1. **O medo não se confirmou.** Não havia agendamento desconhecido criado à mão
   que fosse desaparecer no corte sem erro visível. Os 5 são os 5 do repo.
2. **O comando não embute mais credencial nenhuma** — depois da fila, o cron só
   chama uma função local. Antes, embutia o cabeçalho `Authorization`.
3. **Substituto do `pg_cron` fora da Supabase:** como todos os 5 agora são
   `SELECT public.enfileirar_tick('<destino>')`, dá para tirar o agendamento do
   banco e passar para o `worker/`, que já roda em laço de 60s. O banco deixa
   de precisar de `pg_cron` — some um item da lista de dependências, em vez de
   precisar de substituto.

### 2.4 Realtime — 2 telas

`postgres_changes` em:

- `src/components/conferencia-ponto/PainelConferenciaPonto.tsx`
- `src/hooks/useSupCatalogo.ts`

O container de hoje **não roda** o serviço de Realtime. Consequência atual: em
contingência essas duas telas não atualizam sozinhas (continuam funcionando ao
recarregar). Substituto: subir o serviço Realtime, ou trocar as duas por
*polling* — para duas telas, pode ser mais barato que manter um serviço.

### 2.5 Auth — administração e e-mail

Seis funções usam `auth.admin` (criar, excluir, resetar senha, revogar sessão,
trocar e-mail, verificar vínculo). O GoTrue próprio suporta tudo isso.

**O que falta:** SMTP. Hoje a Supabase manda os e-mails de recuperação de senha.
Fora dela, o GoTrue precisa de SMTP configurado — a empresa já envia e-mail pelo
`worker/`, então o remetente existe.

### 2.6 Edge Functions — 59 no repo, 30 chamadas pelo front, 6 pelo banco

O Edge Runtime já roda no container. O que precisa de atenção é o **deploy** e
os **segredos** de cada uma (chaves de WhatsApp, IA, Correios).

### 2.7 Studio

A interface de administração da Supabase não vem junto. Substituto: `psql`,
DBeaver ou pgAdmin.

---

## 3. Achados que valem independente do corte

1. ~~**Promover a réplica de hoje para escrita quebraria.**~~ **Corrigido em
   06/10/2026.** Os gatilhos chamavam `net.http_post`, e `pg_net` não existe
   na réplica. Agora gravam em `public.fila_http`, que é SQL comum e funciona
   em qualquer Postgres — as duas migrations já foram aplicadas na réplica e o
   dedupe foi provado lá. O que ainda impede escrita na réplica é só a trava
   de leitura (`REVOKE`), de propósito.
1b. **Mas o entregador não roda na réplica.** O `worker/` aponta para a
   produção. Em contingência a fila da réplica encheria sem ninguém consumir
   — item da Fase 5, não de hoje.
2. **As automações de fundo não rodam na réplica** (dependem de `pg_cron`, que
   ela não tem). Numa queda longa, cobrança, plano de ação, retomada de WhatsApp
   e alertas de denúncia ficam parados. **Passar os 5 ticks para o worker
   resolve isto de graça** (ver 2.3 e passo 4 da seção 5).
3. **A URL das Edge Functions estava fixa no SQL**, apontando para produção.
   Com a fila, quem decide a URL é o worker, pelo `SUPABASE_URL` do ambiente
   dele — nunca mais vem de dentro do banco.

---

## 4. Inventário — fechado

Levantado por `psql` direto na produção em 06/10/2026.

| Item | Resultado |
|---|---|
| `cron.job` | ✅ 5 agendamentos, todos `enfileirar_tick` — ver 2.3 |
| Funções com `pg_net` | ✅ **zero** |
| Webhooks criados pelo painel | ✅ **zero** (nenhum trigger `supabase_functions`) |
| Segredos do Vault | ✅ 5, listados abaixo |
| Extensões instaladas | ✅ 9, listadas abaixo |
| Buckets do Storage | ✅ 49, dos quais 7 públicos |
| Roles fora do padrão | ✅ 3, todas internas da Supabase |
| Tamanho do banco | ✅ **1714 MB** |
| Templates de e-mail do Auth | ⬜ só no painel, não estão no banco — **não é bloqueador** |

### 4.1 Segredos do Vault (nomes, nunca os valores)

| Nome | Para quê | Precisa mudar de casa? |
|---|---|---|
| `anon_key` | os crons usavam para chamar Edge Function | **não** — a fila eliminou o uso |
| `whatsapp_tick_secret` | autoriza disparar `whatsapp-retomada-tick` | **já copiado** para `worker/.env` |
| `cs_api_key` | API do Contato Seguro (Canal de Ética) | **sim** → ambiente do worker/Edge |
| `cs_api_secret` | idem | **sim** |
| `cs_base_url` | idem (endereço, não segredo) | **sim** |

Ou seja: o `supabase_vault` tem 5 entradas — 2 já resolvidas e 3 do Canal de
Ética que precisam ir para o ambiente de quem chama, no corte.

### 4.2 Extensões

`btree_gist`, `pg_stat_statements`, `pg_trgm`, `pgcrypto`, `plpgsql`,
`uuid-ossp` — **existem em qualquer Postgres**, nenhum problema.

| Extensão | Destino no corte |
|---|---|
| `pg_cron` 1.6.4 | some — vira laço do worker (ver 2.3) |
| `pg_net` 0.20.0 | some — já não é usada por nada (ver 2.1) |
| `supabase_vault` 0.3.1 | some — os 3 segredos do Canal de Ética vão para o ambiente do worker |

**Nenhuma extensão exige substituto.** Este era o risco real do corte, e ele
não existe mais.

### 4.3 O tamanho muda o plano

**1714 MB.** Isso é pequeno: cabe no plano de entrada de qualquer Postgres
gerenciado, e um `pg_dump`/restore completo leva minutos, não horas. Duas
consequências práticas:

- o ensaio do corte pode ser repetido quantas vezes quisermos, barato;
- a janela de corte é curta, o que reduz o risco da Fase 5.

---

## 5. Sequência proposta

1. ✅ **Inventário fechado** (seção 4) — 06/10/2026
2. ✅ **`pg_net` → fila + worker**, aplicado na produção e validado lá:
   fila zerada, 5 crons usando `enfileirar_tick`, 0 funções com `net.http`
3. ⬜ **Decidir Realtime**: serviço próprio ou *polling* nas duas telas
   (recomendação: polling — duas telas não pagam um serviço inteiro)
4. ⬜ **Tirar o agendamento do banco**: os 5 ticks viram laço do worker, e o
   `pg_cron` deixa de ser dependência (ver 2.3)
5. ⬜ **Provisionar o Postgres com HA** e replicar continuamente
   — *aqui mora a decisão de custo; é a próxima que depende do Eduardo*
6. ⬜ **Ensaio do corte**, repetível, sem impacto em produção
7. ⬜ **Corte**, em horário não comercial, com plano de volta atrás

Os passos 3 e 4 valem por si: reduzem dependência da Supabase **sem** nenhum
corte, e são reversíveis.
