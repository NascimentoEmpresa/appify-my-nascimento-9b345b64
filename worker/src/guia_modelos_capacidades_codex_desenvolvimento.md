# Guia completo --- Modelos e capacidades do Codex para desenvolvimento

> Atualizado em 24/08/2026 com base na documentação oficial da OpenAI. O
> foco deste material é o uso do Codex em desenvolvimento de software.

## 1. Codex não é um único modelo

O **Codex** é o agente/ambiente de programação. O **modelo** é o
"cérebro" que o Codex usa para raciocinar e executar a tarefa.

``` text
CODEX
├── CLI / IDE / app / cloud
├── leitura e edição de arquivos
├── terminal e ferramentas
├── Git
├── Skills / MCP
└── MODELO
    ├── GPT-5.6 Sol
    ├── GPT-5.6 Terra
    ├── GPT-5.6 Luna
    └── modelos anteriores disponíveis
```

No Codex CLI, use:

``` text
/model
```

para escolher o modelo. Na versão atual que estamos analisando, a
interface oferece GPT-5.6 Sol, GPT-5.6 Terra, GPT-5.6 Luna, GPT-5.5 e
GPT-5.2.

A recomendação atual da OpenAI é começar pela família GPT-5.6.

------------------------------------------------------------------------

## 2. Sol vs. Terra vs. Luna

  -----------------------------------------------------------------------
  Modelo                  Posicionamento oficial  Uso típico em
                                                  desenvolvimento
  ----------------------- ----------------------- -----------------------
  **GPT-5.6 Sol**         Frontier / maior        Arquitetura, bugs
                          capacidade              difíceis, refatorações
                                                  grandes, tarefas
                                                  agentic longas

  **GPT-5.6 Terra**       Equilíbrio              Desenvolvimento diário,
                          inteligência/custo      CRUD, APIs, testes,
                                                  manutenção

  **GPT-5.6 Luna**        Eficiência e alto       Mudanças simples,
                          volume                  tarefas repetitivas,
                                                  documentação, correções
                                                  mecânicas
  -----------------------------------------------------------------------

Forma simples de memorizar:

``` text
SOL   → máxima capacidade
TERRA → equilíbrio
LUNA  → eficiência
```

Isso não significa que Luna não programe bem ou que Terra não consiga
analisar arquitetura. São pontos diferentes na curva capacidade ×
eficiência.

------------------------------------------------------------------------

# 3. GPT-5.6 Sol

**Model ID:** `gpt-5.6-sol`

O alias `gpt-5.6` aponta para Sol.

A OpenAI o classifica como modelo frontier para trabalho profissional
complexo e recomenda Sol quando a prioridade é capacidade máxima em
raciocínio e coding.

### Especificações documentadas

``` text
Context window: 1.050.000 tokens
Máximo de saída: 128.000 tokens
Knowledge cutoff: 16/02/2026
Reasoning: none, low, medium, high, xhigh, max
```

Conforme a superfície/API utilizada, a família suporta recursos agentic
e ferramentas como function calling, structured outputs, busca,
arquivos, shell, apply patch, Skills, computer use e MCP.

### Quando usar Sol

Use Sol quando uma decisão errada custa mais do que usar um modelo mais
capaz.

#### Exemplo --- arquitetura

``` text
Temos um ERP monolítico Node.js/PostgreSQL com 150 endpoints.

Analise a arquitetura e proponha uma migração gradual para
uma arquitetura modular sem interromper produção.

Considere autenticação, transações, migrations, testes,
observabilidade e rollback.
```

#### Exemplo --- bug difícil

``` text
Nossa API apresenta race condition quando duas requisições
de aprovação atingem simultaneamente o mesmo contrato.

Investigue controller, service, repository e transações PostgreSQL,
reproduza o problema, identifique a causa e implemente uma correção.
```

#### Exemplo --- execução agentic longa

