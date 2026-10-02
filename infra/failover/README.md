# Failover do ERP — a réplica e o caminho até a troca automática

> **O problema que isto resolve:** backup protege contra *perder dados*.
> Não protege contra o *fornecedor cair*. Se a Supabase ficar fora do ar, o
> ERP fica fora junto — e nenhuma das três cópias de backup coloca uma tela
> no ar. Esta pasta ataca exatamente essa lacuna.

---

## O que já está provado (ensaio de 30/09/2026)

Isto não é mais uma proposta. A stack subiu, o backup de produção foi
carregado nela e o **ERP de verdade rodou contra a réplica**, com uma
funcionária real fazendo login pela tela de login.

| O que foi provado | Como foi medido |
|---|---|
| O banco inteiro restaura fora da Supabase | 641 tabelas, **1.445 policies de RLS**, 1.214 funções, 154 logins, 13.369 empregados — bate 1:1 com o dump |
| A API do ERP nasce sozinha do schema | PostgREST expôs **614 tabelas, 624 relacionamentos e 775 funções RPC** |
| A RLS filtra por usuário | Gerente de RH vê **706** de 13.501 notificações; encarregada vê **7**; sem token, **0** |
| O login funciona com as senhas da produção | Usuária restaurada logou pelo GoTrue e recebeu token válido |
| O ERP roda contra a réplica | Tela inicial carregou com os menus, favoritos e aniversariantes dela |
| Token forjado é recusado | HTTP 401 |
| Sem `apikey` o Kong barra antes do banco | HTTP 401 |
| **As 59 Edge Functions** | ✅ rodando — função pública devolveu empresas e contratos reais; protegida sem token deu 401 |
| Tempo de restauração | **28 segundos** (109 MB cifrados → banco completo) |

Os mesmos números apareceram por três caminhos independentes — SQL direto,
PostgREST no Windows e pelo Kong em container. Não é estimativa.

---

## Por que Postgres, e não MySQL, MariaDB ou SQLite

Foi a primeira ideia considerada, e ela não funciona. Não por preferência —
por incompatibilidade estrutural:

| Peça | O que o ERP usa hoje | MySQL / MariaDB | SQLite |
|---|---|---|---|
| Controle de acesso | **1.445 políticas de RLS** no banco | ❌ RLS não existe | ❌ não existe |
| API | PostgREST (gera a API do schema) | ❌ exige Postgres | ❌ |
| Login | GoTrue sobre Postgres | ❌ | ❌ |
| Concorrência | centenas de conexões | ✅ | ❌ arquivo local |

O ponto decisivo é a **RLS**. O acesso do ERP é decidido linha a linha, dentro
do banco, por 1.445 políticas. Em MySQL esse conceito **não existe**: todas
teriam que ser reescritas dentro da aplicação — que hoje nem tem servidor
próprio (`CLAUDE.md`: *"não existe servidor Node de aplicação"*).

Trocar o motor não seria failover. Seria **reescrever o ERP**.

**Sair da Supabase e sair do PostgreSQL são coisas diferentes.** A Supabase é o
*fornecedor* — a conta, a empresa, o que pode cair. O PostgreSQL é o *motor* —
software livre que roda em qualquer lugar. Esta pasta entrega independência
total do fornecedor mantendo o motor, que é o que preserva RLS, senhas, tokens
e a API.

---

## O que esta pasta entrega

```
docker-compose.yml       a stack: Postgres 17 + GoTrue + PostgREST + Storage
                         + Edge Functions + Kong
kong.yml                 o gateway (TEMPLATE — ver o entrypoint do serviço kong)
db-init/                 script que roda no primeiro boot do banco
functions-main/          roteador das 59 Edge Functions
gerar-chaves.mjs         gera JWT_SECRET + chaves anon e service_role coerentes

carregar-replica.sh      ⭐ AS CORREÇÕES DO RESTORE MORAM AQUI, e só aqui
preparar-replica.sh      atalho: aponta o de cima para o compose local
preparar-replica.ps1     idem, para o PowerShell (ensaio no PC)
recarregar-replica.sh    ciclo completo de recarga (derruba, sobe, carrega, confere)
validar-replica.sql      prova que a réplica tem dados E segurança

render/                  o que só existe por causa da Render
  Dockerfile.db          imagem do banco com o db-init embutido
  Dockerfile.functions   imagem com as 59 funções e o config.toml
  Dockerfile.kong        imagem do gateway com o template
  Dockerfile.recarga     imagem do job de recarga automática
  recarga-render.sh      busca o backup no GitHub, descriptografa e carrega
```

