# Inventário para alta disponibilidade — o que depende da Supabase

Levantamento do que precisa de substituto **antes** de o banco primário sair da
Supabase. Sem isto, o corte descobriria as dependências no pior momento.

- Data: 05/10/2026
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

### 2.1 `pg_net` — 8 chamadas, 7 migrations · **bloqueador**

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

**Substituto proposto:** tabela de fila + o `worker/` que a empresa já mantém.
O gatilho passa a inserir na fila em vez de fazer HTTP; o worker consome. É
melhor desenho mesmo ficando na Supabase: HTTP dentro de transação de banco
perde a chamada se a transação volta atrás.

**Autenticação:** as chamadas pegam a chave do Vault, não hardcoded — padrão
correto. Os 5 JWT literais encontrados em migrations são chave **`anon`**, que é
pública por natureza. **Não há vazamento de `service_role` no repo** (conferido
em 05/10/2026).

### 2.2 Supabase Vault — guarda os segredos que o banco usa

`vault.decrypted_secrets` guarda ao menos `anon_key` e `whatsapp_tick_secret`.
Fora da Supabase não existe. Substituto: segredo no ambiente do worker, uma vez
que o HTTP sai do banco (ver 2.1) e o Vault deixa de ser necessário.

### 2.3 `pg_cron` — **inventário pendente, precisa do Eduardo**

A extensão é criada por migration, mas **não existe um único `cron.schedule` no
repo** — os agendamentos foram criados à mão no SQL Editor. Ou seja: *não
sabemos quantos são nem o que fazem.*

Pelas Edge Functions `-tick` acima, são pelo menos 5. Se um agendamento sumir no
corte, uma automação para de rodar **sem erro visível**.

> **Não dá para levantar isto por workflow:** o repositório é público, e comando
> de `cron.job` costuma embutir chave no cabeçalho. O log do Actions ficaria
> público com a chave dentro. Por isso a consulta é rodada à mão — ver seção 5.

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

1. **Promover a réplica de hoje para escrita quebraria.** Os gatilhos de
   conclusão de chamado e do canal de denúncia chamam `net.http_post`, e
   `pg_net` **não está instalado na réplica**. Hoje não aparece porque ela
   recusa escrita.
2. **As automações de fundo não rodam na réplica** (dependem de `pg_cron`, que
   ela não tem). Numa queda longa, cobrança, plano de ação, retomada de WhatsApp
   e alertas de denúncia ficam parados.
3. **A URL das Edge Functions está fixa no SQL**, apontando para produção. Se os
   gatilhos disparassem na réplica, chamariam a produção.

---

## 4. O que falta inventariar

| Item | Por que importa |
|---|---|
| `cron.job` da produção | automação que desaparece sem erro |
| Segredos do Vault | o que o banco precisa saber |
| Buckets e políticas do Storage | 49 baldes, 7 públicos |
| Templates de e-mail do Auth | texto que o usuário recebe |
| Webhooks criados pela interface | não estão no repo |
| Extensões instaladas à mão | idem |

---

## 5. A consulta que só você pode rodar

No painel da Supabase → **SQL Editor** → cole e execute:

```sql
select jobid, schedule, jobname, active,
       left(command, 120) as inicio_do_comando,
       command ilike '%bearer%' or command ilike '%apikey%' as tem_credencial
  from cron.job
 order by jobid;
```

```sql
select name, description from vault.secrets order by name;
```

**Ao me mandar o resultado:** a coluna `inicio_do_comando` pode conter chave. Se
`tem_credencial` vier `true` em alguma linha, **troque a chave por `<REDIGIDO>`**
antes de colar aqui. O que eu preciso saber é *o quê* roda e *quando* — não a
credencial. A segunda consulta devolve só nome e descrição, nunca o segredo.

---

## 6. Sequência proposta

1. Inventário fechado (seções 4 e 5)
2. `pg_net` → fila + worker, aplicado **na produção atual** e validado lá
3. Decidir Realtime: serviço próprio ou polling nas duas telas
4. Provisionar o Postgres com HA e replicar continuamente
5. **Ensaio do corte**, em horário não comercial, com plano de volta atrás
6. Corte

Os passos 2 e 3 valem por si: reduzem dependência da Supabase **sem** nenhum
corte, e são reversíveis.