``` text
Leia PLAN.md.
Implemente integralmente a especificação.
Execute migrations.
Implemente backend e frontend.
Crie testes.
Rode lint, typecheck e testes.
Corrija falhas.
Não faça commit.
Finalize somente quando os critérios de aceite forem satisfeitos.
```

------------------------------------------------------------------------

# 4. GPT-5.6 Terra

**Model ID:** `gpt-5.6-terra`

A OpenAI descreve Terra como o modelo que equilibra inteligência e
custo. Ele ocupa aproximadamente o posicionamento "mini" das famílias
anteriores.

### Especificações

``` text
Context window: 1.050.000 tokens
Máximo de saída: 128.000 tokens
Knowledge cutoff: 16/02/2026
Reasoning: none, low, medium, high, xhigh, max
```

### Quando usar Terra

É um excelente candidato para desenvolvimento cotidiano.

#### Exemplo --- endpoint

``` text
Crie GET /usuarios/:id.

Siga:
routes -> controller -> service -> repository.

Retorne 404 quando não existir.
Crie testes unitários e de integração.
```

#### Exemplo --- CRUD

``` text
Implemente CRUD de fornecedores.

Campos:
nome
cnpj
email
telefone
status

Siga as convenções existentes.
Crie migration, model, service, controller, routes e testes.
```

#### Exemplo --- bug comum

``` text
POST /contratos retorna 500 quando dataFim é null.

Encontre a causa, corrija sem quebrar contratos existentes
e crie teste de regressão.
```

------------------------------------------------------------------------

# 5. GPT-5.6 Luna

**Model ID:** `gpt-5.6-luna`

Luna é otimizado para workloads sensíveis a custo e de alto volume.
Ocupa aproximadamente o posicionamento "nano" das famílias anteriores.

### Especificações

``` text
Context window: 1.050.000 tokens
Máximo de saída: 128.000 tokens
Knowledge cutoff: 16/02/2026
Reasoning: none, low, medium, high, xhigh, max
```

### Quando usar Luna

Tarefas claras, repetitivas ou de baixo risco.

#### Exemplo --- alteração simples

``` text
Altere "Cadastrar" para "Cadastrar usuário".
Não faça nenhuma outra alteração.
```

#### Exemplo --- testes repetitivos

``` text
Crie testes unitários para estes 12 validators seguindo
exatamente o padrão dos testes existentes.
```

#### Exemplo --- documentação

``` text
Leia as rotas do módulo de usuários e atualize a tabela
de endpoints em docs/api.md.
```

#### Exemplo --- refatoração mecânica

``` text
Substitua imports relativos de utils pelo alias @utils,
seguindo tsconfig.json. Não altere comportamento.
```

------------------------------------------------------------------------

# 6. Escolha rápida para desenvolvimento

  Demanda                      Escolha inicial
  ---------------------------- -----------------
  Renomear componente          Luna
  Corrigir CSS simples         Luna
  Documentar endpoints         Luna
  Testes repetitivos           Luna
  Criar CRUD                   Terra
  Criar endpoint + testes      Terra
  Integração REST comum        Terra
  Refatoração localizada       Terra
  Bug intermitente difícil     Sol
  Refatorar autenticação       Sol
  Projetar RBAC                Sol
  Migração arquitetural        Sol
  Grande execução de PLAN.md   Sol

São recomendações práticas, não limitações rígidas.

------------------------------------------------------------------------

# 7. Reasoning Effort

Modelo e esforço de raciocínio são coisas diferentes.

``` text
GPT-5.6 Sol low
│           │
modelo      reasoning effort
```

GPT-5.6 documenta:

``` text
none
low
medium
high
xhigh
max
```

A disponibilidade exata na interface pode depender do
produto/plano/configuração.

### none

Prioriza latência.

``` text
Corrija o typo "Usuairo" para "Usuário".
```

### low

Bom para tarefas claras.