**O `carregar-replica.sh` é o único lugar com a lógica do restore.** Todos os
outros apontam para ele. Isso é deliberado: as quatro correções são sutis e
silenciosas — um papel faltando derruba 1.410 policies sem uma linha de erro.
Três cópias divergiriam sem ninguém perceber, e o lugar onde isso apareceria
seria a emergência em que a réplica precisasse funcionar.

Ele fala com o banco por TCP com `psql`/`pg_restore` comuns, então serve tanto
o container local quanto um servidor do outro lado do mundo.

> O cliente pode ser **mais novo** que o servidor. Mais **antigo** não serve: ele
> recusa o arquivo inteiro com `unsupported version in file header`.

---

## Como subir

### 1. Container runtime — **não precisa de Docker Desktop nem Rancher**

O Docker Desktop não é gratuito para empresa com mais de 250 funcionários, e
por isso este documento recomendava o Rancher Desktop. **Nenhum dos dois é
necessário.** O Docker Engine é Apache 2.0 e roda direto dentro do WSL:

```powershell
wsl --install            # PowerShell como Administrador; reinicia o PC
```

Depois, dentro do Ubuntu:

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"     # reabra o terminal depois disto
```

Foi assim que o ensaio rodou: Docker Engine 29.1.3 + Compose 2.40.3, sem
licença nenhuma e sem privilégio de administrador depois da instalação do WSL.

> **A VM do WSL se desliga sozinha e leva os containers junto.** Nesta build
> (WSL 3.0.1.0 / Windows 22621) o `vmIdleTimeout=-1` no `.wslconfig` é aceito e
> **não** impede. O sintoma engana: os containers reaparecem com "Up 1 second",
> o Kong devolve 503 porque o PostgREST ainda está reconectando, e o `/tmp` da
> distro esvazia entre um comando e outro. Enquanto a réplica precisar ficar no
> ar, deixe isto rodando numa janela:
> ```powershell
> wsl -d Ubuntu -u root -e tail -f /dev/null
> ```
> Num host Linux de verdade o problema não existe.

### 2. Gere as chaves

```bash
node gerar-chaves.mjs
```

### 3. Suba a stack

```bash
docker compose up -d
```

### 4. Carregue o backup

O `.gpg` é descriptografado **fora** do script, de propósito — senha de chave
não entra em arquivo versionado:

```bash
gpg -o producao.dump -d /caminho/backup-AAAAMMDD.dump.gpg
./preparar-replica.sh producao.dump
```

Ele mostra a conferência no fim. Os números de referência estão na tabela do
topo deste documento.

### 5. Valide a visibilidade

```bash
docker compose exec -T db psql -U postgres -d postgres < validar-replica.sql
```

### 6. Aponte o ERP para a réplica

Já existe `.env.replica` na raiz do projeto (git-ignorado). Ele sobrescreve
só a URL e a chave anon, sem tocar no `.env` de produção:

```powershell
npm run dev -- --mode replica
```

Abra `http://localhost:8080` e faça login. Para logar com um usuário real sem
saber a senha dele, defina uma **na réplica** (nunca na produção):

```bash
curl -X PUT "http://localhost:8000/auth/v1/admin/users/<uuid>" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"password":"...","email_confirm":true}'
```

### 7. Mantenha a réplica atualizada

```bash
export GPG_PASSPHRASE_FILE=/run/secrets/gpg-backup   # nunca a senha no script
./recarregar-replica.sh                               # pega o backup mais novo
```

Ciclo completo medido: **74 segundos** — derruba, sobe limpo, restaura, confere
os números e ainda testa se a API e o login respondem antes de declarar
sucesso. Rodando de hora em hora, o atraso máximo da réplica passa a ser 1 hora.

Ele **recria tudo** em vez de atualizar no lugar, de propósito: é o mesmo
caminho já provado dezenas de vezes, e o backup é um dump completo, não um
diff. Inventar diff aqui seria trocar processo provado por artesanal para
economizar um minuto de uma máquina que não está servindo ninguém.

