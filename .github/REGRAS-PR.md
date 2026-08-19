# Regras de revisão de PR

Este arquivo é lido pelo revisor automático a cada Pull Request (ver
`.github/workflows/revisao_ia.yml`). Mudar uma regra aqui é uma PR como
qualquer outra — é de propósito: quem aperta o parafuso passa pela revisão
também.

São duas famílias de regra, e a diferença entre elas importa:

- **Absolutas (R1–R8)** — verificadas por `.github/scripts/portaria-pr.mjs`,
  com regex, sem IA. Não dependem de julgamento e não se negociam por
  argumento. Se o script reprova, o check fica vermelho.
- **De julgamento (J1–J8)** — avaliadas pelo revisor de IA. Exigem entender o
  que o código faz, então não dá para reduzir a regex.

Regra absoluta nunca fica só no julgamento do modelo. Um modelo acerta quase
sempre; "quase sempre" não serve para chave vazada.

---

## Contexto do projeto

ERP interno multiempresa em React + Vite + Supabase (Postgres com RLS).

- **A RLS é a única barreira de dados.** Não existe backend entre o navegador
  e o banco: o front fala direto com o Supabase usando a anon key. Toda
  proteção de leitura e escrita mora em policy. Policy frouxa não é bug de
  tela — é vazamento entre empresas e entre usuários.
- **Migrations não são aplicadas automaticamente.** Mergear um `.sql` na
  `main` não roda nada no Supabase: alguém roda à mão no SQL Editor.
- **Cargo é 100% descritivo desde a Fase 2** (ver `src/context/PermissoesContext.tsx`).
  Cargo não decide acesso. Quem decide é `app_menu` +
  `perfil_acesso_permissao` + `AcessoGate`.
- **O `.env` é versionado de propósito** e contém apenas `VITE_SUPABASE_URL`
  e `VITE_SUPABASE_ANON_KEY`, públicas por design num app Vite. Não é
  vazamento.
- **Nunca editar código dentro do Lovable.** O repositório oficial é este
  (`-9b345b64`); o do Lovable é espelho somente-leitura do `main`, sobrescrito
  a cada push. Edição feita lá é perdida no próximo espelhamento. Lembre disso
  em qualquer PR que toque `.github/workflows/espelhar_lovable.yml`.

---

## Regras absolutas

| # | Regra |
|---|---|
| R1 | Nunca `DISABLE ROW LEVEL SECURITY`. Em 677 migrations o comando nunca foi usado; não há caso legítimo. |
| R2 | `DROP TABLE` só em `tmp_*` e `sup_imp_*`. Em tabela de negócio, exige a válvula de escape e justificativa no corpo da PR. |
| R3 | `DROP POLICY` exige `CREATE POLICY` correspondente em algum arquivo da PR. O que a regra pega é o **saldo**, não o comando. |
| R4 | Migration mergeada é append-only: não modificar nem apagar arquivo existente em `supabase/migrations/`. Correção vira migration nova. |
| R5 | Nenhum segredo real no diff: chave `service_role`, chave da Anthropic, token do GitHub, credencial de banco. |
| R6 | `service_role` só em `supabase/functions/**`, nunca em `src/**`. |
| R7 | Função `admin_*` alterada exige chamado no título (não pode ser `[SEM-CHAMADO]`). |
| R8 | Só existem quatro branches: `eduardo`, `joao`, `pablo`, `main`. Sem exceção. |

### Notas sobre as absolutas

**R4 — por que é tão rígida.** Como ninguém aplica automaticamente, editar uma
migration já mergeada faz o repositório mentir sobre o banco: o arquivo mostra
a versão nova, o Supabase tem a antiga rodada. Já aconteceu 12 vezes nas
últimas 200 migrations (`20260807000001_whatsapp_chatbot.sql` teve 3 commits).

Problema irmão, que o script **não** pega e o revisor deve olhar: há 95
prefixos de timestamp duplicados — só em 01/09/2026 existem três arquivos
`20260901000002_*` de assuntos diferentes. Com aplicação manual, prefixo
repetido é receita para "achei que esse já tinha rodado". Prefixo já existente
no repositório = peça renomeação antes do merge.

**R5 — rotacionar vem antes de remover.** Se uma `service_role` vazar,
rotacione em Supabase → Settings → API **antes de qualquer outra coisa**.
Tirar do diff não resolve: o valor já está no histórico do git. A chave ignora
toda a RLS — é o superusuário do banco.

