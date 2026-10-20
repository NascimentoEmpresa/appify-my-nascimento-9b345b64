# Estoque Saudável — planejamento de estoque com I.A

Aba nova em **Suprimentos › Dashboard de Compras, Estoque e Saving**
(`/app/suprimentos/dashboard`), pedida pelo gerente de Supply por áudio em
19/10/2026. Sem chamado aberto.

## O que ele pediu, e onde está na tela

| Pedido (palavras dele) | Onde aparece |
|---|---|
| "qual é o estoque saudável que eu tenho que ter de cada coisa, pra atender essa rotatividade de hoje" | Coluna **Alvo saudável**, item por item e tamanho por tamanho |
| "pra não ter o prejuízo das pessoas paradas em casa, não podendo trabalhar sem uniforme" | Cartão **Risco de parar gente** e a seção "Risco de parar gente" da análise |
| "eu não tenho calça M, eu mando fazer, isso leva cinco, dez dias, eu não tenho previsibilidade" | Colunas **Cobertura** e **Pedir em**, mais o aviso de "pedir hoje já chega atrasado" |
| "isso aqui não tem giro há tantos meses, elimina do estoque, faz venda" | Bloco **Para eliminar do estoque e vender**, com botão de marcar |
| "saber o que a gente tem de dinheiro parado" | Cartão **Dinheiro parado**, separado em "sobrando" e "sem giro" |
| "poder barganhar preço pra pedir uma quantidade, um volume maior" | **Compra sugerida por família**, com a grade por tamanho e o CSV para cotação |
| "incorpora aquele número e faz aquele pedido pra manter esse estoque mínimo" | Botão **Aprovar alvo**, com a opção de levar o mínimo para o cadastro do estoque |
| "mês a mês a IA ia analisando e dizendo a hora de diminuir, porque foi trocado o quadro" | Gráfico **Mês a mês** + fechamento mensal automático (dia 1º) |
| "os contratos que a gente já tem hoje… contrato novo vai ter que fazer um pedido pra aquele contrato específico" | Só contrato **ativo** entra na conta; o que ficou de fora aparece como alerta |

Pedido complementar de **20/10/2026**, depois de ver a primeira versão:

| Pedido | Onde está |
|---|---|
| "um lugar nessa tela onde eu pudesse perguntar coisas para a IA" / "um chatbot no canto da tela com caixinha de pergunta" | Botão **Perguntar à I.A**, canto inferior direito |
| "perguntas prontas" | 7 chips no chat e uma faixa no corpo da página |
| "qual item mais roda no meu estoque?" | pergunta pronta **O que mais roda?** |
| "qual item eu devo comprar reposição mais seguidamente?" | pergunta pronta **Reponho mais seguido?** |
| "qual item tem faltado muito nos pedidos solicitados e precisamos comprar urgentemente?" | pergunta pronta **O que mais faltou?** + coluna **Já faltou** na tabela |
| "qual item não sai muito ficando acumulado no estoque?" | pergunta pronta **O que está acumulando?** |

## O assistente: perguntar à I.A

No canto inferior direito da aba há o botão **Perguntar à I.A** (com um número
vermelho quando há tamanho em falta). Ele abre um chat com **perguntas prontas**
e uma caixa para escrever a sua:

| Pergunta pronta | O que ela usa |
|---|---|
| **Análise completa** | o painel inteiro, em seções |
| **O que mais roda?** | giro anual: quantas vezes o estoque de cada item se renova por ano |
| **Reponho mais seguido?** | as reposições que **de fato aconteceram** na janela |
| **O que mais faltou?** | histórico de pedidos que o estoque não conseguiu atender |
| **O que está acumulando?** | excesso e item sem giro, pelo valor parado |
| **Dinheiro parado** | excesso em item que gira × item sem giro, separados |
| **Onde barganhar preço** | compra sugerida somada por família |

As mesmas perguntas aparecem numa faixa no corpo da página, para quem está
lendo a tabela não precisar procurar o botão.

**As perguntas prontas não são atalhos de digitação.** Cada uma tem um ranking
calculado no banco sobre o **catálogo inteiro**. Isso importa porque a lista de
itens que a I.A recebe é truncada (o catálogo todo não cabe no prompt), e um
"qual item mais roda" respondido sobre uma amostra seria uma resposta errada com
cara de certa. Se alguém acrescentar pergunta pronta no futuro, precisa conferir
se existe ranking que a sustente.