> **A trava `PROMOVIDA`.** Se a réplica virar produção (a Supabase caiu e o
> tráfego veio para cá), recarregar **apagaria o que os usuários escreveram**.
> Crie um arquivo vazio chamado `PROMOVIDA` nesta pasta no momento da promoção:
> o script se recusa a rodar enquanto ele existir. É a primeira peça da trava
> contra split-brain.

Não há nada agendado ainda — isso entra junto com a hospedagem na Render.
No PC do Eduardo o `S:` **não** é visível para o root do WSL (drive de rede no
Windows é por usuário), então localmente o script recebe o caminho do dump; na
Render o backup vem do artifact do GitHub.

---

## As oito armadilhas que o ensaio revelou

Todas apareceram rodando, nenhuma é teórica. Estão corrigidas nos arquivos
desta pasta, com o porquê comentado no código.

1. **A versão do Postgres da réplica não é escolha livre.**
   A produção é **17.6** e o backup sai do `pg_dump 17.11`. Este compose
   apontava para `supabase/postgres:15.8.1.060`, e com ele a réplica **nunca**
   restaurou nada: `unsupported version (1.16) in file header`. O pior é que o
   sintoma era invisível — um `pg_restore` com código 1 no meio de dezenas de
   avisos benignos, e "1 erro" é exatamente o que um restore *bem-sucedido*
   produz. Confira sempre: `pg_restore -l backup.dump | head -8`.

2. **Nenhum usuário da produção consegue entrar sem `GOTRUE_JWT_AUD`.**
   O GoTrue procura o usuário por e-mail **e audiência**. Os 154 logins
   restaurados têm `aud='authenticated'`; sem essa variável o GoTrue procura
   audiência vazia e responde `Invalid login credentials` para todo mundo.
   Um usuário criado *na réplica* logava normalmente (nasce com `aud` vazio),
   o que fazia o problema parecer ser dos dados restaurados.

3. **O dump não traz extensão nenhuma.**
   Ele é gerado por schema, então o `extensions` da Supabase fica de fora.
   Sem pré-criar `pg_trgm`, `btree_gist` e `pgcrypto`, some o índice de busca
   de `EMPREGADOS`, somem as **duas travas de reserva duplicada** (vigência de
   orçamento e sala de reunião) e some uma tabela inteira com seus índices e
   policy — tudo em silêncio.

4. **Os papéis precisam existir ANTES do restore.**
   `CREATE POLICY ... TO authenticated` falha calado se o papel não existe.
   Medido: sem eles, de 1.445 policies só 35 eram restauradas. Um banco com
   todos os dados e 2% da segurança.

5. **O dump não traz GRANTs** (é gerado com `--no-privileges`). Sem devolvê-los,
   o PostgREST não enxerga as tabelas e a aplicação abre em branco — parece
   backup quebrado, e é só permissão.

6. **As contas de serviço não conseguem logar.**
   A imagem traz `authenticator`, `supabase_auth_admin` e
   `supabase_storage_admin` com senha própria dela. E a extensão `supautils`
   marca os três como reservados: depois do boot **nem o usuário `postgres`
   troca a senha deles** (ele não é superusuário nesta imagem). A janela é a
   inicialização — daí o `db-init/`.

7. **`auth` e `storage` têm que ser restaurados pelos donos, e por TCP.**
   Como `postgres`, dá `permission denied for schema auth` e faltam 14 tabelas.
   Como o dono pelo socket local, dá `Peer authentication failed` — a mensagem
   fala de senha, mas o `pg_hba` ali usa `peer` e a senha é ignorada. Só com
   `-h 127.0.0.1` as 641 tabelas chegam.

8. **O Kong não interpola variável de ambiente** em config declarativo. O
   `kong.yml` é um template renderizado pelo entrypoint; sem isso a chave
   esperada no header `apikey` seria a string literal `$SUPABASE_ANON_KEY` e
   toda chamada a `/rest/v1` voltaria 401.

---

## O que isto É e o que ainda NÃO é

