// Domínio da Diária UFRGS (Controle de Diárias — o segundo tipo).
//
// A diária de diarista (./diarias.ts) é um cabeçalho com N dias de escala.
// A UFRGS é OUTRA COISA: uma linha por viagem, com ofício, saída, retorno,
// destino e posto próprios — é exatamente uma linha da planilha que hoje é
// preenchida à mão (1789651523607-RETIFICADO__1_.xlsx, aba "DIARIAS
// 09.2025"), e o objetivo do módulo é o sistema GERAR aquela planilha.
//
// O status é COMPARTILHADO com a diária de diarista de propósito: são os
// mesmos seis estados, com os mesmos rótulos e as mesmas cores, porque o
// pedido é "o status da diária reflete igual em qualquer rota". Por isso
// StatusSolicitacao e STATUS_SOLICITACAO são importados de ./diarias e não
// redefinidos aqui — dois mapas de status divergiriam na primeira mudança.

import { StatusSolicitacao, fmtBRL, fmtData } from "./diarias";

export type { StatusSolicitacao } from "./diarias";
export { STATUS_SOLICITACAO, fmtBRL, fmtData, visivelNaLista } from "./diarias";

/** O filtro/seletor que separa os dois tipos de diária nas três rotas. */
export type TipoDiaria = "diaristas" | "ufrgs";

export const TIPOS_DIARIA: { value: TipoDiaria; label: string; descricao: string }[] = [
  {
    value: "diaristas",
    label: "Diárias de diaristas",
    descricao: "Cobertura de posto por faltante/diarista, com VT e turno.",
  },
  {
    value: "ufrgs",
    label: "Diárias UFRGS",
    descricao: "Viagem de motorista no contrato 034/2022, com ofício e destino.",
  },
];

/**
 * Sindicatos da coluna "Sindicato".
 *
 * Os dois do pedido, e os dois únicos que aparecem no mês entregue. Não é
 * texto livre porque é o sindicato que ESCOLHE A TARIFA: errar aqui troca
 * hospedagem de R$ 173,77 por R$ 66,07 sem ninguém perceber.
 *
 * A lista de verdade é a tabela "DIARIA_UFRGS_TARIFA" no banco (é dela que
 * sai o valor); esta constante existe para o dropdown não depender de uma
 * consulta para desenhar duas opções, e o back-end recusa sindicato que não
 * tenha tarifa cadastrada.
 */
export const SINDICATOS_UFRGS = ["SINDIRODOSUL/RS", "SINECARGA/RS"] as const;
export type SindicatoUfrgs = (typeof SINDICATOS_UFRGS)[number];

/** Uma faixa de tarifa vigente, como está em "DIARIA_UFRGS_TARIFA". */
export interface TarifaUfrgs {
  id: string;
  sindicato: string;
  /** yyyy-mm-dd — a "DATA BASE" da tabela de referência do contrato. */
  vigenciaInicio: string;
  hospedagemCentavos: number;
  cafeCentavos: number;
  almocoCentavos: number;
  jantaCentavos: number;
  vaCentavos: number;
  aliquotaPis: number;
  aliquotaCofins: number;
  aliquotaIss: number;
}

export const aliquotaTotal = (t: TarifaUfrgs) =>
  t.aliquotaPis + t.aliquotaCofins + t.aliquotaIss;

/** Lotação → Fiscal (a VLOOKUP da coluna "Fiscal"). */
export interface LotacaoUfrgs {
  lotacao: string;
  fiscal: string;
}

/** Posto/Cargo do contrato — o bloco P154:U182 da planilha. */
export interface PostoUfrgs {
  codigo: string;
  descricao: string;
  /** PORTO ALEGRE | ELDORADO DO SUL | IMBÉ | TRAMANDAÍ — agrupa os totais. */
  localidade: string;
  ordem: number;
}

/** As quantidades que entram na conta. */
export interface QuantidadesUfrgs {
  qtHospedagem: number;
  qtCafe: number;
  qtAlmoco: number;
  qtJanta: number;
  /** Dias de vale-alimentação descontados. */
  qtVa: number;
}