### "O que mais faltou" é diferente de "o que está faltando"

A coluna **Situação** mostra o estoque de **hoje**. O ranking de falta mostra o
**histórico**: quantas vezes aquele tamanho foi pedido e o almoxarifado não
conseguiu entregar.

São coisas diferentes, e a diferença é o ponto. Um tamanho que deixou dois
pedidos na mão no semestre e foi reposto ontem aparece como **"Saudável"** na
tabela — e é, no ano, um dos que mais travaram a operação. A tabela tem a coluna
**"Já faltou"** justamente para isso; em vermelho quando a falta é crônica (duas
ou mais vezes **e** em 25% ou mais dos pedidos — os dois critérios juntos, porque
1 falta em 1 pedido dá 100% e não é crônico, e 2 faltas em 90 pedidos é ruído).

A contagem só vale **a partir de quando o almoxarifado passou a registrar baixa
por item** (04/08/2026 na matriz). Antes disso nenhum pedido tem registro de
consumo, então todos pareceriam não atendidos. O chat sempre diz desde quando
está contando.

### "Reponho mais seguido" usa reposição real, não fórmula

A conta teórica (consumo anual ÷ alvo) **não serve** para esse ranking: como o
alvo *é* consumo × (prazo + ciclo), ela devolve 365 ÷ (prazo + ciclo) — o mesmo
número, ~9 vezes por ano, para todo item sem estoque de segurança. Daria um
ranking plano que pareceria resposta e não era. Então o ranking conta as
**entradas de estoque que aconteceram** (entradas no mesmo dia contam como uma
reposição: receber um pedido em três caixas é um reabastecimento, não três).

## A decisão mais importante: a I.A não calcula quantidade

A quantidade sai de **fórmula de reposição, no banco de dados**, igual toda vez
que rodar:

```
consumo/dia       = peças pedidas na janela ÷ dias em que o item existia
segurança         = z(nível de serviço) × oscilação do consumo no prazo de reposição
pedir quando      = consumo/dia × prazo de reposição + segurança
alvo saudável     = consumo/dia × (prazo de reposição + intervalo entre compras) + segurança
comprar           = alvo − o que está em casa − o que já está vindo
```

A I.A **lê** esses números e escreve a leitura: o que priorizar, o que
liquidar, o que mudou no mês, onde desconfiar. Ela não arredonda nem inventa
quantidade.

Isso não é detalhe técnico: o número vai para uma negociação de volume com
fornecedor. Se tivesse saído de um modelo de linguagem, seria irreprodutível —
rodaria de novo amanhã e daria outro valor, e não haveria como defender o
pedido. Cada linha da tabela tem um botão que abre a conta por extenso, com os
números daquele item. Foi isso que ele chamou de **previsibilidade**.

## Três escolhas que mudam o número

**1. A demanda é o que foi PEDIDO, não o que saiu do almoxarifado.**
A saída física só conta o que o estoque conseguiu entregar. Quem pediu calça M
e não tinha calça M não aparece ali — e é exatamente a pessoa que ficou parada
em casa. Dimensionar pela saída física perpetuaria a falta: falta → não sai →
o sistema conclui que não precisa. A saída física fica como coluna de
conferência.

**2. Só contrato ativo entra.**
Demanda de contrato encerrado mandaria comprar para um quadro que não existe
mais. O que foi deixado de fora aparece como alerta, com o total, para ninguém
procurar um número que "sumiu".

**3. Cada item divide pela própria vida, não pela janela inteira.**
Item que começou a ser pedido há dois meses, dividido por seis meses de
janela, devolveria um terço do consumo real — e nasceria com alvo baixo
justamente onde falta.

## Por que o alvo diminui sozinho quando o quadro cai

A janela é **móvel** (6 meses por padrão, editável). Quando um contrato reduz
o quadro, os meses de consumo alto saem da janela e o alvo cai na revisão
seguinte — sem ninguém mexer. É o "não precisa tanto mais, porque foi trocado
o quadro" do áudio.