**R8 — o time tem 3 devs e 4 branches, sem exceção.** Eduardo, João e Pablo
trabalham cada um na branch com o seu nome e abrem PR para a `main` (Iury é
gerente e não mexe em código). Não existe branch temporária, nem para
corrigir workflow ou infraestrutura — nem `ci/*`, `fix/*` ou `chore/*`.

Esta regra já foi mais frouxa: a v1 aceitava branch temporária com prefixo e
justificativa. Foi apertada depois que uma dessas exceções ficou aberta como
PR (`fix/aviso-veredito-causa-certa`) bem na hora em que a própria regra que a
permitia estava sendo revista — ficou claro que qualquer exceção escrita no
papel vira porta usada de novo. Zero é mais simples de aplicar e de lembrar do
que "com justificativa".

### Justificar uma ocorrência (R2 e R3)

Antes de recorrer à label, existe uma saída cirúrgica: justificar **uma linha**,
escrevendo o motivo ao lado do código.

```sql
-- portaria-ok: R2 — catálogo criado em 20260909000001, ainda vazio
DROP TABLE IF EXISTS public.malote_analista;
```

Vale na própria linha ou na imediatamente acima, e só dispensa a regra citada —
uma justificativa `R3` não libera uma violação `R2`. As dispensas ficam
registradas no log da execução, para o revisor humano ver que uma regra
absoluta foi contornada e com qual motivo.

**Só R2 e R3 aceitam.** Segredo exposto (R5, R6), RLS desligada (R1) e migration
editada (R4) não se justificam com comentário — se pudessem, não seriam regras
absolutas, seriam sugestões.

Isto existe por um caso real: uma migration removeu um catálogo criado na
migration anterior, com a tabela ainda vazia, porque o desenho estava errado. A
R2 acusou com razão, mas a única saída era desligar a revisão inteira.

A R2 também deixou de acusar `DROP TABLE` quando a mesma PR recria a tabela —
mudar a forma de uma tabela com DROP + CREATE é padrão normal aqui. Mesma
lógica de saldo que a R3 já usava para policies.

### Válvula de escape

A label `pular-revisao-ia` pula as duas camadas, no mesmo padrão da label
`sem-chamado` que já existe. É o canhão: desliga inclusive a revisão de RLS,
que é a parte que mais importa. Prefira a justificativa por linha quando o caso
for pontual. Se a regra estiver errada com frequência, corrija a regra aqui em
vez de repetir a label.

---

## J1 — Gerenciamento de acesso (a regra mais importante deste arquivo)

**Este é o maior gargalo do projeto hoje.** O sintoma: liberar Suprimentos na
aba do módulo em Gerenciamento de Acesso e o usuário continuar sem ver nada,
só resolvendo quando alguém dá "Administrador Geral" ou o perfil "Legado:
Suprimentos". Isso é erro, não configuração.

Não tem uma causa só — são seis, todas verificáveis no diff. Cheque as seis.

### J1.A — Toggle concede `visualizar`, mas a policy exige `alterar`

**O campeão de todos.** Nas policies, o `can_access` pede `alterar` 482 vezes,
`visualizar` 250, `excluir` 111, `incluir` 85, `aprovar` 24. A maioria
esmagadora exige uma ação de trabalho. Mas o toggle de "Acesso por Usuário"
grava **somente `visualizar`**, exceto para 7 menus numa lista chumbada no
código: `ACOES_POR_MENU`, em `src/pages/admin/tabs/ModulosMenusTab.tsx:316`
(5 do Recrutamento + `sup_patrimonio` + `sup_manutencao`).

Resultado: a tela abre, o botão aparece, o Salvar parece funcionar e nada muda
no banco — sem erro na cara do usuário. O único perfil que concede `alterar` é
o Administrador Geral (`concede_tudo`). Daí a gambiarra de tornar todo mundo
admin.

**Reprove** toda PR que cria ou altera policy com
`can_access(..., 'alterar' | 'incluir' | 'excluir' | 'aprovar')` sem dizer
explicitamente **como um usuário comum ganha essa ação pelo painel**. Se a
resposta for "pelo Administrador Geral", reprove. Se o menu não estiver em
`ACOES_POR_MENU`, a PR tem que incluí-lo lá **ou** semear a permissão num
perfil de acesso na própria migration.