``` text
Adicione validação para impedir email vazio e crie o teste.
```

### medium

Ponto equilibrado para tarefas que exigem análise.

``` text
Implemente paginação em /contratos mantendo compatibilidade
com clientes existentes.
```

### high

Para investigação e decisões difíceis.

``` text
Descubra por que transações ficam abertas no PostgreSQL
e provocam esgotamento do pool.
```

### xhigh

Para problemas particularmente difíceis.

``` text
Refatore autorização para RBAC preservando permissões atuais.
Analise migrations, middleware, rotas e testes antes de implementar.
```

### max

Maior nível documentado para GPT-5.6.

``` text
Planeje e execute uma migração arquitetural envolvendo banco,
autenticação, filas, consistência, observabilidade, rollout e rollback.
```

------------------------------------------------------------------------

# 8. Mais reasoning não é automaticamente melhor

Não faz sentido usar:

``` text
Sol + max
```

para:

``` text
Troque margin-top: 10px por 12px.
```

Estratégia prática:

``` text
fácil        → Luna/Terra + low
normal       → Terra/Sol + medium
difícil      → Sol + high
muito difícil→ Sol + xhigh
excepcional  → Sol + max
```

A OpenAI recomenda configurar reasoning intencionalmente e testar níveis
menores: GPT-5.6 frequentemente mantém boa qualidade com menos reasoning
em workloads adequados.

------------------------------------------------------------------------

# 9. Context window de 1,05 milhão

Sol, Terra e Luna documentam:

``` text
1.050.000 tokens
```

Contexto pode conter:

``` text
instruções
+ histórico
+ código lido
+ resultados de ferramentas
+ documentação
+ AGENTS.md
+ conteúdo retornado por integrações
```

Isso **não** significa que o Codex lê automaticamente 1 milhão de tokens
do repositório. É capacidade máxima do modelo.

### Exemplo

``` text
ERP/
├── frontend/
├── backend/
├── database/
├── tests/
├── docs/
└── AGENTS.md
```

Demanda:

``` text
Investigue por que um usuário consegue aprovar uma compra
acima da própria alçada.
```

O agente pode precisar correlacionar:

``` text
AGENTS.md
→ rota
→ controller
→ service
→ middleware
→ permissões
→ model
→ migration
→ testes
```

Uma janela grande ajuda bastante em tarefas agentic multi-arquivo.

------------------------------------------------------------------------

# 10. Máximo de saída: 128K

A família GPT-5.6 documenta até 128.000 tokens de saída.

Isso é um teto, não uma meta. O Codex não precisa produzir respostas
gigantes.

Em coding agentic, o trabalho pode ser:

``` text
analisar
→ executar comando
→ ler resultado
→ editar
→ testar
→ observar erro
→ corrigir
→ testar novamente
```

Não avalie o trabalho do Codex somente pelo tamanho da mensagem final.

------------------------------------------------------------------------

# 11. Knowledge cutoff

Os três modelos documentam:

``` text
16/02/2026
```

Mas o Codex pode trabalhar com informação posterior quando ela entra
via:

``` text
código atual
documentação do repositório
arquivos
MCP
web/ferramentas quando disponíveis
```

Se seu projeto usa uma biblioteca recente, é melhor fornecer/consultar
documentação atual do que depender somente da memória do modelo.

------------------------------------------------------------------------

# 12. Capacidade agentic

O modelo fornece inteligência; o Codex fornece o harness de execução.

``` text
GPT-5.6
   ↓
CODEX
   ├── lê arquivos
   ├── pesquisa código
   ├── executa shell
   ├── edita
   ├── aplica patches
   ├── roda testes
   ├── usa Git
   ├── usa Skills
   └── usa integrações configuradas
```

O ciclo típico é:

``` text
objetivo
→ investigar
→ planejar
→ editar
→ executar testes
→ observar
→ corrigir
→ validar
→ entregar
```

Isso é o que significa **agentic coding**.

