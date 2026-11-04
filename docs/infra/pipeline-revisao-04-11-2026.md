# Revisão da pipeline — 04/11/2026

> Pedido original: *"uma pipeline que force os ajustes serem corretos, que não
> deixe passar código que faz milhares de requisições, query seca em tabela
> grande ou carrega informação desnecessária; que eu não precise revisar PR de
> junior nem fazer o papel de QA; que só passe código aprovado, com teste de
> carga e de QA."*
>
> Este documento confronta a pipeline que existe hoje com esse pedido.
> Complementa (não substitui) `docs/infra/pipeline-qualidade.md`, que descreve
> o item 13 recém-mergeado.

## Status (04/11/2026, mesmo dia)

O diagnóstico abaixo foi escrito de manhã e **a maior parte já foi aplicada à
tarde**. O que valia só como proposta está marcado como pendente.

| Furo | O que era | Estado |
|---|---|---|
| F1 | nenhum check obrigatório | **feito** — 11 checks obrigatórios, PR obrigatória, sem bypass nem para admin |
| F2 | portaria só no 1º push | **feito** — `synchronize` no `revisao_ia.yml`; a IA repete o julgamento em push de alto risco |
| F3 | label desligava a portaria | **feito** — a label vale só para o julgamento por IA |
| F4 | IA verde sem revisar | **feito** — "não produziu veredito" reprova; veredito reprovado bloqueia |
| F5 | tela quebrada passava | **feito** — `console.error`, exceção, HTTP ≥ 400 e `#root` vazio reprovam |
| F6.1 | regex não vê tabela em variável | **feito** — contrato de rede no interceptador (`infra/qa/contrato-de-rede.mjs`) |
| F6.2 | functions/worker fora das regras | **feito** — D2–D7 valem lá, mais a W1 (piso de 60 s no worker) |
| F6.3 | `tabelas-grandes.json` envelhece à mão | **pendente** — precisa de um job agendado lendo `reltuples` da produção |
| F7 | API falsa devolve `[]` | **pendente** — ver a linha nova na §5 do `pipeline-qualidade.md` |
| F8 | migration nunca executada | **parcial** — job `migracao-roda` prova a sintaxe num Postgres 18 vazio; o schema real depende dos nós |
| F9 | válvula auto-concedida, 0 aprovação | **pendente** — decisão do Eduardo: 1 aprovação ou `CODEOWNERS` |
| F10 | dívida de tipo/lint podia crescer | **feito** — catraca de tipos (total) e de lint (por arquivo tocado) |
| F11 | lógica nova sem teste passava | **pendente** |
| F12 | orçamento era teto único | **feito** — catraca por tela, com baseline publicado a cada merge |
| F13 | carga por PR | **pendente** — depende da homologação (~US$ 30/mês) |
| F14 | actions por tag, sem `npm audit` | **parcial** — a deriva do Lovable virou a regra D8; pinagem por SHA e audit pendentes |

Três regras novas de migration entraram junto, porque não é desempenho e sim a
**fila de aplicação do time**: `M4` (`CREATE OR REPLACE TRIGGER`/`POLICY`, que o
Postgres não suporta), `M5` (DDL sem `NOTIFY pgrst`) e `M6` (bloco `DO` que
consulta dado e aborta com `RAISE EXCEPTION`).

## 0. Veredito em uma linha

As regras existem e são boas — **mas nenhuma delas trava o merge**. O único
check obrigatório na `main` hoje é `validar-chamado` (o prefixo `SIS-...` no
título). `tipos`, `testes`, `build`, `migrations`, `portaria`, `revisao-ia`,
`guardiao` e `qa-requisicoes` podem estar **todos vermelhos** e o botão
"Merge pull request" continua verde.

Conferido na API do GitHub em 04/11/2026:

```
$ gh api repos/NascimentoEmpresa/appify-my-nascimento-9b345b64/branches/main/protection
required_status_checks.contexts        = ["validar-chamado"]
required_approving_review_count        = 0
```