export interface ValoresUfrgs {
  /** Coluna R — "Valor Total". */
  valorTotalCentavos: number;
  /** Coluna S — "Valor VA". */
  valorVaCentavos: number;
  /** Coluna T — "Valor Líquido". PODE SER NEGATIVO (ver abaixo). */
  valorLiquidoCentavos: number;
  /** Coluna U — "Tributos". */
  tributosCentavos: number;
  /** Coluna V — "Valor à Faturar". */
  valorFaturarCentavos: number;
}

/**
 * Arredondamento igual ao do Postgres.
 *
 * `round()` do Postgres em numeric arredonda meio para LONGE DO ZERO;
 * Math.round do JS arredonda meio para +Infinity, então -0,5 sairia 0 aqui e
 * -1 no banco. A diferença só aparece no empate exato, mas o valor calculado
 * na tela tem que ser o mesmo que a trigger grava — senão a pessoa vê um
 * total, salva, e a lista mostra outro.
 */
const arredondar = (n: number) => (n < 0 ? -Math.round(-n) : Math.round(n));

/**
 * AS FÓRMULAS DA PLANILHA, transcritas célula por célula (linha 8 como
 * exemplo; as tarifas ficam nas linhas 5 e 6 da aba):
 *
 *   Valor Total   R8 = ($N$6*N8)+($O$6*O8)+($P$6*P8)+($Q$6*Q8)
 *   Valor VA      S8 = 31.69*2        → tarifa de VA × dias de VA
 *   Valor Líquido T8 = R8-S8
 *   Tributos      U8 = (T8*0.0674/(1-0.0674))
 *   Valor à Fat.  V8 = T8+U8
 *
 * O 0,0674 é a soma das três alíquotas do bloco "RESUMO DOS TRIBUTOS"
 * (PIS 0,31% + COFINS 1,43% + ISS 5%) e o formato `f/(1-f)` é um GROSS-UP:
 * ele devolve o tributo que, somado ao líquido, faz o tributo ser 6,74% do
 * total faturado — não 6,74% do líquido. Trocar por `T*f` erra ~7% do
 * imposto em toda linha, e foi por isso que a fórmula ficou escrita assim.
 *
 * VALOR LÍQUIDO NEGATIVO É RESULTADO LEGÍTIMO: a linha 12 da planilha tem
 * 30,77 de almoço menos 31,69 de VA = -0,92 (o VA descontado no mês passou
 * do que a viagem gerou). Nenhuma das contas aqui trava em zero.
 *
 * Esta função é a MESMA regra de diaria_ufrgs_calcular() no banco
 * (20260930000155). Duplicidade deliberada, igual à de avaliarConflitos():
 * aqui é o total que aparece enquanto a pessoa digita; lá é o valor que
 * vale, porque o front fala direto com o Supabase pela anon key.
 */
export function calcularValoresUfrgs(
  q: QuantidadesUfrgs,
  tarifa: TarifaUfrgs,
): ValoresUfrgs {
  const valorTotalCentavos =
    tarifa.hospedagemCentavos * (q.qtHospedagem || 0) +
    tarifa.cafeCentavos * (q.qtCafe || 0) +
    tarifa.almocoCentavos * (q.qtAlmoco || 0) +
    tarifa.jantaCentavos * (q.qtJanta || 0);
  const valorVaCentavos = tarifa.vaCentavos * (q.qtVa || 0);
  const valorLiquidoCentavos = valorTotalCentavos - valorVaCentavos;
  const f = aliquotaTotal(tarifa);
  const tributosCentavos = arredondar((valorLiquidoCentavos * f) / (1 - f));
  return {
    valorTotalCentavos,
    valorVaCentavos,
    valorLiquidoCentavos,
    tributosCentavos,
    valorFaturarCentavos: valorLiquidoCentavos + tributosCentavos,
  };
}

/**
 * A tarifa que vale para uma diária é a de maior vigência que já começou na
 * DATA DA SAÍDA — não na data de hoje. Lançamento retroativo tem que usar a
 * tabela que valia no dia da viagem, e diária de janeiro reexportada depois
 * do dissídio tem que continuar mostrando o valor que foi faturado.
 */
