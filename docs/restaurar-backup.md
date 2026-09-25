# Como restaurar o backup do banco

> Backup que ninguém sabe restaurar não é backup. Este documento existe para
> ser lido no pior dia, não no melhor. Os passos abaixo foram **executados de
> verdade em 24/09/2026** — não são teoria.

---

## Antes de restaurar: é isto mesmo que você precisa?

Restaurar é caro: leva dezenas de minutos e **faz perder tudo que aconteceu
depois do ponto copiado**. Na maioria das quedas, não é o que resolve.

| Sintoma | O que fazer |
|---|---|
| Sistema lento, travando, 522 | **Reiniciar o projeto.** `Settings → General → Restart project`. Foi o que resolveu em 23/09, em 30 segundos |
| Alguém apagou uma tabela por engano | Restaurar — mas prefira o **PITR** ou a cópia diária da Supabase, que são mais recentes |
| Migration corrompeu dados | Idem acima |
| **A conta/projeto Supabase foi perdido** | **É aqui que este backup entra.** É o único que sobrevive a isso |

---

## Onde está o backup

GitHub → **Actions** → workflow **"Backup do banco"** → abra a execução mais
recente → seção **Artifacts** → baixe `backup-AAAAMMDD-HHMMSS.dump`.

Roda automaticamente às **06:00 e 18:00** (horário de Brasília). Guarda **14
dias**. Para gerar um agora: botão **"Run workflow"** na mesma tela.

---

## O que ele contém — e o que NÃO contém

**Contém:** os schemas `public`, `espelho`, `auth` e `storage` — tabelas,
dados, funções, índices e políticas de RLS. Em 24/09 eram **631 tabelas com
dados** e **8.093 objetos**.

**NÃO contém: os arquivos do Storage.** Anexos, fotos de crachá e XMLs ficam
fora do banco; ele guarda só os metadados. Restaurar devolve *a lista* de
arquivos, não os arquivos. É a mesma limitação que a própria Supabase avisa na
tela de backups dela.

> Se o objetivo for sobreviver à perda total da conta, os arquivos do Storage
> precisam de uma cópia própria. Isso ainda **não existe** e é o próximo item.

---

## Restaurar para um projeto Supabase novo

É o caminho de desastre real.

**1.** Crie um projeto novo no painel da Supabase, mesma região (`sa-east-1`).

**2.** Pegue a senha e o host do projeto novo em
`Project Settings → Database → Connection string`.

**3.** No terminal, com o `.dump` baixado na pasta atual:

```bash
pg_restore \
  --host=<host-do-projeto-novo> \
  --port=5432 \
  --username=postgres.<ref-do-projeto-novo> \
  --dbname=postgres \
  --no-owner \
  --no-privileges \
  --jobs=4 \
  backup-AAAAMMDD-HHMMSS.dump
```

**4.** Vão aparecer **muitos erros** — e a maioria é esperada. Leia a seção
seguinte antes de se assustar.

**5.** Aponte a aplicação para o projeto novo: trocar `VITE_SUPABASE_URL` e
`VITE_SUPABASE_ANON_KEY` no `.env`, e as mesmas variáveis no `worker/.env`.

---

## Os erros que são normais

Na restauração de teste de 24/09 apareceram **1.373 erros**. Quase todos:

```
pg_restore: error: ... role "authenticated" does not exist
pg_restore: error: ... role "anon" does not exist
```

São os papéis internos da Supabase (`authenticated`, `anon`, `service_role`),
usados nas permissões e nas políticas de RLS. Num Postgres comum eles não
existem — **num projeto Supabase novo, existem**, e esses erros não aparecem.

**Como saber se deu certo de verdade:** não conte erros. **Confira as
contagens.** Foi assim que a restauração de 24/09 foi validada:

```sql
SELECT
  (SELECT count(*) FROM public.sup_pedido)      AS pedidos,
  (SELECT count(*) FROM public.malote_despesa)  AS despesas,
  (SELECT count(*) FROM public."EMPREGADOS")    AS empregados,
  (SELECT count(*) FROM public.profiles)        AS perfis,
  (SELECT count(*) FROM espelho."BiMarcacoes")  AS batidas,
  (SELECT count(*) FROM auth.users)             AS usuarios;
```

Rode no banco restaurado **e** no de origem, se ele ainda existir. Os números
têm que bater.

Em 24/09 bateram exatamente: `2.247 / 1.118 / 13.355 / 155 / 3.748.805 / 155`.

---

## Testar sem arriscar nada (recomendado a cada trimestre)

Dá para restaurar num Postgres descartável na sua máquina, sem tocar em
produção nem no seu Postgres local. Foi assim que este procedimento foi
validado:

```bash
# 1. Criar um cluster temporario numa porta livre
initdb -D /tmp/cluster-teste -U postgres --auth=trust --encoding=UTF8
pg_ctl -D /tmp/cluster-teste -o "-p 55432" start

# 2. Restaurar dentro dele
psql -h localhost -p 55432 -U postgres -d postgres -c "CREATE DATABASE restaurado;"
pg_restore -h localhost -p 55432 -U postgres -d restaurado \
  --no-owner --no-privileges --jobs=4 backup-AAAAMMDD-HHMMSS.dump

# 3. Conferir as contagens (SQL da secao anterior)

# 4. Destruir
pg_ctl -D /tmp/cluster-teste stop -m fast
rm -rf /tmp/cluster-teste
```

No Windows, os binários ficam em `C:\Program Files\PostgreSQL\18\bin\`.

---

## Quanto tempo leva

Medido em 24/09/2026, banco de 1,61 GB:

| Etapa | Tempo |
|---|---|
| Gerar o backup | **1 min 14 s** |
| Restaurar (`--jobs=4`) | **40 s** |
| Arquivo gerado | **106,4 MB** |

O tempo total até o sistema voltar no ar é maior: somar criar o projeto novo,
trocar as variáveis e publicar o frontend. **Conte com algumas horas**, não com
minutos.

---

## Impacto no banco de produção enquanto copia

Também medido, com o backup rodando:

| Indicador | Durante a cópia |
|---|---|
| Conexões usadas | **1** de 90 |
| Bloqueios de escrita | **0** — `pg_dump` usa snapshot, não trava ninguém |
| Cache hit | 99,99% → **99,97%** |
| Memória / swap | sem mudança perceptível |

**Ninguém precisa sair do sistema para o backup rodar.** É por isso que ele
pode acontecer às 18:00, com gente trabalhando.