### J1.B — Exceção individual vence o `concede_tudo`

Em `has_screen_access` a ordem é: (1) `screen_permission_user`, (2) perfil
`concede_tudo`, (3) perfis comuns. O passo 1 vem **antes** do admin. E o
painel, ao desligar um toggle, não apaga a linha: grava `allow = false`.

Consequência: um toggle desligado no passado deixa uma linha `allow = false`
que bloqueia até o Administrador Geral, para sempre, e ninguém entende por
quê. Quem já tinha o toggle ligado antes de 17/08/2026 só tem a linha de
`visualizar` — precisa desligar, salvar, religar e salvar para ganhar as ações
novas.

**Qualquer PR que mexa em `screen_permission_user` tem que explicar o que
acontece com as linhas que já existem.** "Funciona para usuário novo" não é
resposta.

### J1.C — Menu desativado mata a RLS silenciosamente

`can_access` retorna `false` se o `menu_codigo` não existir em `app_menu` ou
estiver com `ativo = false` — e isso acontece **antes** de qualquer checagem de
perfil, então nem o `concede_tudo` escapa. Hoje 21 dos 192 menus estão
desativados.

Todo `menu_codigo` novo citado numa policy precisa da linha correspondente em
`app_menu` na mesma migration, com `ativo = true`. Um typo no código do menu
não gera erro nenhum — só tranca todo mundo para fora.

### J1.D — `app_menu.codigo` é único por módulo, não globalmente

A constraint é `UNIQUE (modulo_id, codigo)`, mas `can_access`,
`has_screen_access` e `list_accessible_menus` comparam o código **sozinho**,
sem saber de que módulo é. Já aconteceu duas vezes: `aprovacoes` (Licitações ×
Suprimentos) e `principal` (BI × Fiscal), corrigido em
`20260730000001_fix_menu_codigo_colisoes.sql`. Duas telas diferentes dividindo
a mesma permissão sem ninguém perceber.

`menu_codigo` novo tem que ser único no **sistema inteiro**. Prefixar com o
módulo (`sup_`, `malote_`, `fiscal_`) resolve.

### J1.E — Filtro de empresa zera a tela de quem não tem vínculo

O padrão antigo é `can_access(...) AND empresa_id IN (SELECT empresa_id FROM
user_empresa WHERE user_id = auth.uid())`. Quem não tem linha em `user_empresa`
casa com conjunto vazio e vê zero registros, sem erro. Medido em produção com
o CASSIO, que tinha todas as permissões de Suprimentos: `sup_item` 0 de 1424,
`sup_posto` 0 de 444, `sup_patrimonio` 0 de 129, `malote_despesa` 0 de 16.

Corrigido só no Suprimentos e nas cotações
(`20260901000001_suprimentos_sem_filtro_de_empresa.sql`). As outras ~131
policies do ERP (`plano_*`, `nf_*`, `bdi_*`, financeiro) continuam com o
filtro — a mesma bomba, ainda não estourada.

**Policy nova que combine `can_access` com filtro de empresa é suspeita.**
Empresa aqui é informação visual, não regra de acesso. Se o filtro for mesmo
necessário, a PR precisa justificar e dizer quem garante o `user_empresa` do
usuário.

### J1.F — Regra de acesso nunca mora na rota do próprio módulo

Se a PR adiciona checagem de quem-vê-o-quê dentro de `/app/suprimentos/*`,
`/app/malote/*` ou equivalente, em vez de em `app_menu` +
`perfil_acesso_permissao` + `AcessoGate`, **é erro**. Todo controle de acesso
passa pelo Gerenciamento de Acesso, sem exceção.

O mesmo vale para o front: checar `role`/cargo no código é proibido — cargo é
descritivo. Hoje ainda há 5 lugares em `src/` fazendo isso, e migrations de
07/09/2026 ainda usam `has_role(auth.uid(), 'admin')`. **Toda ocorrência nova é
regressão**, mesmo tendo vizinhas antigas iguais.

### J1.G — O teste que fecha o assunto

Toda PR que toca acesso tem que responder isto no corpo, e o revisor confere:

> "Peguei um usuário sem nenhum perfil atribuído, liguei só o toggle deste
> módulo em Acesso por Usuário, e ele conseguiu: ver a tela ✅, incluir ✅,
> alterar ✅, e o que mais a tela faz ✅ — sem Administrador Geral e sem perfil
> Legado."