| | Status |
|---|---|
| Réplica com dados e RLS idênticos | ✅ provado |
| Login com as senhas de produção | ✅ provado |
| Aplicação funcionando contra ela | ✅ provado (tela inicial, um usuário) |
| As 59 Edge Functions | ✅ provado — serviço `functions` + roteador |
| Recarga periódica (atraso de 1h) | ✅ `recarregar-replica.sh`, ciclo completo em 74s |
| Dados em tempo real (replicação lógica) | ❌ falta — exige produção em XL |
| Detecção automática de queda | ❌ falta |
| Troca automática de tráfego | ❌ falta |
| Trava contra split-brain | ❌ falta |

**Isto é um *standby frio*: uma réplica carregada a partir do backup.** Ela
prova que o ERP roda fora da Supabase — a pergunta que precisava ser
respondida antes de gastar qualquer dinheiro.

### Duas limitações que aparecem na tela e é bom conhecer

**A réplica tem a idade do último backup.** No ensaio, o console acusou
`404` na RPC `cs_reembolso_alcada_resumo` — ela nasceu numa migration do dia
seguinte ao backup. Não é defeito da réplica; é o custo de um standby frio, e
é exatamente o que a replicação contínua (degrau 2) resolve.

**O rodapé continua dizendo "Ambiente Produção"** mesmo rodando contra a
réplica. Numa emergência real isso confunde quem estiver operando. Vale um
indicador ligado à `VITE_SUPABASE_URL`, não ao modo de build.

---

## A escada até o failover automático

**Degrau 1 — provar que roda fora da Supabase** ← *feito, R$ 0*
O que esta pasta entrega. Se tivesse falhado aqui, todo o resto mudaria de
rumo.

**Degrau 2 — standby morno (promoção manual)**
Replicação lógica contínua da Supabase para a réplica, rodando num servidor
sempre ligado. Se a Supabase cair, **um humano promove** em 30–60 min.
Custo: ~US$ 120–300/mês.
*Atenção:* a Supabase recomenda instância **XL** para replicação lógica, e a
produção está em **Small**. Ligar isso exige janela e medição.

**Degrau 3 — failover automático**
Degrau 2 + endereço estável próprio (`api.empresa.com.br`) + health check +
promoção automática + *fencing* contra split-brain.
Custo: ~US$ 400–900/mês.

> **O risco do degrau 3 sem o fencing:** a Supabase volta enquanto a réplica
> já recebe escrita. Dois bancos divergem e ninguém percebe. Isso é **pior**
> que ficar fora do ar — é perder dados achando que está tudo bem.

### Onde hospedar

A Render já é paga pela empresa e roda containers — é o candidato natural, sem
custo novo para o degrau 1. AWS também serve. O ponto é que, de qualquer um
deles, a dependência da Supabase é **zero**.

---

## A pergunta que decide o investimento

**Quanto a Supabase realmente cai?**

Se o histórico for de 99,9%, são ~43 minutos por mês. Vale US$ 300/mês para
evitar 43 minutos? Talvez sim, talvez não — mas é decisão de negócio, e deve
ser tomada com o número na mesa, não com a sensação de risco.

O degrau 1 custou zero e respondeu a pergunta técnica: **sim, o ERP roda fora
da Supabase.**

---

## Segurança

O `.env` desta pasta é **git-ignorado**. Ele contém a `SERVICE_ROLE_KEY`, que
**ignora toda a RLS** — trate como senha de root. Nunca vai para o frontend,
nunca é commitada.

O `.env.replica` da raiz do projeto também é git-ignorado (foi preciso
acrescentar a linha: `.env.*.local` não pegava esse nome, e o repositório é
público).

Senha de chave GPG não entra em script. A descriptografia do backup é um passo
à parte, feito por uma pessoa, de propósito.

---

## Contingência: consultar a réplica quando a Supabase cai (02/10/2026)

Quando o `monitorDeQueda` confirma que a Supabase está fora, o ERP passa a
**oferecer** "Consultar em modo leitura" apontando para esta réplica. Conferir
um pedido, uma escala ou um contrato é a maior parte do uso e não depende de
gravar nada.

### O risco que define o desenho: split-brain

Se metade dos navegadores escrevesse aqui e a outra metade na Supabase,
existiriam duas verdades — e a próxima recarga apagaria o que foi escrito aqui.
Pedido aprovado que some, hora extra que não existe mais. Pior que ficar fora
do ar, porque o usuário viu "salvo com sucesso".

