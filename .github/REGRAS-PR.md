# Regras de revisão de PR

Este arquivo é lido pelo revisor automático a cada Pull Request (ver
`.github/workflows/revisao_ia.yml`). Mudar uma regra aqui é uma PR como
qualquer outra — é de propósito: quem aperta o parafuso tem que passar pela
revisão também.

São duas famílias de regra, e a diferença entre elas importa:

- **Absolutas (R1–R7)** — verificadas por `.github/scripts/portaria-pr.mjs`,
  com regex, sem IA. Não dependem de julgamento e não podem ser negociadas por
  argumento. Se o script reprova, o check fica vermelho.
- **De julgamento (J1–J6)** — avaliadas pelo revisor de IA. Exigem entender o
  que o código faz, então não dá pra reduzir a regex.

Regra absoluta nunca fica só no julgamento do modelo. Um modelo acerta quase
sempre; "quase sempre" não serve para chave vazada.

---

## Contexto do projeto (leia antes de revisar)

ERP interno multiempresa em React + Vite + Supabase (Postgres com RLS).

- **A RLS é a única barreira de dados.** Não existe camada de backend entre o
  navegador e o banco: o front fala direto com o Supabase usando a anon key.
  Toda proteção de leitura e escrita mora em policy de RLS. Uma policy frouxa
  não é um bug de tela, é vazamento entre empresas e entre usuários.
- **Migrations não são aplicadas automaticamente.** Mergear um `.sql` na `main`
  não roda nada no Supabase — alguém roda à mão no SQL Editor. Consequência:
  editar uma migration já mergeada faz o repositório mentir sobre o estado do
  banco.
- **`tem_acesso_menu` não é visibilidade por linha.** Ele responde "este
  usuário enxerga este menu", não "esta linha é dele". Ver J1.
- **Menu novo nasce aberto.** Sem regra semeada em `perfil_acesso_permissao`,
  todo usuário autenticado enxerga. Ver J3.
- **O `.env` é versionado de propósito** e contém apenas `VITE_SUPABASE_URL` e
  `VITE_SUPABASE_ANON_KEY`. As duas são públicas por design num app Vite — vão
  para o bundle do navegador de qualquer jeito. Não trate isso como vazamento.

---

## Regras absolutas

### R1 — Nunca desabilitar RLS

`DISABLE ROW LEVEL SECURITY` expõe a tabela inteira a qualquer usuário
autenticado. Em 675 migrations o comando nunca foi usado uma vez; não há caso
legítimo previsto.

### R2 — `DROP TABLE` só em tabela temporária

Permitido em `tmp_*` e `sup_imp_*` (tabelas de carga e importação). Em tabela
de negócio, exige a válvula de escape e justificativa no corpo da PR.

### R3 — `DROP POLICY` exige `CREATE POLICY` correspondente

`DROP POLICY` seguido de `CREATE POLICY` é a rotina normal de manutenção aqui
(1296 ocorrências no histórico) e não é problema. O que a regra pega é o
**saldo**: policy removida e não recriada em nenhum arquivo da PR, o que
diminui a proteção da tabela sem substituto.

### R4 — Migration mergeada é append-only

Não modificar nem apagar arquivo que já existe em `supabase/migrations/`.
Correção vira migration nova. Motivo em "Contexto do projeto".

### R5 — Nenhum segredo real no diff

Chave `service_role` do Supabase (detectada decodificando o payload do JWT),
chave da Anthropic, token do GitHub, ou `SUPABASE_SERVICE_ROLE_KEY` com valor
atribuído no código.

A `service_role` ignora **toda** a RLS. Se uma vazar, rotacionar em Supabase →
Settings → API vem antes de qualquer outra coisa — remover do diff não basta,
porque o valor já está no histórico do git.

A anon key não entra nesta regra. Ela é pública.

### R6 — `service_role` nunca no front

Só é legítima em `supabase/functions/**`, onde roda no servidor. Em `src/**` o
código vai para o bundle do navegador, então a chave viraria pública.
Comentário mencionando `service_role` não conta como violação.

### R7 — Função `admin_*` exige chamado