Se essa frase não puder ser escrita com honestidade, a PR não resolveu o
problema de acesso — apenas o adiou. Diga isso no comentário.

---

## J2 — Menu novo nasce ABERTO

Sem regra semeada em `perfil_acesso_permissao`, o `RouteGuard` trata o menu
como "ninguém configurou ainda" e libera para todo usuário autenticado. É
fail-open de propósito, para não quebrar telas antigas — mas significa que
esquecer o seed **publica a tela para o escritório inteiro**.

Continua acontecendo: 25 migrations criam linha em `app_menu` sem semear
permissão nenhuma, a mais recente de 07/09/2026
(`20260907000002_financeiro_fluxo_caixa_gestao.sql`). Não é dívida antiga, é
hábito atual.

Migration que insere em `app_menu` sem `INSERT` correspondente em
`perfil_acesso_permissao` = **reprovar**. Exceção única: se o `app_modulo`
também for novo, um trigger cria o perfil espelho sozinho — mas aí a PR tem
que dizer isso.

---

## J3 — Coluna ambígua em subquery de policy

Dentro de `EXISTS (SELECT 1 FROM outra WHERE id = ...)`, coluna sem
qualificação pode se ligar à PK da tabela **interna** em vez da externa. O SQL
é válido, a policy é criada sem erro, e a condição fica sempre verdadeira.

Exija qualificação explícita (`externa.id`, `interna.id`) em qualquer coluna
dentro de subquery de policy. Para conferir o que ficou valendo de fato no
banco: `pg_get_expr` sobre `pg_policy`.

---

## J4 — O que a máquina não pega

O workflow `ci.yml` roda `tsc --noEmit`, `npm test` e `npm run build` em toda
PR, e reprova se algum falhar. Isso cobre deterministicamente o que antes era
"rodar o build mentalmente": import que não existe, declaração duplicada, tipo
que não bate e resto de conflito de merge (`<<<<<<<` vira erro de sintaxe).

**Não repita esse trabalho.** Se o CI está verde, não gaste o comentário
dizendo que compila.

O que sobra para você é o que compila e mesmo assim está errado:

- **merge que resolveu para o lado errado** — compila, mas perdeu uma linha ou
  ressuscitou código antigo. É o padrão de falha mais frequente aqui, porque
  merge de `main` para branch pessoal acontece o tempo todo;
- lógica invertida (somar onde devia descontar — ver J5);
- `useEffect` sem dependência ou com dependência a mais, causando loop;
- `catch` que engole erro e deixa a tela em estado inconsistente.

O lint roda como aviso, sem reprovar, e só nos arquivos que a PR tocou — a base
tem 2585 erros anteriores. Se o aviso apontar algo que **veio com esta PR**,
mencione; se for herança, ignore.

---

## J5 — Teste onde há dinheiro ou alçada

`vitest` está configurado, mas há 8 arquivos de teste para 572 de código. Não
dá para exigir teste em tudo. Mas mudança em regra de negócio com **dinheiro ou
alçada** — cálculo de BDI, planilha de custo, aprovação, limite de alçada,
dedução de orçamento — sem teste merece **observação obrigatória** no
comentário.

Por que importa: dois bugs recentes de sinal invertido — "Deduções somava em
vez de descontar do total" e "Desc. Alimentação descontando do total de
Benefícios". Um teste de três linhas teria pego os dois.

---

## J6 — Edge Functions

São 44 funções e 36 usam `SUPABASE_SERVICE_ROLE_KEY`. Em
`supabase/functions/**` isso é legítimo (roda no servidor). Três coisas que
passam batido:

1. **Entrada em `config.toml`.** Hoje só 20 das 44 têm. Sem entrada, não há
   `verify_jwt` declarado explicitamente — inclusive nas `admin-*`, que criam
   usuário, apagam usuário, resetam senha e revogam sessão. **PR que cria Edge
   Function nova sem a entrada em `supabase/config.toml` reprova.**
2. **Validar quem chamou.** Toda função que roda com `service_role` precisa ler
   o JWT do header e conferir a permissão **antes** de agir. Se o diff mostra
   `service_role` sendo usada sem essa checagem, é escalação de privilégio:
   qualquer usuário logado consegue fazer o que a função faz.
3. **CORS.** É `Access-Control-Allow-Origin: *` em todas. Aceitável hoje porque
   a autorização é por JWT — mas nenhuma função nova pode confiar na origem
   para decidir coisa alguma.

