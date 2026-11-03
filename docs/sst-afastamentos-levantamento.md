# SST › Afastamentos e Telemedicina — levantamento para o solicitante

Tela: **SST › Saúde Ocupacional › Afastamentos e Telemedicina** (`/app/sst/afastamentos`).
Migrations: `20261029001750_sst_afastamentos_atestados.sql` (módulo) e
`20261029003100_sst_afastamentos_fontes_reais.sql` (fontes reais, 29/10/2026).

O chamado pediu que o TI identificasse **o que já está disponível nos módulos,
o que precisa ser relacionado automaticamente e o que exige registro ou ajuste
de cadastro**. Este documento responde isso. A mesma tabela aparece na própria
tela, na aba **"De onde vêm os dados"**.

## Por que a tela aparecia vazia (29/10/2026)

1. A migration do módulo só entrou no banco às 15:00 de 29/10. Antes disso ela
   tinha sido pulada pelo aplicador (número de versão reaproveitado), então a
   captura automática nunca tinha rodado.
2. A captura só olhava quem estava **hoje** em atestado / doença / acidente,
   com afastamento nos últimos 120 dias. Férias, licenças, demais afastamentos
   e desligamentos ficavam de fora, e o auxílio-doença antigo caía no corte.
3. O espelho da Senior só guarda a **situação atual**. Um atestado de agosto que
   já terminou não deixa rastro ali. O histórico dependia de importar a planilha
   de telemedicina, e ela ainda não tinha sido importada.

**Correção:** a captura agora lê quatro fontes. Ela roda de hora em hora, uma
vez na própria migration e também pelo botão **Trazer da Senior**:

| Fonte | O que entra |
|---|---|
| Senior → EMPREGADOS | Toda situação diferente de "Trabalhando": atestado, auxílio-doença, férias, licença, acidente e demais afastamentos, sem corte de data. Também entra o desligamento dos últimos 180 dias. |
| Central de Serviços / RH › Férias | Férias **aprovadas** com saída nos últimos 12 meses, já com o período fechado. |
| Operacional › Efetividade | Ausências por atestado, afastamento ou férias registradas pelos encarregados. Dias seguidos viram um afastamento. |
| Planilha de telemedicina (importação) | O histórico de atestados curtos que já terminaram, com os dados da telemedicina. |

Os indicadores e relatórios contam só os dias de cada afastamento **dentro do
período escolhido**. Assim, um auxílio-doença aberto desde 2024 entra com os
dias de agosto a outubro, e não com 700 dias.

## Levantamento por item do chamado

Legenda:
- **Disponível**: o dado já vem pronto de outro módulo.
- **Relacionado**: o sistema cruza sozinho dados de módulos diferentes.
- **Registro**: alguém precisa lançar o dado ou ajustar um cadastro.

### 1. Contrato, posto, escala, valor mensal do posto e lotação na data

| Informação | De onde vem | Situação |
|---|---|---|
| Contrato vigente | Filial da Senior + depara do RH › Ativos/Contratos | Relacionado |
| Posto de trabalho | Posto da Senior + depara de postos e ajuste por pessoa (Ativos/Contratos) | Relacionado |
| Escala e cargo | Senior → EMPREGADOS | Disponível |
| Valor mensal do posto | Planilha de Custo **executada** vigente na data do afastamento | Relacionado |
| Lotação na data | Gravada no afastamento no momento da captura | Disponível |

Ajustes de cadastro que deixam esse item incompleto:
- colaborador sem posto ligado à Planilha de Custo (RH › Ativos/Contratos);
- filial sem contrato no depara;
- contrato sem Planilha de Custo executada (Controladoria).

A Senior espelhada não tem histórico de transferências. Por isso, a lotação de
um afastamento anterior à captura é a lotação vigente quando ele foi capturado.

### 2. Reserva Técnica (RT)

