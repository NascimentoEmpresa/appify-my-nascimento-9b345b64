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
recente → seção **Artifacts** → baixe `backup-AAAAMMDD-HHMMSS.dump.gpg`.

Roda automaticamente às **06:00 e 18:00** (horário de Brasília). Guarda **14
dias**. Para gerar um agora: botão **"Run workflow"** na mesma tela.

### E existe uma segunda cópia, no servidor da empresa

Desde **29/09/2026**, uma cópia diária também vai para:

```
S:\1- SERVIDOR\Analise de dados\Grupo Nascimento\Analise de Sistemas\Eduardo\BACKUP-BANCO
```

É lá que estão os backups **com mais de 14 dias** — o GitHub apaga, o servidor
não. A retenção é 30 diários, 12 semanais e 12 mensais, ou seja, dá para voltar
cerca de um ano.

Quem faz a cópia é `scripts/copiar-backup-para-servidor.ps1`, por tarefa agendada
na máquina do Eduardo. O runner do GitHub não alcança `192.168.100.60` — é rede
interna —, então a cópia tem de ser puxada de dentro da empresa.

**Duas limitações que precisam estar claras:**

1. Enquanto rodar na máquina do Eduardo, a cópia só acontece com ela ligada. O
   script avisa por DM se o backup mais recente tiver 3 dias ou mais.
2. `S:` é **um** servidor, sem imutabilidade. Um ransomware na rede da empresa
   alcança ele. Isto é uma terceira localização sob controle diferente — Supabase,
   GitHub, servidor interno —, **não é um cofre**. Cópia à prova de exclusão
   (Object Lock em nuvem) continua sendo o próximo passo.

---

## Antes de restaurar: descriptografar

> **Desde 28/09/2026 o arquivo é criptografado.** Ele termina em `.dump.gpg` e
> o `pg_restore` **não** abre ele direto — você precisa descriptografar antes.

O motivo: este repositório é **público**, e artifact de repositório público é
baixável por qualquer pessoa com conta no GitHub. O dump tem o schema `auth`
(155 usuários e os hashes de senha), `EMPREGADOS` (13.355 pessoas, com CPF),
malote e pagamentos. Até 28/09/2026 ele subia em texto claro; isso foi
corrigido e o artefato exposto foi apagado no mesmo dia.

**Só a chave privada do Eduardo abre o arquivo.** O GitHub tem apenas a chave
pública (`.github/backup-chave-publica.asc`) — ele consegue *criar* backup e
não consegue *abrir* nenhum, de propósito.

```bash
gpg --decrypt --output backup-AAAAMMDD-HHMMSS.dump backup-AAAAMMDD-HHMMSS.dump.gpg
```

Se a chave estiver protegida por senha, ele vai pedir. Daí em diante o arquivo
`.dump` é igual ao de sempre e todos os passos abaixo valem sem mudança.

### ⚠️ Se a chave privada for perdida, TODOS os backups viram lixo

Não existe recuperação, não existe suporte para acionar, não existe chave
mestra. A chave privada e a senha dela precisam estar em **três lugares**:

1. Gerenciador de senhas
2. Mídia externa guardada fora da mesa (pendrive, HD)
3. Impressa em papel, no cofre

Identificação da chave em uso (criada em 28/09/2026):

```text
pub   rsa4096/23595EC2   53B1F5DE1075BAA392D1AD1D346F5F8723595EC2  [C]
sub   rsa4096/A3F1159F                                             [E]
uid   Eduardo Monteiro (backup ERP) <eduardojeielmonteiro1802@gmail.com>
```

Para conferir que a sua cópia da chave privada é a certa **e que ela realmente
descriptografa** — faça isto a cada trimestre, junto com o teste de restauração:

```bash
gpg --list-secret-keys "backup ERP"     # tem que mostrar a subchave [E]
```

Uma cópia da chave privada exportada **antes** da subchave `[E]` existir parece
válida e não descriptografa nada. Se a sua cópia não listar a linha `ssb`,
ela não serve.

