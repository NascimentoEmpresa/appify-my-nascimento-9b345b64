import type { ReactNode } from "react";
import { AssinaturaRegra } from "@/pages/malote/AssinaturaRegra";
import type { FonteExt } from "./indicadores";
import type { FonteId } from "./regras";

// SIS-2026-0903: TODOS os textos dos infoboxes (i) da Conciliação Financeira num lugar só. Quem for mudar uma regra (ou o que um KPI/coluna significa)
// acha aqui o texto a ajustar; a assinatura no fim diz de qual chamado a regra veio e em que arquivo está a conta.
const A = <AssinaturaRegra chamado="SIS-2026-0903" />;

// ── KPIs da conciliação (as quatro telas comparadas: Relatório Geral, Dashboard, Faturamento da Empresa, Lucratividade) ───────────────────
export const INFO_KPI: Record<string, ReactNode> = {
  conciliados: <><span className="block">Quantos dos <strong>4 indicadores principais</strong> (bruto, líquido, recebido e pendente) as três telas (Relatório Geral, Dashboard e Faturamento da Empresa) mostram com o <strong>mesmo valor</strong> neste recorte.</span><span className="block">Conta em <code>conciliar</code> (regras.ts): diferença entre o maior e o menor valor &lt; R$ 0,005.</span>{A}</>,
  divergentes: <><span className="block">Indicadores principais em que pelo menos duas telas mostram valores diferentes. Veja a aba “Todos os indicadores” para os outros 20 e “Detalhar indicador” para achar a nota.</span>{A}</>,
  diferencaTotal: <><span className="block"><strong>Soma, nota a nota, da diferença entre a tela que mostra mais e a que mostra menos</strong>, em todos os indicadores principais.</span><span className="block">Não é a diferença dos totais (um lado pode compensar o outro): é a soma dos desvios por NF.</span>{A}</>,
  notasDivergentes: <><span className="block">Notas em que alguma tela mostra valor diferente das outras (ou em que a nota existe numa tela e não na outra). Clique para ver as notas e o motivo de cada uma.</span>{A}</>,
  pctConciliacao: <><span className="block">Notas conciliadas ÷ notas avaliadas no recorte. Nota conciliada = as telas concordam em todos os indicadores dela.</span>{A}</>,
  valorInvestigacao: <><span className="block">Soma da diferença das <strong>tratativas abertas ou em análise</strong>. Justificada e regularizada saem daqui: já tiveram análise registrada.</span>{A}</>,
  semTratativa: <><span className="block">Notas divergentes que <strong>ainda não têm tratativa</strong> (ninguém assumiu a análise). Clique para ver as notas e abrir a tratativa.</span>{A}</>,
  vencidas: <><span className="block">Tratativas abertas ou em análise cujo <strong>prazo de resolução</strong> já passou.</span>{A}</>,
  tratEmAberto: <><span className="block">Tratativas com situação <strong>aberta</strong> ou <strong>em análise</strong>.</span>{A}</>,
  tratEncerradas: <><span className="block">Tratativas <strong>justificadas</strong> (a diferença tem explicação aceita) ou <strong>regularizadas</strong> (foi corrigida).</span>{A}</>,
  impostos: <><span className="block">ISSQN + INSS + IR + COFINS + PIS + CSLL retidos nas NFs do recorte (cabeçalho da nota), sem cancelada/substituída.</span>{A}</>,
  descontos: <><span className="block">Faltas + postos não implementados + multas + glosas + outros descontos, <strong>antes e depois</strong> da emissão, somados dos itens das NFs.</span>{A}</>,
  inconsistentes: <><span className="block">NFs em que o <strong>cabeçalho</strong> (impostos ou descontos pós-emissão) não bate com a <strong>soma dos itens</strong>. Costuma ser erro de lançamento.</span>{A}</>,
  cvDescontada: <><span className="block">Soma do <strong>desconto de conta vinculada</strong> retido nas NFs. Não entra em dinheiro e não é saldo a receber da nota.</span>{A}</>,
  cvRecebida: <><span className="block">O que <strong>efetivamente entrou</strong> na conta vinculada, registrado na NF pelo Financeiro.</span>{A}</>,
  cvPendente: <><span className="block"><strong>Descontada − recebida</strong>, por nota, nunca negativa (NF em situação especial não tem pendência). É o que ainda falta entrar.</span>{A}</>,
};