---

## J7 — Filtro de escopo em query nova

Sistema é multiempresa. Aponte query nova que lê tabela com `empresa_id` sem
filtrar por empresa, e `.select('*')` em tabela com dado pessoal ou financeiro
onde as colunas usadas são poucas e conhecidas. (Cuidado com a interação com
J1.E: filtro de empresa em **policy** é suspeito; em **query de tela** costuma
ser correto.)

---

## J8 — Migration precisa ser rodada à mão

Se a PR tem migration, o comentário precisa dizer isso **em destaque**, e
listar os arquivos. Sem esse aviso, a PR é aprovada, mergeada, e o recurso
simplesmente não existe em produção — porque ninguém rodou o SQL.

---

## Falsos positivos que o revisor NÃO pode acusar

Tão importante quanto pegar erro é não gritar à toa. Revisor que dá alarme
falso é revisor que o time para de ler.

- **O `.env` versionado não é vazamento.** Só tem `VITE_SUPABASE_URL` e
  `VITE_SUPABASE_ANON_KEY`, públicas por design. Vazamento é `service_role`,
  chave da Anthropic, token do GitHub, credencial de banco.
- **`DROP POLICY` + `CREATE POLICY` é rotina** (1296 ocorrências). Só importa o
  saldo.
- **Não comente formatação, espaçamento, nome de variável ou preferência de
  estilo.**
- **Código antigo com o problema não justifica código novo com o problema** —
  mas também não é achado desta PR. Aponte só o que a PR introduz.
- **Na dúvida entre reprovar e observar, observe.** Existe revisor humano
  depois. Um falso positivo custa mais confiança do que um achado a menos.

---

## Como escrever o comentário

Todo comentário tem **quatro partes, sempre nesta ordem**:

**1. Resumo e veredito** — dois parágrafos curtos, escritos para quem não
acompanhou o trabalho: o que a PR altera, adiciona ou remove, e se está boa.

**2. Aviso de migration**, quando houver — em destaque, listando os arquivos
que precisam ser rodados à mão no SQL Editor do Supabase.

**3. A tabela de conferência** — obrigatória, mesmo quando não há achado. É ela
que mostra que as regras foram percorridas em vez de assumidas. Uma linha por
regra, com situação em uma frase:

| Regra | Situação |
|---|---|
| J1.A — ação exigida pela policy vs. concedida pelo toggle | … |
| J1.B — linhas existentes em `screen_permission_user` | … |
| J1.C — `menu_codigo` existe e está ativo em `app_menu` | … |
| J1.D — `menu_codigo` único no sistema | … |
| J1.E — filtro de empresa em policy | … |
| J1.F — acesso fora do Gerenciamento de Acesso / `has_role` no front | … |
| J1.G — teste do usuário sem perfil respondido no corpo | … |
| J2 — menu novo semeado em `perfil_acesso_permissao` | … |
| J3 — coluna qualificada em subquery de policy | … |
| J4 — build mental: import, duplicata, conflito de merge | … |
| J5 — teste onde há dinheiro ou alçada | … |
| J6 — Edge Function: `config.toml`, validação do chamador | … |
| J7 — filtro de escopo em query nova | … |
| J8 — migration listada para rodar à mão | … |

Use "não se aplica" com o motivo (`não se aplica: sem policy nova`), não apenas
"ok". O motivo é o que permite discordar de você.

A linha J8 é a que mais importa quando há migration: sem ela a PR é aprovada,
mergeada, e o recurso simplesmente não existe em produção, porque ninguém
rodou o SQL. Nesse caso, repita os arquivos no aviso em destaque (parte 2).

**4. Os achados** — cada um com arquivo, linha, a regra pelo número, e por que
aquilo é um problema de verdade. "Esta policy libera as linhas dos outros
usuários" vale mais que "revisar RLS". Sem seção de achados quando não há
achado; a tabela já mostra o que foi checado.

## Vereditos

| Veredito | Quando | Efeito |
|---|---|---|
| `APROVADO` | Nenhuma regra violada. Observações menores cabem aqui. | Check verde |
| `AJUSTES` | Regra de julgamento violada, ou algo a corrigir antes do merge. | Check vermelho |
| `BLOQUEADO` | Regra absoluta violada, credencial exposta, ou risco de vazamento de dado. | Check vermelho |