```
$ gh api repos/.../rulesets/20794335        # o único ruleset ativo
rules = [ {"type":"deletion"}, {"type":"non_fast_forward"} ]
```

Ou seja: o ruleset ativo só impede apagar e forçar push na `main`. Toda a
engenharia de qualidade dos últimos meses está, na prática, **em modo aviso**.
A pipeline não "não deixa passar" — ela *avisa* e confia na disciplina do dev,
que é exatamente o que o pedido original queria eliminar.

---

## 1. O que a pipeline prova hoje (mapa)

19 workflows. Os que rodam em PR:

| Check | Workflow | Dispara em | Trava o merge? | O que prova |
|---|---|---|---|---|
| `validar-chamado` | `chamado_pr_sync.yml` | PR (target) | **SIM** | título tem `SIS-AAAA-NNNN:` ou `[SEM-CHAMADO]:` |
| `tipos` | `ci.yml` | open/sync/reopen/ready | não | nenhum erro de tipo nos arquivos da PR |
| `testes` | `ci.yml` | idem | não | `vitest run` (≈330 arquivos de teste) |
| `build` | `ci.yml` | idem | não | `vite build` passa |
| `migrations` | `ci.yml` | idem | não | nenhum número de versão repetido acima do corte |
| `lint (aviso)` | `ci.yml` | idem | não (por decisão) | ESLint só nos arquivos da PR |
| `portaria` | `revisao_ia.yml` | **open/reopen/ready só** | não | R1–R8 (RLS, segredo, `service_role`, branch, append-only) |
| `revisao-ia` | `revisao_ia.yml` | **open/reopen/ready só** | não | julgamento J1–J9 por modelo |
| `guardiao` | `qualidade.yml` | open/sync/reopen/ready | não | D1–D7, M1–M3 nas linhas **adicionadas** |
| `qa-requisicoes` | `qualidade.yml` | idem | não | ~340 telas: ≤60 req para abrir, 0 req sozinha em 10 min |

Pós-merge: `cluster_pos_merge.yml` aplica migration no banco1 e sobe Edge
Functions; `chamado_concluir_no_merge.yml` conclui o chamado;
`pr_registrar_painel.yml` registra no painel.

Fora do CI, existindo mas **nunca executado por PR**:
`infra/carga/carga.mjs` (teste de carga em degraus, com ponto de ruptura) e
`infra/qa/varrer-telas.mjs` (abre todas as telas e acusa `console.error` e
HTTP ≥ 400).

---

## 2. Os furos, em ordem de risco

### F1 — Nenhum gate é obrigatório *(risco: crítico · conserto: 10 minutos)*

Descrito na seção 0. É o furo que torna todos os outros teóricos. Enquanto ele
existir, a pipeline é documentação executável, não portaria.

**Conserto, pelo navegador:** GitHub → repositório →
**Settings** → **Rules** → **Rulesets** → abrir `main-1` → em
**Require status checks to pass before merging**, adicionar:
`tipos`, `testes`, `build`, `migrations`, `portaria`, `revisao-ia`,
`guardiao`, `qa-requisicoes`, `validar-chamado`. Marcar também
**Require branches to be up to date** e **Do not allow bypassing**.

**Ou por linha de comando** (um arquivo, uma chamada):

```bash
gh api -X PATCH repos/NascimentoEmpresa/appify-my-nascimento-9b345b64/branches/main/protection/required_status_checks \
  -F strict=true \
  -f 'contexts[]=validar-chamado' -f 'contexts[]=tipos' -f 'contexts[]=testes' \
  -f 'contexts[]=build' -f 'contexts[]=migrations' -f 'contexts[]=portaria' \
  -f 'contexts[]=revisao-ia' -f 'contexts[]=guardiao' -f 'contexts[]=qa-requisicoes'
```

Atenção a um detalhe que já está documentado no `revisao_ia.yml` e vale para
todos: **job pulado conta como sucesso** na proteção de branch. Por isso o
`if:` de cada job é parte da trava, não detalhe de economia (ver F3).