// ── Fontes (cabeçalhos das tabelas de comparação) ───────────────────────────────────────────────────────────────────────────────────────
export const INFO_FONTE: Record<FonteExt | FonteId, ReactNode> = {
  geral: <><span className="block"><strong>Relatório Geral</strong> (Relatório de Serviços): valores gravados nas NFs; empresa = a da NF; cliente = o do contrato gravado na NF.</span><span className="block">Funções: <code>totaisDoRelatorio</code> (relatorio-servicos/totais.ts).</span></>,
  dashboard: <><span className="block"><strong>Dashboard do Relatório de Serviços</strong>: mesmos recortes do Relatório Geral; mostra executado, faturado, recebido, pendente e o total de descontos por tipo.</span><span className="block">Função: <code>kpisDoDashboard</code> (relatorio-servicos/kpisDashboard.ts).</span></>,
  faturamento: <><span className="block"><strong>Faturamento da Empresa</strong> (Controladoria): só entra NF cujo contrato existe no cadastro; empresa e cliente são os do <strong>contrato</strong>. “A receber” zera na nota paga.</span><span className="block">Funções: <code>agruparFaturamento</code>, <code>aReceberDaNf</code> (controladoria/faturamento/regras.ts).</span></>,
  lucratividade: <><span className="block"><strong>Lucratividade de Contratos</strong> (Controladoria): contratos ADMINISTRATIVO ficam de fora; custos do Fluxo de Caixa por competência.</span><span className="block">Função: <code>lucroBruto</code> (controladoria/faturamento/regras.ts).</span></>,
};

// ── Colunas das tabelas ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const INFO_COL: Record<string, ReactNode> = {
  indicador: <><span className="block">O que está sendo comparado. Passe o mouse no (i) de cada indicador para ver a fórmula e de que telas ele vem.</span>{A}</>,
  diferenca: <><span className="block"><strong>Maior − menor valor</strong> entre as telas que trazem o indicador. Indicador de uma tela só (“fonte única”) não tem diferença.</span>{A}</>,
  variacao: <><span className="block">Diferença ÷ valor da primeira tela que traz o indicador, em %.</span>{A}</>,
  status: <><span className="block"><strong>Conciliado</strong>: telas iguais (R$ 0,005 de tolerância). <strong>Divergente</strong>: valores diferentes. <strong>Fonte única</strong>: só uma tela traz o indicador. <strong>Sem dado</strong>: ainda não carregou.</span>{A}</>,
  destoa: <><span className="block">A tela que ficou <strong>sozinha</strong> contra as demais iguais; se todas diferem entre si, todas as que trazem o indicador. Ajuda a apontar onde está o erro.</span>{A}</>,
  grupo: <><span className="block">Competência ou contrato, conforme a aba. Soma as notas que contam em pelo menos uma das telas.</span>{A}</>,
  notasGrupo: <><span className="block">Quantidade de NFs do grupo que contam em alguma das telas.</span></>,
  divergentesGrupo: <><span className="block">Quantas dessas NFs têm diferença entre as telas.</span></>,
  difIndicador: <><span className="block">Soma, nota a nota, da diferença (maior − menor) <strong>deste indicador</strong> no grupo.</span></>,
  difTotalGrupo: <><span className="block">Soma da diferença de todos os indicadores principais, nota a nota.</span>{A}</>,
  statusGrupo: <><span className="block">Conciliado quando nenhuma NF do grupo diverge.</span></>,
  nf: <><span className="block">Número da NF (e variação). Clique em “Abrir” para ver a nota no Relatório Geral, já com empresa, competência e contrato.</span></>,
  contrato: <><span className="block">Contrato da NF: o gravado na nota, ou o do cadastro quando a nota não traz.</span></>,
  competencia: <><span className="block">Mês de competência da NF (não é a data de emissão nem de pagamento).</span></>,
  pendRel: <><span className="block">Valor pendente segundo o Relatório Geral e o Dashboard: <strong>líquido − pago − conta vinculada − descontos pós-emissão dos itens</strong>. “fora” = a NF não entra nessa tela.</span>{A}</>,
  pendFat: <><span className="block">Valor a receber segundo o Faturamento da Empresa: a mesma conta com o total pós-emissão do <strong>cabeçalho</strong>; <strong>nota paga (com data de pagamento) não tem saldo</strong>. “fora” = a NF não entra nessa tela.</span>{A}</>,
  difTotalNota: <><span className="block">Soma, nesta NF, da diferença (maior − menor) de cada indicador principal entre as telas.</span>{A}</>,
  motivo: <><span className="block">Motivo provável calculado pelo sistema, com o <strong>tipo</strong> da divergência: registro ausente, critério diferente entre as telas, erro de lançamento ou divergência de cálculo.</span>{A}</>,
  tratativa: <><span className="block">Situação da tratativa desta NF. “Tratar” abre a análise: responsável, justificativa, prazo e histórico.</span>{A}</>,
  // detalhamento
  detNotas: <><span className="block">Quantas NFs entram neste grupo.</span></>,
  detDiferenca: <><span className="block">Maior − menor valor entre as telas <strong>neste grupo</strong>, só das telas que trazem o indicador.</span>{A}</>,
  detAusentes: <><span className="block">NFs do grupo que existem numa tela e <strong>não existem</strong> na outra (registro ausente). Não é valor zerado: a nota simplesmente não entra naquela tela.</span>{A}</>,
  detFonte: <><span className="block">Soma do indicador, neste grupo, <strong>do jeito que aquela tela calcula</strong>. “fora” = nenhuma NF do grupo entra naquela tela.</span></>,
  // impostos e descontos
  impCabecalho: <><span className="block">Soma dos seis impostos gravados no <strong>cabeçalho</strong> da NF (o que o Relatório Geral mostra).</span>{A}</>,
  impItens: <><span className="block">Soma dos impostos <strong>item a item</strong>. Diferente do cabeçalho = lançamento inconsistente.</span>{A}</>,
  faltas: <><span className="block">Faltas dos itens da NF (já descontadas no líquido).</span></>,
  postos: <><span className="block">Postos não implementados dos itens da NF (já descontados no líquido).</span></>,
  multasAntes: <><span className="block">Multas lançadas <strong>antes</strong> da emissão (já no líquido).</span></>,
  multasDepois: <><span className="block">Multas <strong>pós-emissão</strong>: ficam fora do líquido e reduzem o que falta receber.</span></>,
  glosasAntes: <><span className="block">Glosas lançadas <strong>antes</strong> da emissão (já no líquido).</span></>,
  glosasDepois: <><span className="block">Glosas <strong>pós-emissão</strong>: ficam fora do líquido e reduzem o que falta receber.</span></>,
  outrosAntes: <><span className="block">Outros descontos <strong>antes</strong> da emissão (já no líquido).</span></>,
  outrosDepois: <><span className="block">Outros descontos <strong>pós-emissão</strong>: ficam fora do líquido e reduzem o que falta receber.</span></>,
  inconsistencia: <><span className="block">Onde o cabeçalho da NF não bate com a soma dos itens (impostos ou descontos pós-emissão), ou NF com valores no cabeçalho e sem itens.</span>{A}</>,
  // conta vinculada
  cvDescontadaCol: <><span className="block">Desconto de conta vinculada retido na NF.</span></>,
  cvRecebidaCol: <><span className="block">Valor que efetivamente entrou na conta vinculada.</span></>,
  cvData: <><span className="block">Data em que o Financeiro registrou o recebimento na NF.</span></>,
  cvPendenteCol: <><span className="block">Descontada − recebida, por nota, nunca negativa.</span>{A}</>,
  cvSituacao: <><span className="block"><strong>Recebida</strong>: sem saldo. <strong>Recebida em parte</strong>: entrou menos que o descontado. <strong>Pendente</strong>: nada entrou. <strong>Recebido a mais</strong>: entrou mais que o descontado.</span>{A}</>,
  // tratativas
  trDivergencia: <><span className="block">A NF (ou o indicador) em divergência, com contrato e competência.</span></>,
  trTipo: <><span className="block">Origem da diferença: registro ausente, critério diferente entre as telas, erro de lançamento ou divergência de cálculo.</span>{A}</>,
  trDiferenca: <><span className="block">Diferença da nota quando a tratativa foi aberta.</span></>,
  trResponsavel: <><span className="block">Quem responde pela análise.</span></>,
  trSituacao: <><span className="block">Aberta → em análise → justificada (tem explicação) ou regularizada (foi corrigida). Justificar ou regularizar exige justificativa.</span>{A}</>,
  trIdentificada: <><span className="block">Data em que a tratativa foi aberta.</span></>,
  trPrazo: <><span className="block">Prazo de resolução. Em vermelho com ⚠ quando passou e a tratativa continua em aberto.</span></>,
  trRegularizada: <><span className="block">Data em que a divergência foi corrigida.</span></>,
};