------------------------------------------------------------------------

# 13. Imagens e frontend

Os modelos GPT-5.6 documentam texto como entrada/saída e imagem como
entrada.

Exemplo:

``` text
A interface deveria ficar como este screenshot.
Analise o React atual e ajuste layout, responsividade
e hierarquia visual mantendo nosso design system.
```

A orientação oficial do GPT-5.6 também destaca melhorias em estética de
frontend, layout, hierarquia visual e julgamento de design.

Exemplo adequado para Sol:

``` text
Refatore este dashboard React.

Melhore:
- hierarquia visual;
- densidade;
- responsividade;
- estados vazios;
- loading;
- acessibilidade;
- consistência dos componentes.

Mantenha o design system atual.
```

------------------------------------------------------------------------

# 14. GPT-5.5, GPT-5.2 e modelos anteriores

Sua interface também pode oferecer modelos anteriores para
compatibilidade, workflows já validados ou comparação.

Eles podem fazer sentido quando:

``` text
- você quer reproduzir comportamento antigo;
- possui benchmark interno naquele modelo;
- uma automação foi validada nele;
- precisa comparar regressões;
- está migrando configurações.
```

Para projetos novos, a orientação atual é começar pela família GPT-5.6.

Historicamente também existiram modelos explicitamente "Codex", como
GPT-5-Codex, GPT-5.1-Codex, GPT-5.2-Codex, GPT-5.3-Codex e
codex-mini-latest.

A ideia importante é:

``` text
Codex ≠ um único modelo chamado Codex

Codex = produto/agente/harness
GPT-5.6 Sol/Terra/Luna = modelos que podem alimentar o agente
```

------------------------------------------------------------------------

# 15. GPT-5.4 e GPT-5.4 mini

A documentação atual informa que em **31/08/2026** GPT-5.4 e GPT-5.4
mini deixarão de estar disponíveis no Codex para usuários conectados com
conta ChatGPT.

Migração recomendada:

``` text
GPT-5.4      → GPT-5.6 Terra
GPT-5.4 mini → GPT-5.6 Luna
```

Tutoriais antigos podem, portanto, mostrar modelos que estão em processo
de saída do Codex.

------------------------------------------------------------------------

# 16. Consumo no Codex vs API

Não misture:

``` text
Codex autenticado com ChatGPT
```

com:

``` text
OpenAI API pay-as-you-go
```

São formas diferentes de acesso/cobrança.

No Codex baseado em conta/plano, o consumo depende das regras e créditos
do Codex. A tabela atual diferencia modelos e o consumo real depende de
tokens de entrada, entrada em cache, saída e trabalho de agentes.

Na API, existe precificação própria por tokens.

A ideia prática é:

``` text
Sol   → prioriza capacidade
Terra → prioriza equilíbrio
Luna  → prioriza eficiência
```

------------------------------------------------------------------------

# 17. Sessões longas e contexto

A documentação alerta que sessões longas podem amplificar conteúdo
repetido de prompts e ferramentas.

Em vez de uma sessão gigantesca:

``` text
auth
→ financeiro
→ dashboard
→ relatórios
→ estoque
→ ...
```

tarefas independentes podem ser separadas:

``` text
Sessão A → autenticação
Sessão B → financeiro
Sessão C → dashboard
```

Isso também combina com worktrees para execução paralela.

------------------------------------------------------------------------

# 18. Modelo forte não substitui AGENTS.md

Exemplo fraco:

``` text
Faça o módulo de usuários.
```

Exemplo de contexto persistente:

``` markdown
# AGENTS.md

Arquitetura:
Route -> Controller -> Service -> Repository

Banco:
PostgreSQL

Regras:
- Controller não possui regra de negócio.
- Service controla transações.
- Repository acessa dados.
- Toda alteração deve incluir testes.
- Nunca fazer push automaticamente.
```

Depois:

``` text
Implemente o módulo de usuários seguindo AGENTS.md.
```

Mesmo Sol melhora quando o projeto deixa suas regras explícitas.

------------------------------------------------------------------------

# 19. Modelo forte não substitui testes

Mesmo usando:

``` text
Sol + max
```

o fluxo deve continuar:

``` text
implementação
→ lint
→ typecheck
→ testes
→ build
→ validação
```

Prompt útil:

``` text
Após implementar:

1. execute npm run lint;
2. execute npm run typecheck;
3. execute npm test;
4. execute npm run build;
5. corrija falhas provocadas pela implementação;
6. informe bloqueios restantes.
```

------------------------------------------------------------------------

# 20. Escolha pelo risco

### Baixo risco

``` text
texto
CSS
rename
docs
testes repetitivos
```

→ Luna/Terra.

### Médio risco

``` text
CRUD
endpoint
migration simples
integração comum
refatoração localizada
```

→ Terra, eventualmente Sol.

### Alto risco

``` text
autenticação
autorização
pagamentos
concorrência
transações complexas
migração arquitetural
produção
```

→ Sol.

------------------------------------------------------------------------

# 21. Escalar modelo e reasoning

Uma estratégia econômica:

``` text
Terra low/medium
       ↓
resolveu? ── sim → fim
       │
      não
       ↓
Sol medium
       ↓
resolveu? ── sim → fim
       │
      não
       ↓
Sol high/xhigh
```

Você não precisa deixar tudo permanentemente no nível máximo.

------------------------------------------------------------------------

# 22. Claude → Codex

Num fluxo:

``` text
CLAUDE
Arquiteto
   ↓
PLAN.md
   ↓
CODEX
Executor
```

o orquestrador pode classificar a tarefa:

``` yaml
task:
  complexity: high
  model: gpt-5.6-sol
  reasoning: high
```

ou:

``` yaml
task:
  complexity: low
  model: gpt-5.6-luna
  reasoning: low
```

Conceitualmente:

``` text
PLAN simples  → Luna
PLAN normal   → Terra
PLAN complexo → Sol
```

------------------------------------------------------------------------

# 23. Três exemplos completos

## Luna

``` text
Atualize os labels dos campos de cadastro para seguir
src/constants/labels.ts.

Não altere comportamento.
Execute os testes do frontend.
```

Configuração inicial:

``` text
GPT-5.6 Luna + low
```

Motivo: mecânico, padrão explícito, baixo risco.

## Terra

``` text
Crie PATCH /usuarios/:id/status.

- somente administradores;
- ativo/inativo;
- 404 para usuário inexistente;
- registrar audit log;
- criar testes;
- atualizar OpenAPI.
```

Configuração inicial:

``` text
GPT-5.6 Terra + medium
```

Motivo: várias camadas, requisitos claros, complexidade moderada.

## Sol

``` text
O ERP possui autorização espalhada por controllers.
Migre gradualmente para RBAC.

- preservar comportamento;
- roles e permissions;
- migration sem perda;
- middleware centralizado;
- compatibilidade temporária;
- testes de regressão;
- rollback;
- documentação;
- não fazer push.
```

Configuração inicial:

``` text
GPT-5.6 Sol + high
```

Se a investigação mostrar complexidade excepcional:

``` text
GPT-5.6 Sol + xhigh
```

------------------------------------------------------------------------

# 24. Headless e worktree não mudam inteligência

Headless:

``` text
codex exec
```

muda a forma de execução, não o modelo.

Worktree:

``` text
feature/auth → worktree A → Sol
feature/docs → worktree B → Luna
```

fornece isolamento Git, não inteligência.

Você pode usar modelos diferentes em worktrees diferentes.

------------------------------------------------------------------------

# 25. Subagentes e consumo

Paralelismo:

``` text
Codex principal
├── agente A
├── agente B
└── agente C
```