### F2 — Portaria e revisão de IA não rodam quando a PR recebe mais commits *(risco: crítico · conserto: 1 linha)*

`revisao_ia.yml` dispara em `types: [opened, reopened, ready_for_review]` —
**não em `synchronize`**. Consequência prática, e ela é grave assim que F1 for
corrigido: abre-se a PR com uma linha inofensiva, a portaria fica verde, e
**todo o código real entra nos pushes seguintes sem nunca passar por R1–R8**.
`DISABLE ROW LEVEL SECURITY`, `service_role` em `src/**`, chave vazada,
migration antiga editada — nada disso é verificado de novo.

**Conserto:** acrescentar `synchronize` ao `types:` do `revisao_ia.yml`. Para a
portaria (regra determinística, custo ~15 s) isso é obrigatório. Para a
`revisao-ia` (que consome cota de modelo) o caminho barato é separar os dois
workflows: portaria em todo push, revisão de IA em `opened` + sob a label
`revisar-de-novo`, ou em `synchronize` com `concurrency: cancel-in-progress`
(que já existe) para não pagar por push intermediário.

### F3 — A label `pular-revisao-ia` desliga a portaria inteira *(risco: alto · conserto: 1 linha)*

O `if:` do job `portaria` inclui
`!contains(github.event.pull_request.labels.*.name, 'pular-revisao-ia')`.
Como job pulado conta como sucesso, **qualquer pessoa que possa aplicar label
na PR desliga R1–R8 e fica verde**. A label foi criada para poupar cota de
modelo, não para liberar as regras absolutas.

**Conserto:** tirar a condição da label do job `portaria` (manter no
`revisao-ia`). A portaria não usa modelo, não tem cota, roda em segundos.

### F4 — A revisão de IA fica verde sem ter revisado *(risco: alto · conserto: meia hora)*

Já conhecido e documentado: com a cota da assinatura pessoal esgotada, a ação é
recusada na porta (custo 0, 1 turno), o step tem `continue-on-error: true` e o
check termina **verde**. O workflow hoje explica isso num comentário na PR —
mas o comentário não trava nada, e ninguém lê comentário de check verde.

**Conserto, em duas partes:**
1. Cadastrar `ANTHROPIC_API_KEY` (crédito pré-pago, separado da assinatura) em
   Settings → Secrets and variables → Actions. O workflow já dá precedência a
   ela.
2. Fazer o step final **reprovar** quando `veredito.json` não existir e o risco
   não for `nenhum`. "Não revisou" tem que ser vermelho, não verde. Com F1
   aplicado, isso para o merge; com a chave de API cadastrada, praticamente
   nunca acontece.

### F5 — O `qa-requisicoes` premia a tela quebrada *(risco: alto · conserto: 1-2 horas)*

O job mede **quantidade de requisições**. Uma tela que explode no primeiro
render (import errado, erro de runtime, `ErrorBoundary`) faz *menos*
requisições que a tela sadia — e **passa**. O `goto` ainda está dentro de um
`try { } catch { /* registra o que deu */ }` que engole a falha de navegação.
Nada no job olha `console.error`, exceção de página ou resposta ≥ 400.

O mais frustrante é que a ferramenta certa **já existe no repositório**:
`infra/qa/varrer-telas.mjs` faz exatamente isso, mas só roda à mão contra a
produção, com token real.

**Conserto:** incorporar as duas asserções ao `orcamento-requisicoes.mjs` (mesma
build, mesmo navegador, custo adicional ≈ zero):

```js
pagina.on("console",   (m) => m.type() === "error" && erros.push(m.text()));
pagina.on("pageerror", (e) => erros.push(String(e)));
// e, ao final: if (erros.length) problemas.push(`${erros.length} erro(s) no console`);
```

Mais uma asserção que fecha o buraco do `try/catch`: se o `goto` falhar ou a
tela não renderizar nenhum elemento próprio (nem título, nem conteúdo),
reprovar — "tela branca" é defeito, não ausência de defeito.

