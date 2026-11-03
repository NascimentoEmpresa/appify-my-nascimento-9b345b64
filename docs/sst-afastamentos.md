# SST › Afastamentos e Telemedicina — diagnóstico das informações

Chamado: automatizar a análise dos afastamentos por atestado e medir o impacto
operacional e financeiro (hoje: `PLANILHA TELEMEDICINA.xlsx` e
`RELATÓRIO MENSAL ATESTADOS.xlsx`, com a lotação pesquisada à mão).
Implementação: migration `20261028002000_sst_afastamentos_atestados.sql`,
tela `/app/sst/afastamentos`, regras em `src/lib/sst/afastamentos.ts`
(testadas em `src/test/sst-afastamentos.test.ts`).

Abaixo, o que o chamado pediu que o TI identificasse: o que **já existe** nos
módulos, o que passou a ser **relacionado automaticamente** e o que **exige
registro novo ou ajuste de cadastro**.

## 1. Lotação (contrato, posto, escala, valor do posto)

| Informação | Situação | De onde vem |
|---|---|---|
| Colaborador, CPF, cargo, escala, filial, posto da Senior | Já existe | `EMPREGADOS` (sincronizado da Senior a cada 15 min) |
| Contrato do colaborador | Relacionado automaticamente | mesma ligação do RH › Ativos/Contratos: depara da filial (`sup_empregado_contrato_depara`) → nome da filial → local |
| Posto da Planilha de Custo | Relacionado automaticamente | ajuste da pessoa (`RH_POSTO_COLABORADOR`) ou depara do posto da Senior (`RH_POSTO_DEPARA`) |
| Valor mensal do posto, salário, custo e lucro | Relacionado automaticamente | `planilha_custo` EXECUTADA vigente **na data do afastamento** (`total_por_empregado`, `salario`, `lucro`, tributos) |
| Lotação **na data** do afastamento | Registro novo | a Senior só guarda a lotação ATUAL; o sistema grava a lotação no momento do registro e permite "Recalcular" |
| Colaborador sem posto ligado | **Ajuste de cadastro** | ligar o posto em RH › Ativos/Contratos; sem isso não há valor do posto e o impacto fica só com o custo de cobertura |
| Filial sem contrato no ERP | **Ajuste de cadastro** | depara da filial em Suprimentos (`sup_empregado_contrato_depara`) |

## 2. Reserva Técnica (RT)

| Informação | Situação | De onde vem |
|---|---|---|
| Existência de RT no contrato e quem é RT | Já existe | `RH_POSTO_COLABORADOR` com posto "RENDA TÉCNICA" (RH › Ativos/Contratos) |
| Uso da RT para cobrir a ausência | Relacionado automaticamente | substituto da Efetividade que é RT; ou cobertura registrada no afastamento com tipo "Reserva Técnica" |
| RT que não está marcada no RH › Ativos/Contratos | **Ajuste de cadastro** | mover a pessoa para RENDA TÉCNICA no contrato |

## 3. Substituições, remanejamentos, horas extras e despesas

| Informação | Situação | De onde vem |
|---|---|---|
| Faltas acionadas e substituto (diarista/colaborador) | Relacionado automaticamente | Operacional › Efetividade (`OPE_EFET_OCORRENCIA`), pelo colaborador e pelos dias do afastamento |
| Diárias pagas para cobrir o faltante (valor da diária + VT) | Relacionado automaticamente | Diárias (`DIARIA_SOLICITACAO` / `DIARIA_LINHA`), pelo faltante (ID ou CPF) e pelos dias |
| Horas extras de cobertura | **Registro novo** | o módulo de Horas Extras é do escritório e não diz quem foi coberto — registrar na ficha (horas e valor) |
| Remanejamentos de posto | **Registro novo** | não há registro de remanejamento temporário — registrar na ficha |
| Outras despesas (transporte, benefício do substituto) | **Registro novo** | registrar na ficha |

O sistema conta cada dia coberto uma vez só, mesmo que apareça em mais de
uma fonte, e separa dias cobertos, dias sem cobertura e dias cobertos por RT.

## 4. Atestado e telemedicina

| Informação | Situação | De onde vem |
|---|---|---|
| Entrada em atestado / auxílio-doença / acidente | Relacionado automaticamente **daqui para a frente** | captura de hora em hora da situação da Senior (`sst_afa_capturar_senior`) — o espelho só tem a situação atual, então o histórico começa agora |
| Retorno ao trabalho / desligamento | Relacionado automaticamente | a captura marca "Retornou" quando a situação volta a Trabalhando, e "Desligado" na demissão |
| Histórico de mar–out/2026 | Importação | a própria PLANILHA TELEMEDICINA (Importar planilha): a observação livre vira campos (dias reduzidos, não compareceu, assinatura, desligado) |
| Dias do atestado, CID, médico | **Registro novo** | a Senior não manda os dias do atestado nem o CID — informar na ficha (ou vêm da planilha) |
| Telemedicina: data, encaminhamento, avaliação, resultado, dias após a avaliação, assinatura, ponto | **Registro novo** | ficha do afastamento (hoje é a planilha) |
| "Não avaliados por conta do prazo" | **Registro novo** | situação da telemedicina "Não avaliado (prazo)" |

## 5. Financeiro do posto e do contrato

| Informação | Situação | De onde vem |
|---|---|---|
| Faturamento realizado do contrato na competência (bruto, faltas, glosas, líquido) | Relacionado automaticamente | Emissão de NF (`nf_emissao` / `nf_emissao_item`) do contrato nas competências do afastamento |
| Perda de receita do afastamento | Calculado | **estimada**: dias sem cobertura × valor/dia do posto (valor mensal ÷ 30); **informada**: a glosa real, digitada na ficha |
| Custos adicionais | Calculado | diárias + coberturas registradas |
| Margem de contribuição | Calculado | (valor mensal − custo mensal do posto) ÷ 30 × dias, menos o impacto |
| Resultado econômico da telemedicina | Calculado | dias evitados × valor/dia do posto |
| Glosa por colaborador | **Registro novo** | a NF desconta faltas e glosas no total do contrato, sem dizer de quem — o valor por afastamento é estimado ou informado |

## Relatórios

- **Ficha individual** por afastamento (com impressão).
- **Relatório gerencial** por colaborador, posto, contrato e competência, com
  exportação em Excel. Por competência, quem atravessa o mês entra nos dois
  meses com dias e valores proporcionais.
- **Relatório mensal por contrato** no formato do RELATÓRIO MENSAL ATESTADOS
  (quantidade, soma de dias, avaliados na telemedicina, não avaliados por
  prazo, dias não avaliados) + dias evitados.

## Acesso

- `sst_afastamentos` — ver (visualizar) e registrar/alterar (alterar).
- `sst_afastamentos_financeiro` (fantasma) — ver valores do posto, perda de
  receita, margem, notas e informar glosa.

Os dois nascem fechados: liberar em Acesso por Usuário.