export function tarifaVigente(
  tarifas: TarifaUfrgs[],
  sindicato: string,
  saida: string,
): TarifaUfrgs | null {
  if (!sindicato || !saida) return null;
  const candidatas = tarifas
    .filter((t) => t.sindicato === sindicato && t.vigenciaInicio <= saida)
    .sort((a, b) => b.vigenciaInicio.localeCompare(a.vigenciaInicio));
  return candidatas[0] ?? null;
}

/** Uma diária UFRGS como a tela a consome. */
export interface DiariaUfrgs extends ValoresUfrgs, QuantidadesUfrgs {
  /** Chave real no banco — é ela que as mutações usam. */
  uuid: string;
  /** Número legível gerado no banco: DU-2026-000123. */
  id: string;
  criadoEm: string;
  status: StatusSolicitacao;

  contratoId: string;
  contratoNome: string;
  contratoCliente: string;
  contratoEmpresa: string;
  /** yyyy-mm-dd, sempre dia 1 — o mês de referência do relatório. */
  competencia: string;

  codFornecedor: string;
  matricula: string;
  motoristaEmpregadoId: number | null;
  motoristaNome: string;
  sindicato: string;
  lotacao: string;
  numeroOficio: string;
  saida: string;
  retorno: string;
  destino: string;
  /**
   * Coluna K. Não é digitada: vem da data em que a despesa da diária foi
   * paga no Malote (derivada na leitura, ver diaria_ufrgs_data_deposito).
   */
  dataDeposito: string | null;
  posto: string;
  postoDescricao: string;
  valorPostoVariavelCentavos: number;
  fiscal: string;
  /** Alíquota total congelada no lançamento (0.0674 na tabela atual). */
  aliquotaTotal: number;
  tarifaId: string | null;

  observacoes: string;
  anexos: AnexoDiariaUfrgs[];

  solicitanteId: string;
  solicitante: string;

  maloteDespesaId: string | null;
  maloteMotivo?: string;
  maloteDataPagamento?: string;
  enviadoMaloteEm?: string;

  decididoPor?: string;
  decididoEm?: string;
  ajusteMotivo?: string;
  ajustePedidoPor?: string;
  ajustePedidoEm?: string;
  exclusaoMotivo?: string;
  excluidaPor?: string;
  excluidaEm?: string;
}

export interface AnexoDiariaUfrgs {
  nome: string;
  tipo: string;
  tamanho: string;
  enviadoEm: string;
  storagePath: string;
}

/**
 * Limite de anexo: 10 MB (10.240 KB) por arquivo.
 *
 * É o teto do bucket 'diarias' (file_size_limit 10485760, criado na
 * 20260930000019) e o mesmo que o modal da diária de diarista já anuncia —
 * o patamar que webmail e formulário web usam por padrão. Acima disso o
 * Storage recusaria o upload de qualquer forma; avisar antes evita a pessoa
 * esperar o envio para só então descobrir.
 */
export const MAX_KB_ANEXO_UFRGS = 10 * 1024;
export const MAX_BYTES_ANEXO_UFRGS = MAX_KB_ANEXO_UFRGS * 1024;

/**
 * Os títulos das colunas, na ordem da planilha (linha 7 da aba).
 *
 * Uma constante só, consumida pela tabela da tela, pelo modal e pela
 * exportação — é o que garante que "o título das colunas do Excel seja o
 * mesmo título dos campos do sistema" continue verdade depois da próxima
 * mudança, em vez de depender de três listas iguais.
 */