### F6 — O guardião é cego fora de `src/` e fora do nome literal da tabela *(risco: alto · conserto: 1 dia)*

O `guardiao-desempenho.mjs` é regex sobre linha adicionada. Escapam:

- **`.from(tabela)` com variável, constante ou template** — o regex só casa
  `.from("NOME")` literal. `const T = "EMPREGADOS"; supabase.from(T)` passa.
- **Hook ou helper intermediário** — `useLista("EMPREGADOS")` passa.
- **`supabase/functions/**` e `worker/**`** — as regras de frontend exigem
  `caminho.startsWith("src/")`. Edge Function que varre tabela grande, ou worker
  com `setInterval` de 5 s batendo no banco, não é olhado por regra nenhuma.
  (O worker *é* polling por natureza, mas o intervalo e o `select` deveriam ter
  teto.)
- **`.rpc(...)` sem limite** — nenhuma regra olha RPC, e a maior parte das
  leituras pesadas do ERP hoje é RPC.
- **`tabelas-grandes.json` é uma foto de 03/11/2026**, feita à mão. Tabela que
  cruzar as 2.000 linhas depois disso deixa de ser protegida em silêncio, e
  ninguém é avisado.

**Conserto, em ordem de retorno:**

1. **Medir em vez de adivinhar** (pega tudo que o regex não pega): o
   `qa-requisicoes` já intercepta cada requisição. Dentro do interceptador,
   reprovar quando a URL for `GET /rest/v1/<tabela grande>` **sem** `limit=`,
   `offset=` nem header `Range`, ou **com** `select=*`. Isso vale para chamada
   dinâmica, via hook, via biblioteca — porque observa o que saiu pela rede, não
   o texto do código. É o complemento natural de D5/D6.
2. Estender as regras de frontend a `supabase/functions/**` e `worker/**`, com
   um teto explícito de intervalo no worker.
3. Transformar `tabelas-grandes.json` em arquivo **gerado por workflow
   agendado** (semanal, lendo `reltuples` da produção, abrindo PR quando
   mudar). Lista curada à mão envelhece e vira falso verde.

### F7 — A API falsa devolve sempre `[]`: nenhuma tela é medida com dado *(risco: médio · conserto: 1 dia)*

Com todas as respostas vazias, nenhuma tela exercita render de lista, soma no
navegador ou gráfico. Justamente a classe de defeito que o post-mortem aponta
como raiz da Fluxo de Caixa de 17,9 MB (total calculado no cliente) é
**invisível** para o QA atual — está em J9, delegada ao revisor humano/IA.

**Conserto:** a resposta falsa passa a devolver N linhas sintéticas (p. ex. 5.000
para tabela grande, respeitando o `Range` que a tela pediu) e o job passa a
medir, além de requisições: bytes recebidos por tela, tempo até interativo, e
pico de memória. Reprova quem pedir sem janela de paginação ou estourar um
orçamento de bytes. É o único jeito de a máquina provar "não carrega
informação desnecessária" — hoje ela só prova "não pede muitas vezes".

### F8 — Nenhuma migration é executada antes do merge *(risco: médio-alto · conserto: 1-2 dias)*

Hoje a migration é **lida por regex** (M1/M2/M3) e aplicada **direto na
produção no merge** (`cluster_pos_merge.yml`). Entre as duas coisas não existe
nenhuma execução de verdade. Escapam: erro de sintaxe, `CREATE OR REPLACE` em
trigger/policy, função que não compila, âncora de texto que nunca casa por
CRLF, policy que referencia coluna inexistente, migration que depende de outra
que ainda não entrou. Tudo isso só aparece quando o aplicador para a fila —
e quando ele para, **para para o time inteiro**.