| Informação | De onde vem | Situação |
|---|---|---|
| O contrato tem RT? Quem é? | RH › Ativos/Contratos (posto RENDA TÉCNICA) | Relacionado |
| RT usada para cobrir a ausência | Efetividade (substituto que é RT) ou cobertura registrada do tipo RT | Relacionado |

### 3. Substituições, remanejamentos, horas extras e despesas da cobertura

| Informação | De onde vem | Situação |
|---|---|---|
| Substituições e remanejamentos | Efetividade (cobertura acionada com substituto) | Relacionado |
| Diaristas e o valor pago | Operacional › Diárias (o faltante é o afastado) | Relacionado |
| Horas extras | Sistemas › Hora Extra (mesma filial, nos dias do afastamento) | Relacionado* |
| Transporte, benefício extra e outras despesas | Registro na ficha do afastamento | Registro |

\* A hora extra não diz quem ela cobriu. Por isso ela aparece na ficha como
**possível cobertura**, com valor estimado (salário ÷ 220 × 1,5 × horas). O
valor só entra no custo quando alguém clica em **Lançar como cobertura**.

### 4. Atestado e telemedicina

| Informação | De onde vem | Situação |
|---|---|---|
| Dias do atestado, tipo, CID e médico | Ficha do afastamento ou planilha importada | Registro (a Senior não informa dias previstos nem CID) |
| Encaminhamento, avaliação, resultado e dias após a avaliação | Ficha do afastamento ou planilha de telemedicina | Registro |
| Acompanhamento do retorno | Senior (a situação volta a "Trabalhando") + anotação na ficha | Disponível |

### 5. Financeiro do posto e do contrato

| Informação | De onde vem | Situação |
|---|---|---|
| Faturamento realizado | Emissão de NF (notas emitidas do contrato por competência) | Relacionado |
| Glosas e faltas descontadas na nota | Itens da NF | Relacionado* |
| Custo do posto e margem de contribuição | Planilha de Custo (valor − custo) menos o impacto apurado | Relacionado |
| Custos adicionais | Diárias + horas extras lançadas + despesas registradas | Relacionado |

\* A nota fiscal não diz **qual** afastamento foi glosado. Por isso, a perda de
receita de cada afastamento é **estimada** (dias sem cobertura × valor/dia do
posto) até alguém informar a glosa real na ficha. O relatório gerencial por
contrato e por competência mostra, lado a lado, o faturamento realizado, as
faltas e glosas da nota e o impacto como % do faturamento.

## Entregas da tela

- **Ficha individual por afastamento.** Mostra lotação na data, atestado,
  telemedicina, retorno, cobertura (automática e lançada), horas extras
  relacionadas, valores do posto, impacto, notas do contrato e histórico. Pode
  ser impressa.
- **Relatório gerencial.** Consolida por contrato, posto, colaborador ou
  competência: dias, dias cobertos, RT, dias evitados pela telemedicina, custo
  de cobertura, perda de receita, impacto, margem apurada, economia da
  telemedicina e faturamento realizado. Exporta para Excel.
- **Relatório mensal por contrato.** Segue o formato do RELATÓRIO MENSAL
  ATESTADOS, só com atestados.
- **Importação da planilha de telemedicina.** Traz o histórico.

Os valores aparecem para quem tem a permissão **"Afastamentos — Ver valores e
impacto financeiro"** (Administração › Acesso por Usuário).

## O que ainda depende de ação fora do sistema

1. **Histórico de atestados já encerrados direto da Senior.** O espelho precisa
   trazer o histórico de afastamentos da Senior (tabela R038AFA, se existir no
   banco `hagg`). Até lá, esse histórico entra pela planilha de telemedicina.
2. **Cadastros de lotação.** Os postos ligados à Planilha de Custo e o depara de
   filial → contrato são o que mais deixa o valor do posto em branco.
3. **Glosa real por afastamento.** Ela continua sendo informada na ficha quando
   o contratante desconta na nota.
