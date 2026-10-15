# Onde estamos — manhã de 15/10/2026

Relatório deixado na noite de 14/10 para você encontrar pronto. Leia os três
primeiros itens antes de qualquer outra coisa; o resto é contexto.

---

## 🔴 1. PRIMEIRA COISA: destravar a replicação (1 comando, ~3 min)

**Estado:** a replicação lógica da produção para o cluster está **parada**
desde 20h09 de 14/10, por conflito de chave. O WAL está preso na produção e
crescendo a **304 MB/h** medidos.

**Por que é a primeira coisa:** na medição de 14/10 às 21h a produção tinha
~2,2 GB livres de 5,9 GB. A 304 MB/h isso enche em **cerca de 7 horas**.
Disco cheio no Postgres não é lentidão — é a produção parando de gravar.

> Se ao abrir isto o ERP estiver fora do ar ou recusando salvar, **esta é a
> causa mais provável.** O conserto abaixo libera o WAL e a produção volta.

**Onde:** Git Bash, na pasta do projeto, no seu PC.

```bash
bash infra/ha/disparar-conflito.sh --aplicar CHAMADO_SISTEMA_LEITURA
```

**O que vai aparecer na tela, em ordem:**

```
== tabela: public.CHAMADO_SISTEMA_LEITURA
== chave primaria: chamado_id,user_id
=== 3 linha(s) divergente(s) no cluster ===
=== FASE 1: apagando as divergentes do cluster ===
=== derrubando o trabalhador para a proxima tentativa pegar a chave livre ===
=== esperando o atraso zerar (ate 3 min) ===
   aplicando de novo: LSN 0/BCD..., atraso 0 bytes
=== FASE 2: recopiando da producao o que ficou faltando ===
=== reaplicando a trava de escrita (secao 1.9) ===
   public.CHAMADO_SISTEMA_LEITURA: IDENTICA nos dois lados (997 linhas)
   slot na producao: 0 bytes, ativo=t
```

A linha que importa é a última: **`0 bytes, ativo=t`**. Se vier diferente,
rode o comando de novo — a produção pode ter escrito mais durante o conserto.

**Por que eu não fiz:** o classificador do modo automático bloqueou a escrita
no cluster duas vezes (*Modify Shared Resources* e depois *Auto-Mode Bypass*).
Não contornei. O script está escrito, revisado e com a fase de conferência
testada contra o estado real — só a execução precisa de você.

### Por que isso aconteceu — e é importante você saber

Eu disse que o cluster estava "somente-leitura" e que o seu teste no navegador
não escreveria nada. **Estava errado.** Abrir três chamados gravou três linhas
em `CHAMADO_SISTEMA_LEITURA`, porque a marcação de "lido" passa por função
`SECURITY DEFINER` — que roda com o privilégio do **dono**, não do usuário, e
portanto ignora o `REVOKE` que eu havia aplicado.

Medido depois:

| | |
|---|---|
| funções em `public` | 1.532 |
| `SECURITY DEFINER` | 1.124 |
| …que escrevem | 418 |
| …que escrevem **e** `anon`/`authenticated` podem chamar | **372** |

São 372 portas que a trava não encosta. O seu teste foi correto e valioso —
quem errou foi a minha afirmação de que ele era inócuo.

---

## 🟡 2. Mergear a PR #877

<https://github.com/NascimentoEmpresa/appify-my-nascimento-9b345b64/pull/877>

Sete checks verdes, `MERGEABLE`. O título e o corpo foram reescritos ontem à
noite, porque o conteúdo cresceu muito depois de ela ser aberta.

⚠️ A `revisao-ia` passou **sem revisar** — cota da assinatura pessoal
esgotada. O check fica verde de qualquer jeito, então não conte com ele.

---

## 🟡 3. Teste de failover (1 comando, ~3 min)

Último teste diurno pendente. **Impacto zero nos usuários hoje:** eles falam
com a Supabase; este cluster roda em paralelo e o único usuário da
`api.grpnascimento.com.br` somos nós.

```bash
bash infra/ha/testar-failover.sh
```

Ele sobe uma sonda de 0,4 s **antes** de mexer em nada, troca o líder
`banco2 → banco1`, mede, espera 20 s e devolve `banco1 → banco2`, deixando o
cluster como estava. O número que interessa aparece assim:

```
>>> JANELA DE INDISPONIBILIDADE: 2.4 s
```

**Por que você e não eu:** o `patronictl switchover` também foi bloqueado para
mim (*Modify Shared Resources*).

Se no fim ele disser `assinatura: NULO`, rode
`bash infra/ha/disparar-sincronia.sh --aplicar` — o trabalhador da replicação
é um processo e processo não migra de nó junto com a liderança.

---

## O que mudou ontem à noite, em uma tabela

| | Antes | Agora |
|---|---|---|
| schema do cluster vs produção | **44 funções, 5 triggers, 2 views, 3 restrições, 3 NOT NULL e 1 índice de diferença** | `TUDO IGUAL` nos 6 blocos |
| publicação | 646 tabelas | **647** |
| conferidores antes da virada | 1 | **3** (colunas, schema, conflito) |
| "cluster é somente-leitura" | afirmado | **corrigido: falso por 372 portas** |
| teste de failover | sem ferramenta | 1 comando, mede a janela |