---

## O que ele contém — e o que NÃO contém

**Contém:** os schemas `public`, `espelho`, `auth` e `storage` — tabelas,
dados, funções, índices e políticas de RLS. Em 24/09 eram **631 tabelas com
dados** e **8.093 objetos**; em 28/09, **634 tabelas**.

**NÃO contém: os arquivos do Storage.** Anexos, fotos de crachá e XMLs ficam
fora do banco; ele guarda só os metadados. Restaurar devolve *a lista* de
arquivos, não os arquivos. É a mesma limitação que a própria Supabase avisa na
tela de backups dela.

Medido em produção em **28/09/2026**, para dimensionar o buraco:

| | |
|---|---|
| Arquivos no Storage | **7.380** |
| Volume | **4.465 MB** — quase **3×** o tamanho do banco (1,61 GB) |
| Maior arquivo | 243 MB |
| Crescimento só em setembro/2026 | 6.213 arquivos, 3.415 MB |

Os três maiores buckets são `checklist-faturamento-anexos` (1,5 GB),
`malote-anexos` (757 MB) e `treinamentos` (474 MB).

### Os arquivos do Storage têm cópia própria, em outro lugar

Desde **29/09/2026** existe um espelho dos arquivos em:

```
S:\1- SERVIDOR\Analise de dados\Grupo Nascimento\Analise de Sistemas\Eduardo\BACKUP-STORAGE
```

Feito por `scripts/espelhar-storage-para-servidor.ps1`, que lê o Storage pelo
protocolo S3 e copia para o servidor da empresa. **Numa restauração completa são
necessárias as duas coisas**: o `.dump.gpg` devolve o banco e a *lista* de
arquivos; esta pasta devolve os arquivos.

Três detalhes que importam no dia do desastre:

- **O espelho usa `copy`, não `sync`.** Arquivo apagado na Supabase **continua**
  no espelho. Isso é deliberado: se alguém apagar um anexo por engano, é daqui
  que ele volta. Consequência esperada: o espelho fica maior que a origem.
- **Os arquivos ficam em claro**, diferente do dump do banco. A pasta é de acesso
  restrito no servidor.
- **A estrutura é `bucket/caminho/arquivo`**, igual à da Supabase — então dá para
  localizar um arquivo pelo caminho que está em `storage.objects`.

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

## O backup já se testa sozinho — e o que isso NÃO cobre

Desde **28/09/2026**, toda execução do workflow restaura o dump que acabou de
gerar num **PostgreSQL 17 puro** (nada da Supabase) e compara as contagens com
a produção ao vivo, com tolerância de 5%. **Backup que não restaura não é
publicado.** Duas vezes por dia, não uma vez por trimestre.

Isso responde ao cenário "a Supabase sumiu": se o dump só restaurasse dentro da
Supabase, ele não serviria justamente no dia em que é mais necessário.

O que o teste automático **não** cobre, e por isso o teste manual abaixo continua
valendo:

| Não coberto | Por quê |
|---|---|
| A sua chave privada funciona | O runner nunca a viu — de propósito |
| O procedimento humano | Ninguém testa o runbook lendo o runbook |
| O tempo real até o ERP voltar | O teste mede o banco, não o sistema |
| Os arquivos do Storage | Não estão no backup |

Ou seja: o automático prova que **o arquivo presta**. O manual prova que **você
consegue usá-lo**. São coisas diferentes e as duas precisam existir.

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
| Gerar o backup — da máquina do Eduardo | **1 min 14 s** |
| Gerar o backup — pelo GitHub Actions | **7 min 05 s** |
| Restaurar (`--jobs=4`) | **40 s** |
| Arquivo gerado | **107 MB** |

O runner demora ~6× mais que a máquina local, e isso é **latência de rede até
`sa-east-1`, não o banco**: nas duas medições houve 0 bloqueios esperando e o
cache hit ficou acima de 99,95%. O agendamento tem 30 min de limite, então
sobra folga larga.

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