// ── Gráficos e blocos ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const INFO_BLOCO: Record<string, ReactNode> = {
  comparativo: <><span className="block">Os 4 indicadores principais lado a lado nas três telas. Em vermelho, a tela que destoa. Os demais 20 indicadores estão em “Todos os indicadores”.</span>{A}</>,
  graficoIndicadores: <><span className="block">Os mesmos valores do comparativo em barras: uma cor por tela. Barras de alturas diferentes = divergência.</span></>,
  graficoEvolucao: <><span className="block">Soma da diferença por NF em cada competência. <strong>Clique numa barra</strong> para ver as NFs divergentes do mês.</span>{A}</>,
  graficoTipos: <><span className="block">Quantas notas divergentes caem em cada tipo (uma nota pode ter mais de um). <strong>Clique numa barra</strong> para ver as NFs daquele tipo.</span>{A}</>,
  topContratos: <><span className="block">Os 5 contratos com a maior soma de diferenças por NF no recorte.</span>{A}</>,
  statusNotas: <><span className="block">Notas conciliadas × divergentes no recorte.</span>{A}</>,
  extratoCsv: <><span className="block">Exportação rápida do detalhe por NF em CSV. O Excel traz as 8 planilhas (resumo, comparativo, divergências, NF, impostos, conta vinculada e tratativas).</span></>,
};
