# Plano de aborto e rollback da migração

Para ser lido **antes** da janela, impresso ou aberto numa aba separada. Se
você está lendo isto durante um incidente, vá direto para
[§1 — Emergência](#1-emergência-a-produção-está-caindo).

Premissa que vale para tudo abaixo: **enquanto não existir um slot de
replicação no Supabase, a migração não tem como derrubar a produção.** Dump de
schema, restore e correções acontecem todos do nosso lado.

---

## 1. Emergência: a produção está caindo

O único mecanismo pelo qual esta migração derruba o Supabase é o **slot de
replicação segurando WAL até o disco encher**. Sintomas: escrita falhando,
instância em modo somente-leitura, alerta de disco.

### Corte imediato (roda no Supabase, ~5 segundos)

```sql
-- 1. derruba o processo que segura o slot
SELECT pg_terminate_backend(active_pid)
  FROM pg_replication_slots
 WHERE slot_name = 'erp_migracao' AND active_pid IS NOT NULL;

-- 2. apaga o slot: o WAL retido é liberado no próximo checkpoint
SELECT pg_drop_replication_slot('erp_migracao');
```

Depois disso o Supabase se recupera sozinho. **Não espere autorização para
rodar isso** — apagar um slot não perde dado nenhum da produção; ele só
interrompe a nossa cópia, que é descartável e refazível.

### Se o `DROP SUBSCRIPTION` travar do nosso lado

`DROP SUBSCRIPTION` tenta apagar o slot no Supabase e **falha se não conseguir
falar com ele** — exatamente o que acontece quando o Supabase já está
degradado. A saída é desatar os dois lados:

```sql
-- no banco novo (banco1/banco2)
ALTER SUBSCRIPTION erp_migracao DISABLE;
ALTER SUBSCRIPTION erp_migracao SET (slot_name = NONE);
DROP SUBSCRIPTION erp_migracao;
```

E então apagar o slot no Supabase pelo bloco acima.

---

## 2. Vigia durante a migração

Rodar **no Supabase**, a cada poucos minutos, durante toda a cópia inicial:

```sql
SELECT slot_name,
       active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn))
         AS wal_retido
  FROM pg_replication_slots;
```

### Critérios de aborto — decididos agora, não na hora

| Observação | Ação |
|---|---|
| `wal_retido` passa de **2 GB** | avisar, acompanhar de perto |
| `wal_retido` passa de **5 GB** | **abortar** pelo §1 |
| `wal_retido` cresce 10 min seguidos sem recuar | **abortar** |
| `active = false` por mais de 5 min | **abortar** — assinatura travada |
| Usuário relatando lentidão para salvar | **abortar** e investigar depois |

Combinar o número **antes** evita a pior conversa possível: discutir se aborta
enquanto o disco enche.

---

## 3. Rollback por fase

### Fase A — dump do schema
Leitura pura. **Nada a desfazer.**

### Fase B — restaurar e corrigir no cluster novo
Acontece só no nosso lado. Para recomeçar do zero:

```sql
DROP DATABASE IF EXISTS erp; CREATE DATABASE erp;
```

Produção não é tocada.

### Fase C — `CREATE PUBLICATION` no Supabase
Primeira coisa que toca a produção. Risco baixo: lock breve por tabela ao
adicionar.

```sql
DROP PUBLICATION erp_migracao;   -- instantâneo, não deixa resíduo
```

⚠️ **Nunca** mexer em `supabase_realtime` nem
`supabase_realtime_messages_publication` — são do Supabase e o ERP depende
delas.

### Fase D — assinatura e cópia inicial (**a fase perigosa**)
Rollback: §1. Aborto não perde nada além do tempo da cópia.

### Fase E — a virada
Rollback descrito em §4.

---

## 4. Rollback da virada

A virada é a única fase em que voltar atrás **custa dados**, porque depois dela
as gravações acontecem no banco novo e o Supabase deixa de recebê-las.

### A regra que torna o rollback trivial

**Congelar a escrita durante a troca.** Sequência:

1. Pôr o ERP em manutenção (sem escrita).
2. Esperar `wal_retido` chegar a zero — garante que o banco novo tem tudo.
3. Trocar a aplicação para o banco novo.
4. Conferir a lista de §5.
5. Liberar a escrita.

Enquanto a escrita estiver congelada, **voltar atrás é apontar de volta e
liberar** — nenhuma transação fica órfã, porque nenhuma foi feita. É por isso
que a janela vale a pena.

### Se o problema aparecer depois da escrita liberada

Aí existe dado novo só no banco novo. Três saídas, em ordem de preferência:

1. **Corrigir adiante.** Se o problema é uma policy faltando ou uma função
   quebrada, consertar no banco novo é mais rápido e mais seguro do que voltar.
2. **Voltar e reaplicar.** Apontar para o Supabase e trazer as linhas do
   período com `pg_dump --data-only` filtrado pelas tabelas afetadas.
3. **Voltar e aceitar a perda.** Só se a janela foi curta e o volume é
   conferível linha a linha.

**A decisão de qual usar é do Eduardo e do gerente, não de quem está digitando
no console às 2 da manhã.** Combinar antes.

### Dependência que não é do banco

A aplicação não fala Postgres direto: fala com a **API do Supabase** (PostgREST
para dados, GoTrue para login). Virar o banco exige essa camada rodando do
nosso lado. Enquanto ela não estiver pronta e ensaiada, **a virada não
acontece** — o cluster fica recebendo replicação e esperando. Ver
`failover_replica_container_provado`, que já registra as duas armadilhas dessa
camada.

---

## 5. Conferência obrigatória antes de liberar a escrita

Qualquer item que falhe = voltar atrás, sem discussão.

```sql
-- no banco novo
SELECT count(*) FROM pg_policies WHERE schemaname='public';  -- TEM que ser 1416
SELECT count(*) FROM pg_tables   WHERE schemaname='public';  -- TEM que ser 647
```

| Verificação | Critério |
|---|---|
| Políticas de RLS | **1.416** — qualquer número menor significa acesso aberto |
| Tabelas em `public` | **647** |
| Contagem de linhas das 10 maiores tabelas | idêntica ao Supabase |
| `auth.uid()` responde | retorna o usuário da sessão, não erro |
| Login no ERP | um usuário comum entra |
| Acesso negado | um usuário **sem** permissão continua sem enxergar a tela |
| Gravação | criar e salvar um registro de teste |
| Cluster | `patronictl list` com líder e réplica `streaming`, lag 0 |

O teste de **acesso negado** é o mais importante da lista: ele é o que
detecta a falha silenciosa das 1.416 políticas. Um sistema que deixa todo mundo
entrar parece funcionar perfeitamente.
