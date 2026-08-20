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