Por isso: **automático lê, humano escreve.** A réplica vive em somente leitura;
liberar escrita é decisão explícita (`promover.sh promover`).

### Como a trava é feita, e por que não do jeito óbvio

A primeira tentativa foi a que parece natural:

```sql
alter role authenticated set default_transaction_read_only = on;
```

**Não funciona, e falha em silêncio.** Testado contra a API real em 02/10/2026:
a configuração aparece em `pg_roles` nos três papéis e mesmo assim

```
POST  /rest/v1/notificacoes   HTTP 201   (criou)
PATCH /rest/v1/notificacoes   HTTP 204   (alterou)
```

O PostgREST abre a transação declarando o modo conforme o método HTTP, e esse
`BEGIN ... READ WRITE` sobrescreve o default do papel. Quem olhasse só o
`pg_roles` concluiria que estava protegido.

O que funciona é `REVOKE`, verificado independente do modo da transação:

```sql
revoke insert, update, delete, truncate on all tables in schema public
  from authenticated, anon;
```

Aplicado no fim de **toda** recarga (`carregar-replica.sh`, bloco 6d) — porque
o dump traz as permissões da produção, onde escrever é permitido, e portanto
cada restore desfaz a trava.

### O que fica coberto, e o que não

| Caminho | Coberto? |
|---|---|
| POST/PATCH/PUT/DELETE direto em tabela pela API REST | **sim** |
| Login, sessão, refresh token (GoTrue) | não travado **de propósito** — sem isso ninguém entra |
| RPC marcada `SECURITY DEFINER` | **sim**, desde 02/10 — ver abaixo |

As funções `SECURITY DEFINER` rodam com os privilégios do **dono**, então o
`REVOKE` nas tabelas não as alcança. Elas são tratadas em separado, pelo mesmo
bloco do `carregar-replica.sh`: um `DO` percorre o `pg_proc` e revoga `EXECUTE`
de toda função `SECURITY DEFINER` cujo corpo contenha INSERT/UPDATE/DELETE/
TRUNCATE.

Medido no repositório em 02/10/2026: de 1.032 definições de função, **444 se
encaixam no critério** e **249 delas são chamadas pelo app**. Nenhuma com nome
sugerindo leitura (`get_`, `listar_`, `buscar_`…) — a amostra é
`nf_lancar_estoque`, `cotacao_fechar`, `cnab_gerar_remessa`.

Falso positivo aqui é **seguro**: revogar uma função de leitura que tinha a
palavra "update" solta num comentário não faz falta em modo consulta. Falso
negativo seria o perigo, e só aconteceria com escrita montada por `EXECUTE`
dinâmico.

**As funções de RLS ficam de fora, e isso não é opcional.** `can_access`
aparece 2.063 vezes dentro de policies, `has_screen_access` 830,
`tem_acesso_menu` 750. Elas são chamadas *dentro* da policy, com os
privilégios de quem está consultando. Revogar `EXECUTE` delas não deixaria o
banco mais seguro: derrubaria **toda a leitura**, porque cada policy passaria a
dar erro de permissão. A réplica viraria uma tela de erro.

Consequência prática: em contingência, **249 operações do app recusam com
`permission denied`**. Isso é o desenho funcionando, não defeito — é o que
impede que um pedido aprovado ali desapareça na recarga seguinte.

### Partes

| Onde | O quê |
|---|---|
| `src/integrations/supabase/contingencia.ts` | decide o backend; só aceita a URL embutida no build, nunca uma vinda do armazenamento |
| `src/components/layout/MonitorDeQueda.tsx` | oferece a troca, e só depois de a réplica responder |
| `src/components/layout/AvisoContingencia.tsx` | faixa fixa: "Modo consulta — não é possível salvar" |
| `carregar-replica.sh` (6d) | reaplica a trava após cada recarga |
| `promover.sh` | `status` / `promover` / `reverter` |

Fica **inerte** sem `VITE_FAILOVER_URL` e `VITE_FAILOVER_ANON_KEY` no build —
isto entra no caminho de todos os usuários e não deve ligar por acidente de
merge.