Alterar `admin_exec_dml` (executa DML arbitrário) ou qualquer `admin_*` numa PR
`[SEM-CHAMADO]` é bloqueado. Essas funções mexem em vínculo de usuário,
empresa e sessão; mudança nelas precisa de rastro no ERP.

### Válvula de escape

A label `pular-revisao-ia` na PR pula as duas camadas, seguindo o mesmo padrão
da label `sem-chamado` que já existe. O uso fica registrado no log da execução
e no comentário da revisão. Use quando a regra estiver errada para aquele caso
— e, se estiver errada com frequência, corrija a regra aqui em vez de repetir
a label.

---

## Regras de julgamento

Estas dependem de entender o que o código faz.

### J1 — `tem_acesso_menu` sozinho não protege linha

Em tabela que tem dono (`user_id`, `criado_por`, `responsavel_id`,
`participante`), a policy precisa combinar `tem_acesso_menu(...)` **com** a
checagem de dono ou participante. `tem_acesso_menu` responde "este usuário
enxerga este módulo"; usado sozinho num `USING`, libera todas as linhas da
tabela para todo mundo que tem o menu — inclusive as dos outros.

Reprove uma policy nova em tabela com coluna de dono cujo `USING` só chama
`tem_acesso_menu`.

### J2 — Coluna ambígua em subquery `EXISTS` de policy

Dentro de `EXISTS (SELECT 1 FROM outra_tabela WHERE id = ...)`, uma coluna sem
qualificação pode se ligar à PK da tabela **interna** em vez da externa. O SQL
é válido, a policy é criada sem erro, e a condição fica sempre verdadeira.

Exija qualificação explícita (`externa.id`, `interna.id`) em qualquer coluna
dentro de subquery de policy. Se houver dúvida sobre o que ficou valendo de
fato, o jeito de conferir no banco é `pg_get_expr` sobre `pg_policy`.

### J3 — Menu novo tem que nascer fechado

Migration que insere em `menu` / cria `menu_codigo` novo precisa semear a
regra correspondente em `perfil_acesso_permissao` **na mesma migration**. Sem
isso o menu nasce visível para todo usuário autenticado.

Verifique também colisão de `menu_codigo` com um já existente.

### J4 — Filtro de empresa e de escopo

Sistema é multiempresa. Aponte query nova que lê tabela com `empresa_id` sem
filtrar por empresa, e `.select('*')` em tabela com dado pessoal ou financeiro
onde as colunas usadas são poucas e conhecidas.

### J5 — Comportamento novo sem teste

Existe `vitest` configurado, com testes em `src/test/`. Mudança em regra de
negócio (cálculo, alçada, validação, fluxo de aprovação) sem teste
correspondente merece observação. Não é bloqueio por si só — é o tipo de coisa
que se aponta e o autor decide.

### J6 — Resumo e veredito

Todo comentário de revisão começa com dois parágrafos curtos: **o que a PR
faz** e **se ela está boa**. Escreva para alguém que não acompanhou o trabalho.

---

## Como escrever a revisão

- Aponte a regra pelo número (`R3`, `J1`) para dar para rastrear até aqui.
- Achado precisa de arquivo, linha e o motivo de ser um problema — "esta policy
  libera as linhas dos outros usuários" vale mais que "revisar RLS".
- Não comente formatação, espaçamento, nome de variável ou preferência de
  estilo. Isso é ruído e faz o time parar de ler os comentários.
- Se a PR estiver boa, diga isso em duas linhas e pare. Revisão longa em PR boa
  treina o time a ignorar revisão.
- Na dúvida entre reprovar e observar, **observe**. Um falso positivo custa mais
  confiança do que um achado a menos: existe revisor humano depois de você.

## Vereditos

| Veredito | Quando | Efeito |
|---|---|---|
| `APROVADO` | Nenhuma regra violada. Observações menores cabem aqui. | Check verde |
| `AJUSTES` | Regra de julgamento violada, ou algo que merece correção antes do merge. | Check vermelho |
| `BLOQUEADO` | Regra absoluta violada, ou risco de vazamento de dado. | Check vermelho |