**Conserto barato (sem homologação):** job novo que (a) baixa o dump **só de
schema** da produção, publicado por um workflow agendado noturno; (b) sobe um
Postgres 18 em container no runner; (c) restaura o schema; (d) aplica **apenas
as migrations novas da PR**, com `lock_timeout`; (e) falha com o erro do
Postgres na linha. Bônus quase grátis no mesmo container: `EXPLAIN` das
consultas da policy nova, para reprovar varredura completa (M1 deixa de ser
regex e passa a ser medição).

Isto está listado como lacuna na seção 5 do `pipeline-qualidade.md`, onde a
conclusão foi "precisa de homologação". Precisa de homologação para **carga**;
para *provar que a migration roda*, um container efêmero com dump de schema já
resolve, e é o item de melhor retorno depois de F1–F5.

### F9 — Zero revisão humana exigida + válvula auto-concedida *(risco: médio · conserto: 20 minutos)*

`required_approving_review_count = 0` e a válvula `guardiao-ok: <motivo>` é
escrita pelo próprio autor da PR. Juntas: o junior que levar vermelho do
guardião pode escrever `guardiao-ok: precisa ser assim` e seguir. A liberação
fica listada no resumo — mas, sem revisor obrigatório, ninguém precisa
concordar com o motivo.

**Conserto:** exigir 1 aprovação (ou `CODEOWNERS` apenas para
`supabase/migrations/**`, `src/lib/acesso.ts`, `.github/**`); **ou**, se o
objetivo é não depender de revisão humana, fazer o guardião **exigir label**
(`desempenho-liberado`, aplicável só por quem tem permissão) em vez de
comentário no código. A válvula atual presume um revisor que o repositório não
exige.

### F10 — Sem catraca: dívida de tipo e de lint pode crescer *(risco: médio · conserto: 2 horas)*

`tipos` só reprova erro em arquivo que a PR tocou; `lint` nunca reprova. A
decisão é correta (travar nos ~180 erros de tipo e 2.585 de lint pararia o
time), mas falta a metade que impede a piora: hoje nada impede o número total
de subir.

**Conserto:** gravar o total na `main` (artefato ou arquivo versionado
`.github/baseline-qualidade.json`) e reprovar a PR que **aumentar** o total,
mesmo fora dos arquivos dela. Catraca só desce. Mesma mecânica serve para
contagem de `any`, de `select("*")` e de telas acima de 40 requisições.

### F11 — Lógica nova sem teste passa *(risco: médio · conserto: 3 horas)*

São ~330 arquivos de teste e a cultura existe — mas nenhum check cobra. PR que
cria `src/lib/novaRegraDeAlcada.ts` sem um `.test.ts` é verde. Sem QA na
empresa, teste de regra de negócio é o único QA funcional que existe.

**Conserto:** job que reprova quando a PR adiciona ou altera arquivo em
`src/lib/**` ou `src/hooks/**` (onde moram as regras) **sem** tocar nenhum
`src/test/**`. Válvula por label, como as outras. Mais exato, se quiserem ir
além: cobertura por diff (`vitest --coverage` + `diff-cover`), reprovando abaixo
de um piso nas linhas novas.

Observação registrada em sessão anterior e que afeta este job: `vitest` com
`singleFork` produz falhas que desaparecem rodando isolado. Se a suíte ficar
obrigatória (F1), vale antes confirmar a estabilidade dela em 10 execuções
seguidas — check obrigatório que falha sozinho é a maneira mais rápida de o
time pedir para desligar a pipeline.

### F12 — Orçamento de requisições é teto único, não baseline por tela *(risco: baixo-médio · conserto: 2 horas)*

Limite fixo de 60 e média atual de 42,2. Uma tela de 20 requisições pode chegar
a 59 sem ninguém notar: a piora de 3x fica dentro do orçamento.

**Conserto:** gravar o número de cada tela na `main` (o job já grava
`orcamento.json`, hoje artefato de 14 dias) e reprovar aumento relativo (p. ex.
+25% ou +8 requisições) além do teto absoluto. É a mesma catraca de F10
aplicada a desempenho.