O achado de maior consequência: **o `sincronizar-colunas.sh` destrava a
replicação, não sincroniza o schema.** Ele acrescenta a coluna crua e deixa
para trás o `NOT NULL`, o `CHECK`, a FK, o índice, a view, a função e o
trigger. E a replicação continua verde, porque nada disso lhe interessa — os
números diziam `647 de 647, 0 bytes` enquanto faltavam **12 funções do módulo
Treinamentos**, cujas tabelas nós havíamos trazido com todo o cuidado.

O módulo Treinamentos abriria quebrado na virada e nenhum número reclamaria.

---

## Estado do sistema agora

```
PRODUÇÃO (o que os usuários usam)
  ERP                      no ar, intocado          app.grpnascimento.com.br
  slot erp_corte           254 MB PRESO, inativo    <-- item 1 resolve
  disco                    ~2,2 GB livres de 5,9 GB

CLUSTER (paralelo, ninguém usa ainda)
  Patroni                  banco2 líder, banco1 sync standby, lag 0, TL 6
  API                      https://api.grpnascimento.com.br -> 200
  schema                   IDÊNTICO à produção (conferido nos 6 blocos)
  escrita anon/auth        REVOGADA (0 permissões diretas)
  assinatura               647 tabelas, parada no conflito
  anexos                   11.252 no cluster x 11.581 na produção (delta 329)

FRONTEND
  app.grpnascimento.com.br 200, certificado válido
  *.lovable.app/app        302 para o domínio próprio
  aceitação pelo navegador APROVADA por você em 14/10
```

---

## O que falta para o Marco B (a virada)

Marco B é a **única** etapa fora do horário comercial. Nada abaixo precisa ser
feito antes de os três itens do topo estarem resolvidos.

| | O que | Quando |
|---|---|---|
| 1 | os três conferidores dizendo "nada divergente" | imediatamente antes |
| 2 | congelar escrita na produção (`REVOKE`) | início da janela |
| 3 | esperar lag zero e parar a assinatura | depois do congelamento |
| 4 | **`GRANT` de volta no cluster** (seção 1.9) | antes de liberar ninguém |
| 5 | dump de `auth` e `storage` | não vêm por replicação |
| 6 | **delta final dos anexos** (hoje 329, ~316/dia) | imediatamente antes |
| 7 | trocar o `.env` por commit no `main` | o ponto de virada |
| 8 | aceitação pelo navegador | antes de liberar |
| 9 | ponto sem volta | — |

Impacto nos usuários nessa noite: **um relogin**. O token de hoje é assinado
pela Supabase e o cluster assina com outra chave. Fora isso, a janela de dois
mundos fica coberta pelo congelamento de escrita do passo 2.

Roteiro completo e atualizado: [`docs/ha-corte-roteiro.md`](ha-corte-roteiro.md)
— seções **1.9 corrigida**, **1.10** (conflito de chave) e **1.11** (schema)
são novas de ontem.

---

## 🟡 4. O worker morreu — e eu deixei desligado de propósito

O worker de alertas parou em algum momento depois das **17h16** de 14/10 (é a
hora do último `scripts/status-banco.txt`). Nenhum processo dele estava vivo
às 21h40.

**Consequência de ontem:** nenhum alerta por DM no Discord durante a noite —
inclusive o do slot, que é exatamente o que avisaria sobre o item 1.
Compensei com uma notificação direta para você.

**Por que não religuei:** fila com 11 itens pendentes, e um deles manda
mensagem de verdade:

| Destino | Pendentes | O que faz |
|---|---|---|
| `novidade-ia-chamado` | 9 (desde 06/10) | só insere em `SISTEMA_NOVIDADES`, não envia nada |
| `whatsapp-retomada-tick` | 1 (14/10 20:20) | **pode disparar WhatsApp de verdade** |
| `comite-etica-nova-denuncia` | 1 (13/10 10:41) | morre em `500 — SMTP não configurado` |

Eram 21h40. Religar poderia mandar WhatsApp noturno para um colaborador, e
isso é decisão sua, não minha. Para religar:

```
worker\worker-servico.bat
```

(no PowerShell, na pasta do projeto)

---

## Pendências menores, sem pressa

- **SMTP do comitê de ética quebrado.** `HTTP 500 — SMTP não configurado
  (SMTP_HOST/USER/PASS)`. A denúncia de 13/10 10h41 não avisou ninguém, e
  nenhuma vai avisar até os secrets serem configurados na Edge Function. Há
  31 alertas pendentes e **zero** `COMITE_ETICA_RESPONSAVEL` ativo.
- **`revisao-ia` passa sem revisar** — precisa de `ANTHROPIC_API_KEY` própria,
  não da sua assinatura pessoal.
- **Certificado A1 da NF-e vencido** há 33 dias (12/09). SEFAZ devolve 403 em
  todo ciclo.
- **Duas sessões automáticas não rodaram** (SIS-2026-0649 e SIS-2026-0663):
  `'claude.cmd' não é reconhecido`. O cursor avançou — se quiser os planos,
  rode `/chamado 0649` e `/chamado 0663` na mão.
- **`api.grpnascimento.com.br` aponta só para o `banco1`.** Se o banco1 cair
  inteiro, o banco pode assumir no banco2 mas o endereço HTTP morre. Decisão
  em aberto, e não bloqueia o Marco B.
- **Domínio no seu CPF**, vencendo 27/02/2027 — vale transferir para o CNPJ.