pode reduzir tempo de parede, mas não significa automaticamente menor
consumo. Cada agente pode consumir contexto, ferramentas e saída.

Use paralelismo quando as tarefas forem realmente independentes.

------------------------------------------------------------------------

# 26. Configuração prática para um dia de desenvolvimento

``` text
MUDANÇAS RÁPIDAS
Luna + low
→ CSS, labels, docs, renames, tarefas mecânicas

DESENVOLVIMENTO NORMAL
Terra + medium
→ CRUD, endpoints, services, migrations simples, integrações, testes

PROBLEMAS DIFÍCEIS
Sol + medium/high
→ bugs complexos, arquitetura, auth, performance, concorrência

PROBLEMAS EXCEPCIONAIS
Sol + xhigh/max
→ migrações arquiteturais e investigação multi-módulo de alto risco
```

------------------------------------------------------------------------

# 27. Regra prática

Pergunte:

``` text
1. A tarefa é difícil?
2. O erro seria caro?
3. O agente precisa tomar muitas decisões sozinho?
```

Se quase tudo for "não":

``` text
Luna/Terra
```

Se for moderado:

``` text
Terra
```

Se quase tudo for "sim":

``` text
Sol
```

Depois ajuste reasoning:

``` text
simples      → low
normal       → medium
difícil      → high
muito difícil→ xhigh
excepcional  → max
```

------------------------------------------------------------------------

# 28. Resumo final

``` text
GPT-5.6 SOL
├── maior capacidade
├── arquitetura
├── bugs difíceis
├── grandes refatorações
├── tarefas agentic complexas
└── alto risco

GPT-5.6 TERRA
├── equilíbrio
├── desenvolvimento cotidiano
├── CRUD
├── API
├── testes
└── manutenção

GPT-5.6 LUNA
├── eficiência
├── tarefas simples
├── alto volume
├── documentação
├── mudanças mecânicas
└── baixo risco
```

Reasoning:

``` text
none → low → medium → high → xhigh → max
```

Mais reasoning **não** significa automaticamente melhor escolha para
toda tarefa.

Capacidades documentadas da família GPT-5.6:

``` text
Contexto: 1.050.000 tokens
Saída máxima: 128.000 tokens
Knowledge cutoff: 16/02/2026
Texto: entrada e saída
Imagem: entrada
Reasoning configurável
Ferramentas/agentic capabilities conforme a superfície
```

A fórmula mais importante para desenvolvimento é:

``` text
MODELO CERTO
+ REASONING CERTO
+ AGENTS.md BOM
+ ESCOPO CLARO
+ TESTES
+ GIT/WORKTREE
+ PERMISSÕES ADEQUADAS
= CODEX MAIS EFICIENTE
```

------------------------------------------------------------------------

# 29. Fontes oficiais consultadas

-   OpenAI Developers --- Models:
    https://developers.openai.com/api/docs/models
-   OpenAI Developers --- Model guidance:
    https://developers.openai.com/api/docs/guides/latest-model
-   GPT-5.6 Sol:
    https://developers.openai.com/api/docs/models/gpt-5.6-sol
-   GPT-5.6 Terra:
    https://developers.openai.com/api/docs/models/gpt-5.6-terra
-   GPT-5.6 Luna:
    https://developers.openai.com/api/docs/models/gpt-5.6-luna
-   OpenAI Help --- GPT-5.6 no ChatGPT:
    https://help.openai.com/pt-br/articles/20001354
-   OpenAI Help --- Codex com plano ChatGPT:
    https://help.openai.com/pt-br/articles/11369540-usando-o-codex-com-seu-plano-do-chatgpt
-   OpenAI Help --- Tabela de créditos do Codex:
    https://help.openai.com/pt-br/articles/20001106-codex-rate-card

> Preços, créditos, modelos disponíveis e limites podem mudar. Para
> cobrança e limites, confira sempre a documentação atual e `/usage` no
> Codex.