### F13 — Teste de carga por PR: só com homologação *(risco: conhecido · custo: ~US$ 30/mês)*

`infra/carga/carga.mjs` é maduro (modelo aberto, degraus, p95, sonda de
`sistema_saude`, parada automática no ponto de ruptura) e não roda em PR porque
só existe produção. A conclusão da seção 5 do `pipeline-qualidade.md` continua
valendo e é o próximo passo de maior retorno depois de F1–F5 e F8: uma VM com
cópia noturna sem dado pessoal destrava carga por PR, `EXPLAIN` com dado real e
o `npm run dev` do dev deixar de apontar para a produção (15,8 mil requisições
vindas de `localhost` em 03/11).

Meio-caminho possível enquanto não houver homologação: rodar `carga.mjs`
**agendado** (madrugada, contra a produção, nos degraus baixos já conhecidos) e
alertar na regressão de p95. Não barra PR, mas mede tendência — hoje não há
medida nenhuma de capacidade entre um incidente e o próximo.

### F14 — Cadeia de suprimento e deriva do Lovable *(risco: baixo · conserto: 2 horas)*

- Actions referenciadas por tag (`actions/checkout@v6`), não por SHA. Tag é
  mutável; em repositório **público** com secrets de produção, pinar por SHA é
  barato.
- Nenhum check de dependência (`npm audit`, lockfile adulterado, pacote novo
  sem revisão). Um `npm ci` + `npm audit --audit-level=high` como aviso, e
  reprovar quando o diff adiciona dependência sem menção no corpo da PR.
- O Lovable regenera `src/integrations/supabase/client.ts` com credencial
  hardcoded (está no `CLAUDE.md`). Hoje isso depende de alguém lembrar de
  reaplicar o `env.ts`. É uma regra determinística de duas linhas no guardião:
  reprovar URL/chave literal em `src/integrations/**`.

---

## 3. Ordem de execução sugerida

| Onda | Itens | Esforço | Efeito |
|---|---|---|---|
| **Hoje** | F1 (tornar obrigatório), F2 (`synchronize`), F3 (label), F4.1 (chave de API) | ~1 hora | a pipeline que já existe passa a valer. É aqui que está 80% do retorno |
| **Esta semana** | F5 (tela com erro reprova), F6.1 (asserção na rede), F4.2 (não revisou = vermelho), F9 (válvula com label ou 1 aprovação) | ~2 dias | fecha os furos que deixariam passar exatamente o que derrubou a produção em 03/11 |
| **Este mês** | F8 (migration em container), F10/F12 (catracas), F11 (teste obrigatório para regra nova), F6.2/F6.3, F14 | ~1 semana | tira as últimas decisões de "o dev lembrou?" |
| **Quando houver verba** | F13 (homologação ~US$ 30/mês) + carga por PR + `EXPLAIN` com dado real, F7 (API falsa com dado) | 1 semana + custo mensal | completa o pedido original: carga e QA de verdade por PR |

## 4. O que **não** mudar

- **Lint continuar não travando.** 2.585 erros; travar hoje deixa toda PR
  vermelha no primeiro minuto e o time desliga a pipeline inteira. A catraca
  (F10) é a resposta certa.
- **`tipos` continuar só nos arquivos da PR.** Mesmo motivo. Com catraca, a
  dívida antiga nunca mais cresce.
- **O corte de data no check `migrations`.** Os 254 pares duplicados antigos
  são herança do Lovable; cobrar a história inteira deixa todo merge vermelho.
- **Os quatro jobs paralelos do `ci.yml` e o cache do `.tsbuildinfo`.** Medidos,
  documentados, e a diferença é 8min30 → ~1min. Ao acrescentar jobs novos
  (F8, F11), manter esse padrão: cache de `node_modules` por `package-lock.json`
  e `if:` que pula o job quando a PR não toca a área.
- **`pull_request_target` sem checkout** nos workflows que precisam de secret.
  Está correto e é a única forma segura num repositório público.