export const COLUNAS_UFRGS = [
  { chave: "item", titulo: "Item" },
  { chave: "codFornecedor", titulo: "Cod. Fornecedor" },
  { chave: "matricula", titulo: "Matr." },
  { chave: "motoristaNome", titulo: "Motorista" },
  { chave: "sindicato", titulo: "Sindicato" },
  { chave: "lotacao", titulo: "Lotação" },
  { chave: "numeroOficio", titulo: "N° \r\nOfício" },
  { chave: "saida", titulo: "Saída" },
  { chave: "retorno", titulo: "Retorno" },
  { chave: "destino", titulo: "Destino" },
  { chave: "dataDeposito", titulo: "Data de Depósito" },
  { chave: "posto", titulo: "Posto" },
  { chave: "valorPostoVariavel", titulo: "Valor Posto C/ Variável" },
  { chave: "qtHospedagem", titulo: "Qt. Hosp." },
  { chave: "qtCafe", titulo: "Qt. Café" },
  { chave: "qtAlmoco", titulo: "Qt. Alm." },
  { chave: "qtJanta", titulo: "Qt. Janta" },
  { chave: "valorTotal", titulo: "Valor Total" },
  { chave: "valorVa", titulo: "Valor VA" },
  { chave: "valorLiquido", titulo: "Valor Líquido" },
  { chave: "tributos", titulo: "Tributos" },
  { chave: "valorFaturar", titulo: "Valor à \r\nFaturar" },
  { chave: "fiscal", titulo: "Fiscal" },
] as const;

/** Rótulo de coluna sem o quebra-linha que a planilha usa no cabeçalho. */
export const tituloColuna = (chave: string) =>
  (COLUNAS_UFRGS.find((c) => c.chave === chave)?.titulo ?? chave).replace(/\r?\n/g, " ").trim();

export const MESES_PT = [
  "JANEIRO",
  "FEVEREIRO",
  "MARÇO",
  "ABRIL",
  "MAIO",
  "JUNHO",
  "JULHO",
  "AGOSTO",
  "SETEMBRO",
  "OUTUBRO",
  "NOVEMBRO",
  "DEZEMBRO",
];

/** "2026-01-01" → "JANEIRO". */
export const mesDaCompetencia = (competencia: string) => {
  const m = Number(competencia?.slice(5, 7));
  return MESES_PT[m - 1] ?? "";
};

export const anoDaCompetencia = (competencia: string) => Number(competencia?.slice(0, 4)) || 0;

/** Reais a partir de centavos, já no formato da tela. */
export const brlDeCentavos = (centavos: number) => fmtBRL((centavos || 0) / 100);

/** "01/01/2026 a 31/01/2026" — o subtítulo "Período de ... A ..." do relatório. */
export const periodoTexto = (de: string, ate: string) =>
  de && ate ? `${fmtData(de)} a ${fmtData(ate)}` : "";

/**
 * Duplicidade: o mesmo motorista viajando no mesmo dia em dois ofícios.
 *
 * Aviso, não trava — diferente da diária de diarista, onde data+turno
 * repetidos são sempre erro. Aqui a mesma pessoa PODE ter duas linhas no
 * mesmo dia (ida por um ofício, volta por outro é caso real no contrato), e
 * a planilha tem exemplos disso. Mas digitar a mesma viagem duas vezes
 * também é o erro mais comum de quem lança em sequência, então a tela
 * aponta e deixa a pessoa decidir.
 */
export function sobreposicaoUfrgs(
  alvo: { uuid?: string; motoristaEmpregadoId: number | null; motoristaNome: string; saida: string; retorno: string },
  existentes: DiariaUfrgs[],
): DiariaUfrgs | null {
  if (!alvo.saida || !alvo.retorno) return null;
  const mesmaPessoa = (d: DiariaUfrgs) =>
    alvo.motoristaEmpregadoId != null
      ? d.motoristaEmpregadoId === alvo.motoristaEmpregadoId
      : !!alvo.motoristaNome &&
        d.motoristaNome.trim().toLowerCase() === alvo.motoristaNome.trim().toLowerCase();

  return (
    existentes.find(
      (d) =>
        d.uuid !== alvo.uuid &&
        // Reprovada e excluída não ocupam o dia: nenhuma vira pagamento, e
        // barrar por causa delas impediria justamente o relançamento
        // corrigido. Mesma regra da diária de diarista.
        d.status !== "reprovada" &&
        d.status !== "excluida" &&
        mesmaPessoa(d) &&
        // Intervalos que se cruzam.
        d.saida <= alvo.retorno &&
        d.retorno >= alvo.saida,
    ) ?? null
  );
}