O fechamento mensal (dia 1º, automático) guarda a foto do mês. **Antes disso
não havia histórico de saldo nenhum no módulo** — o saldo só existia no
presente. É o que torna a comparação mês a mês possível; o gráfico começa
vazio e enche um mês por vez.

## O que a tela NÃO faz sozinha

Nada escreve automaticamente no **estoque mínimo** do cadastro, que é o número
que dispara aviso de reposição para o almoxarifado. Um erro de premissa (uma
janela de 2 meses caindo num mês de férias coletivas) viraria mínimo errado em
todo o catálogo sem ninguém ter clicado em nada. Levar o número calculado para
o cadastro é clique explícito, item por item, com aviso na tela.

Aprovar um alvo diferente do calculado é permitido e registrado: fica o seu
nome, a data, o motivo e **quanto a conta sugeria na hora**. Isso permite, mais
tarde, revisar se a fórmula ou a pessoa estava mais certa.

## Onde desconfiar do número

A tela avisa, por item:

- **Histórico de menos de dois meses** — o alvo é projeção de um mês só.
- **Demanda irregular (classe Z)** — o colchão de segurança domina o alvo.
  Uma peça com 60 unidades num mês e zero nos outros cinco pede 33 de
  segurança para um consumo médio de 16/mês. A conta está certa (irregular
  exige colchão), mas vale conferir se o pico foi uma admissão em bloco que
  não repete.
- **Sem preço cadastrado** — a quantidade está certa, o valor em R$ não entra
  em nenhum total. A faixa de premissas mostra que % do plano tem preço.

## Classificação ABC / XYZ

- **ABC** = onde está o dinheiro. A = os itens que somam 80% do valor
  consumido.
- **XYZ** = previsibilidade. X regular, Z irregular.

Juntas dizem onde o estoque de segurança compensa: item **AX** protege a
operação com pouco dinheiro; item **CZ** não vale segurar.

## Premissas (editáveis na própria tela)

| Premissa | Padrão | Por quê |
|---|---|---|
| Prazo de reposição | 10 dias | "leva cinco, dez dias" — fica o pior caso, que é o que protege a operação |
| Garantia de não faltar | 95% | Padrão de item de reposição barata; subir para 99% engorda a segurança ~40% |
| Intervalo entre compras | 30 dias | A revisão mensal que ele pediu |
| Histórico considerado | 6 meses | Longo o bastante para a sazonalidade de admissão; curto o bastante para o alvo cair quando o quadro cai |
| Sem giro = liquidar | 6 meses | Tempo sem nenhuma saída para virar candidato a venda |
| Folga aceita sobre o alvo | 20% | Fornecedor vende por caixa/dúzia; acima disso é dinheiro parado |

Dá para ter premissa própria por tipo de item: uniforme de confecção não
repõe no mesmo prazo que insumo de prateleira.

## Como aplicar

As migrations **não se auto-aplicam**. Rodar no SQL Editor do Supabase, nesta
ordem:

1. `supabase/migrations/20261020000020_sup_estoque_saudavel.sql` — tabelas,
   menu e RLS
2. `supabase/migrations/20261020000021_sup_estoque_saudavel_rpc.sql` — a conta
3. `supabase/migrations/20261020000022_sup_estoque_saudavel_gravar.sql` —
   gravação e o agendamento do dia 1º

Depois, a Edge Function da análise:

```
supabase functions deploy sup-estoque-ia
```

Ela usa as mesmas chaves de I.A que já estão configuradas (`GEMINI_API_KEY`,
com `GROQ_API_KEY` de reserva) — não precisa de segredo novo.

### Liberar o acesso

A aba aparece para quem já tem **Dashboard de Compras, Estoque e Saving**.
O menu novo `sup_estoque_saudavel` controla só as ações de decisão, e **nasce
sem ninguém**. Liberar em *Administração › Acesso por Usuário*:

- **alterar** — aprovar alvo, marcar liquidação, mudar premissas, fechar o mês
- **exportar** — baixar o CSV da compra (sai da empresa, por isso é grant à
  parte)

### Primeiro uso

O gráfico mês a mês começa vazio: não existe fechamento gravado. Clicar em
**Fechar mês** cria o primeiro ponto na hora, sem esperar o dia 1º. Rodar o
mesmo mês de novo sobrescreve, não duplica — serve para refazer depois de
acerto de inventário.
