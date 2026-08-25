// Jurídico / Patrimônio — o vocabulário da carteira.
//
// As listas saem da planilha ATIVO IMOBILIZADO, que é o cadastro real: os
// valores aqui são os que já existem no banco depois da importação. Deixá-las
// num arquivo só evita que a tela de cadastro ofereça uma opção e o filtro da
// lista ofereça outra.

/** Classificação do bem, como a planilha escreve (caixa alta, sem acento no dado). */
export const CLASSIFICACOES = [
  "CASA", "PRÉDIO", "TERRENO", "SALA", "COMERCIAL", "CONDOMÍNIO", "CHÁCARA",
  "APARTAMENTO", "GARAGEM", "COTAS", "OUTROS",
];

/** Posição financeira — diferente do status do cadastro (Ativo/Inativo). */
export const SITUACOES_PAGAMENTO = ["PAGO", "PAGANDO", "VENCIDO", "AGUARDANDO"];

/** Espécie do documento que prova a posse. */
export const ESPECIES_ESCRITURA = [
  "ESCRITURA", "ESCRITURA (NÃO REGIS.)", "INSTRUMENTO PART.",
  "ATA DE ASSEMBLEIA", "CONTRATO DE COMPRA E VENDA", "CORPO ÚNICO", "OUTROS",
];

/** Cor do selo de situação — a mesma régua na tabela e no drawer. */
export function corSituacao(s?: string | null): { bg: string; fg: string } {
  const v = String(s ?? "").toUpperCase();
  if (v.startsWith("PAGO")) return { bg: "#dcfce7", fg: "#15803d" };
  if (v.startsWith("PAGANDO")) return { bg: "#dbeafe", fg: "#1d4ed8" };
  if (v.startsWith("VENC")) return { bg: "#fee2e2", fg: "#b91c1c" };
  if (v.startsWith("AGUARD")) return { bg: "#fef9c3", fg: "#a16207" };
  return { bg: "#f1f5f9", fg: "#64748b" };
}

// Coordenadas das cidades onde a carteira tem imóvel. O cadastro guarda o
// nome da cidade, não a coordenada — geocodificar a cada abertura de tela
// seria uma chamada externa por patrimônio, para um mapa que só precisa
// mostrar em que cidade está o quê.
const COORD: Record<string, [number, number]> = {
  TRIUNFO: [-29.9447, -51.7186],
  "CAPAO DA CANOA": [-29.7456, -50.0094],
  MONTENEGRO: [-29.6883, -51.4611],
  "XANGRI-LA": [-29.8117, -50.0508],
  "PORTO ALEGRE": [-30.0346, -51.2177],
  CANOAS: [-29.9177, -51.1836],
  ESTEIO: [-29.8608, -51.1789],
  "SAO JERONIMO": [-29.9589, -51.7228],
  OSORIO: [-29.8869, -50.2697],
  TRAMANDAI: [-29.9847, -50.1336],
  GRAVATAI: [-29.9444, -50.9919],
  "NOVO HAMBURGO": [-29.6783, -51.1306],
};

const chaveCidade = (c?: string | null) =>
  String(c ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

export const coordDaCidade = (cidade?: string | null): [number, number] | null =>
  COORD[chaveCidade(cidade)] ?? null;

/** Cores dos pinos, na ordem em que as cidades aparecem na legenda. */
export const CORES_CIDADE = ["#f59e0b", "#2563eb", "#16a34a", "#7c3aed", "#db2777", "#0891b2", "#dc2626"];

// =====================================================================
// O formulário de patrimônio: quais campos ele edita.
// =====================================================================

/**
 * O formulário vazio — e, junto com ele, a lista fechada de colunas que a
 * tela de patrimônio pode gravar. Tudo texto porque são inputs controlados:
 * número e booleano são convertidos na hora de salvar.
 */
export const PATRIM_RESET = {
  codigo: "", tipo: "Imóvel", descricao: "", localizacao: "", placa: "", cidade: "",
  transferida: "Não", empresa: "", empresa_pagadora: "", proprietario: "", responsavel: "",
  centro_custo: "", status: "Ativo", observacoes: "",
  classificacao: "", matricula: "", possui_escritura: "", especie_escritura: "",
  situacao_pagamento: "", valor_contrato: "", valor_entrada: "", valor_estimado: "",
  latitude: "", longitude: "",
};

export const CAMPOS_PATRIMONIO = Object.keys(PATRIM_RESET) as (keyof typeof PATRIM_RESET)[];

/**
 * Só os campos do formulário — é o que vai para o INSERT/UPDATE.
 *
 * Abrir um patrimônio para editar espalha a linha INTEIRA do SELECT no estado
 * do formulário, então ele carrega junto o `id`, o `created_at` e as colunas
 * de rollup das parcelas. Devolver isso num UPDATE quebrava o salvar: `id` é
 * GENERATED ALWAYS AS IDENTITY e o Postgres recusa
 * ("column \"id\" can only be updated to DEFAULT").
 *
 * Filtrar só o `id` calaria a mensagem, mas continuaria devolvendo
 * valor_falta / parcelas_pagas / proxima_parcela com o valor que estava na
 * tela quando o modal abriu — e esses são recalculados a partir das parcelas.
 * Corrigir o endereço de um imóvel não pode ressuscitar parcela velha.
 */
export const soCamposDoForm = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(CAMPOS_PATRIMONIO.map(k => [k, o[k]]));
