// =====================================================================
// SST › ASO Periódico — a régua dos vencimentos (src/pages/sst/AsoPeriodico.tsx).
// Com teste em src/test/sst-aso-periodico.test.ts.
//
// 14/11/2026 (mig 20261114100000): o SST deixa de depender da listagem da
// PROTEGE. O vencimento conta do ÚLTIMO ASO (admissional, periódico, retorno
// ou troca de função): 1 ano na UFFS, 2 anos nos demais contratos. A mesma
// régua roda no banco (sst_aso_per_status) — esta cópia serve ao painel, aos
// filtros e à prévia do próximo vencimento no formulário.
//
// 17/11/2026 (SIS-2026-0918, mig 20261117020000): a periodicidade deixou de
// ser regex de "UFFS" no nome — é configuração por contrato
// ("SST_ASO_PERIODICO_CONTRATO", semeada com UFFS = 12 meses), com padrão de
// 24 meses para o resto. A janela de "próximo do vencimento" também virou
// configuração ("SST_ASO_PERIODICO_CONFIG"); 60 dias é só o padrão.
//
// 18/11/2026 (SIS-2026-0886, mig 20261119190000): afastado por
// aposentadoria, benefício do INSS ou licença-maternidade sai das pendências
// (status "Afastado", cartão próprio). Agendado e realizado continuam no
// status deles. Férias e atestado NÃO tiram ninguém. Cálculo na hora, nada
// gravado: a Senior voltou a "Trabalhando" → volta para a lista sozinho.
//
// Parte 2 do mesmo chamado (mig 20261119200000): função e EMPRESA do vínculo
// em destaque, na busca e no filtro — o SST deixa a plataforma da Zielo e
// pede os periódicos pelo ERP.
//
// 19/11/2026 (SIS-2026-0918, retorno do solicitante — "retirados da
// contagem dos periódicos" aposentadoria, aux. doença, licença-maternidade e
// MEI): afastado sai de TODA a contagem do painel, inclusive Previstos,
// Agendados e Realizados (antes só saía das pendências); continua visível no
// cartão "Afastados" e no filtro "Todos". O MEI sai já no banco
// (mig 20261120150000, sst_aso_per_eh_mei) — nem chega à lista.
// =====================================================================

import { empresaDe } from "@/lib/rh/colaboradoresUtils";

/** Padrões do chamado — valem enquanto a configuração não carregou. */
export const DIAS_AVISO = 60;
export const PERIODICIDADE_PADRAO_MESES = 24;

export interface ContratoPeriodicidade {
  contrato_id: string;
  nome: string;
  status: string;
  /** null = usa o padrão. */
  periodicidade_meses: number | null;
  motivo: string | null;
  atualizado_por_nome: string | null;
  colaboradores: number;
}

export interface ConfigAsoPeriodico {
  dias_aviso: number;
  periodicidade_padrao_meses: number;
  atualizado_por_nome: string | null;
  updated_at: string | null;
  contratos: ContratoPeriodicidade[];
  /** Ativos cujo contrato não foi identificado (usam o padrão). */
  sem_contrato: number;
}

export type StatusAsoPeriodico =
  | "Vencido"
  | "Próximo do vencimento"
  | "Aguardando agendamento"
  | "Agendado"
  | "Realizado/recebido"
  | "Em dia"
  | "Sem ASO"
  | "Afastado";

/** Ordem da tela: o que pede ação primeiro. */
export const STATUS_PERIODICO: StatusAsoPeriodico[] = [
  "Vencido", "Próximo do vencimento", "Aguardando agendamento", "Agendado", "Realizado/recebido", "Em dia", "Sem ASO", "Afastado",
];

/** Motivos que tiram do periódico (SIS-2026-0886). Férias e atestado não estão aqui de propósito. */
export type MotivoAfastamento = "aposentadoria" | "beneficio_inss" | "licenca_maternidade";

export const ROTULO_MOTIVO_AFASTAMENTO: Record<MotivoAfastamento, string> = {
  aposentadoria: "Aposentadoria",
  beneficio_inss: "Benefício do INSS",
  licenca_maternidade: "Licença-maternidade",
};

export interface AfastamentoPeriodico {
  motivo: MotivoAfastamento;
  /** Situação da Senior como veio ("Auxílio Doença", "Licença Maternidade"...). */
  situacao: string | null;
  desde: string | null;
  /** Do Controle de Afastamentos; null quando não há previsão. */
  previsao_retorno: string | null;
  fonte: "senior" | "controle_afastamentos";
}

/**
 * Situação da Senior → motivo que tira do periódico. Espelho de
 * sst_aso_per_motivo_afastamento (mig 20261119190000). null = continua.
 */
export function motivoAfastamento(situacao: string | null | undefined): MotivoAfastamento | null {
  const s = (situacao ?? "").trim().toUpperCase();
  if (!s || s === "TRABALHANDO") return null;
  if (/AVISO/.test(s) || /^(DEMIT|DESLIG|RESCIS)/.test(s)) return null;
  if (/F[EÉ]RIAS/.test(s)) return null;
  if (/(APOSENT|INVALIDEZ)/.test(s)) return "aposentadoria";
  if (/MATERN/.test(s)) return "licenca_maternidade";
  if (/ATEST/.test(s)) return null;
  if (/(AT[EÉ]\s*15|15\s*DIAS|PRIMEIROS)/.test(s)) return null;
  if (/(AUX|DOEN|INSS|BENEF|ACIDENT|PREVID)/.test(s)) return "beneficio_inss";
  return null;
}

/** Afastado fica fora das pendências; agendado e realizado continuam no status deles. */
export const statusComAfastamento = (status: StatusAsoPeriodico, afastado: boolean): StatusAsoPeriodico =>
  afastado && status !== "Agendado" && status !== "Realizado/recebido" ? "Afastado" : status;

export type TipoUltimoAso = "admissional" | "periodico" | "retorno" | "troca_funcao" | "admissao_estimada";

export const ROTULO_TIPO: Record<TipoUltimoAso, string> = {
  admissional: "Admissional",
  periodico: "Periódico",
  retorno: "Retorno ao trabalho",
  troca_funcao: "Troca de função",
  admissao_estimada: "Estimado pela admissão",
};

export interface CicloPeriodico {
  id: number;
  cpf: string;
  periodicidade_meses: number;
  vencimento_previsto: string | null;
  solicitado_em: string | null;
  agendado_para: string | null;
  clinica: string | null;
  realizado: boolean;
  realizado_em: string | null;
  resultado: "apto" | "inapto" | null;
  aso_path: string | null;
  aso_nome: string | null;
  observacao: string | null;
  created_por_nome: string | null;
  atualizado_por_nome: string | null;
  updated_at: string;
}

export interface ItemPeriodico {
  cpf: string;
  empregado_id: number | null;
  nome: string;
  situacao: string | null;
  filial_nome: string | null;
  contrato_id?: string | null;
  contrato_nome: string | null;
  cargo: string | null;
  admissao: string | null;
  ultimo_aso: string | null;
  ultimo_tipo: TipoUltimoAso | null;
  periodicidade_meses: number;
  /** 'contrato' = configurada no contrato; 'padrao' = sem configuração ou sem contrato identificado. */
  periodicidade_origem?: "contrato" | "padrao";
  vencimento: string | null;
  status: StatusAsoPeriodico;
  ciclo: CicloPeriodico | null;
  ultimo_periodico: CicloPeriodico | null;
  /** SIS-2026-0886: preenchido só para quem está afastado hoje por um dos três motivos. */
  afastamento?: AfastamentoPeriodico | null;
  /** SIS-2026-0886 parte 2 (mig 20261119200000): numemp da Senior ("1", "2"...) e o nome dela. */
  empresa_codigo?: string | null;
  empresa_nome?: string | null;
}

/**
 * Empresa do vínculo como as telas de RH mostram (HAGG, SN, CANAÃ, NH): a
 * mesma régua de src/lib/rh/colaboradoresUtils.ts (empresaDe). "—" sem dado.
 */
export const empresaDoItem = (i: Pick<ItemPeriodico, "empresa_codigo" | "empresa_nome">): string =>
  empresaDe({ Empresa: i.empresa_codigo ?? "", "Nome da Empresa": i.empresa_nome ?? "" });

/** Função para exibição: o "Título do Cargo" da Senior, ou o aviso de que falta. */
export const funcaoDoItem = (i: Pick<ItemPeriodico, "cargo">): string => i.cargo?.trim() || "Sem função na Senior";

/** Busca da lista: nome, empresa, contrato, função e clínica. */
export function casaBusca(i: ItemPeriodico, busca: string): boolean {
  const q = busca.trim().toLowerCase();
  if (!q) return true;
  return [i.nome, empresaDoItem(i), i.empresa_nome, nomeContrato(i), i.cargo, i.ciclo?.clinica]
    .some((v) => String(v ?? "").toLowerCase().includes(q));
}

export const hojeIso = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const fmtData = (iso?: string | null): string => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

export const diasEntre = (de: string, ate: string): number =>
  Math.round((Date.parse(`${ate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${de.slice(0, 10)}T00:00:00Z`)) / 86400000);

const somaDias = (iso: string, dias: number): string => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/**
 * Periodicidade efetiva de um contrato: a configurada nele, senão o padrão.
 * Contrato não identificado (null) também cai no padrão — a mesma régua do
 * banco (sst_aso_per_base).
 */
export function periodicidadeMeses(
  contratoId: string | null | undefined,
  porContrato: Pick<ContratoPeriodicidade, "contrato_id" | "periodicidade_meses">[],
  padrao = PERIODICIDADE_PADRAO_MESES,
): number {
  if (!contratoId) return padrao;
  return porContrato.find((c) => c.contrato_id === contratoId)?.periodicidade_meses ?? padrao;
}

/** "1 ano", "2 anos", "6 meses", "18 meses". */
export function rotuloPeriodicidade(meses: number): string {
  if (meses % 12 === 0) return meses === 12 ? "1 ano" : `${meses / 12} anos`;
  return meses === 1 ? "1 mês" : `${meses} meses`;
}

/** Validação da tela de configuração (a mesma faixa dos CHECKs do banco). */
export function erroConfig(diasAviso: number, padraoMeses: number): string | null {
  if (!Number.isInteger(diasAviso) || diasAviso < 1 || diasAviso > 365) return "Dias de aviso: informe de 1 a 365.";
  if (!Number.isInteger(padraoMeses) || padraoMeses < 1 || padraoMeses > 60) return "Periodicidade padrão: informe de 1 a 60 meses.";
  return null;
}

export const erroMesesContrato = (meses: number): string | null =>
  !Number.isInteger(meses) || meses < 1 || meses > 60 ? "Periodicidade: informe de 1 a 60 meses." : null;

/** Soma meses como o Postgres (date + interval): 29/02 + 12 meses = 28/02. */
export function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = total % 12;
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}

export const calcularVencimento = (ultimoAso: string | null | undefined, meses: number): string | null =>
  ultimoAso ? somarMeses(ultimoAso, meses) : null;

export function statusPeriodico(p: {
  vencimento: string | null;
  ultimo_tipo: TipoUltimoAso | null;
  ciclo: Pick<CicloPeriodico, "agendado_para"> | null;
}, hoje: string, diasAviso = DIAS_AVISO): StatusAsoPeriodico {
  if (p.ciclo) return p.ciclo.agendado_para ? "Agendado" : "Aguardando agendamento";
  if (!p.vencimento) return "Sem ASO";
  if (p.vencimento < hoje) return "Vencido";
  if (p.vencimento <= somaDias(hoje, diasAviso)) return "Próximo do vencimento";
  if (p.ultimo_tipo === "periodico") return "Realizado/recebido";
  return "Em dia";
}

/** Dias até o vencimento (negativo = vencido há tantos dias). */
export const diasParaVencer = (p: Pick<ItemPeriodico, "vencimento">, hoje: string): number | null =>
  p.vencimento ? diasEntre(hoje, p.vencimento) : null;

export type ChavePainel = "previstos" | "proximos" | "vencidos" | "aguardando" | "agendados" | "realizados" | "afastados";

export const PAINEL: { chave: ChavePainel; titulo: string; status: StatusAsoPeriodico[] }[] = [
  { chave: "previstos", titulo: "Periódicos previstos", status: ["Vencido", "Próximo do vencimento", "Aguardando agendamento", "Agendado", "Realizado/recebido"] },
  { chave: "proximos", titulo: "Próximos do vencimento", status: ["Próximo do vencimento"] },
  { chave: "vencidos", titulo: "Vencidos", status: ["Vencido"] },
  { chave: "aguardando", titulo: "Aguardando agendamento", status: ["Aguardando agendamento"] },
  { chave: "agendados", titulo: "Agendados", status: ["Agendado"] },
  { chave: "realizados", titulo: "Realizados/recebidos", status: ["Realizado/recebido"] },
];

/** Cartão à parte (não é pendência): todo afastado, inclusive agendado ou realizado. */
export const CARTAO_AFASTADOS = { chave: "afastados" as const, titulo: "Afastados (fora das pendências)" };

export function contarPainel(itens: Pick<ItemPeriodico, "status" | "afastamento">[]): Record<ChavePainel, number> {
  const r: Record<ChavePainel, number> = { previstos: 0, proximos: 0, vencidos: 0, aguardando: 0, agendados: 0, realizados: 0, afastados: 0 };
  for (const i of itens) {
    // Afastado (aposentadoria, INSS, licença-maternidade) só conta no próprio cartão.
    if (i.afastamento) { r.afastados++; continue; }
    for (const p of PAINEL) if (p.status.includes(i.status)) r[p.chave]++;
  }
  return r;
}

/** Entra nos números/filtros do painel (Previstos e os cinco status)? Afastado não. */
export const contaNoPainel = (i: Pick<ItemPeriodico, "afastamento">): boolean => !i.afastamento;

/** Afastados: previsão de retorno mais próxima primeiro (é quem o SST vai precisar chamar); sem previsão por último. */
export function ordenarAfastados(a: ItemPeriodico, b: ItemPeriodico): number {
  return (a.afastamento?.previsao_retorno ?? "9999").localeCompare(b.afastamento?.previsao_retorno ?? "9999")
    || a.nome.localeCompare(b.nome);
}

/** Contrato para filtro e exibição: o identificado, senão a filial da Senior. */
export const nomeContrato = (i: Pick<ItemPeriodico, "contrato_nome" | "filial_nome">): string =>
  i.contrato_nome || i.filial_nome || "Sem contrato";

/** Ordem da lista: status (ação primeiro) e, dentro dele, o vencimento mais próximo. */
export function ordenar(a: ItemPeriodico, b: ItemPeriodico): number {
  return STATUS_PERIODICO.indexOf(a.status) - STATUS_PERIODICO.indexOf(b.status)
    || String(a.vencimento ?? "").localeCompare(String(b.vencimento ?? ""))
    || a.nome.localeCompare(b.nome);
}

/** O que falta para fechar um ciclo, na ordem do fluxo (vazio = pode marcar realizado). */
export function pendenciasParaRealizar(c: { realizado_em?: string | null; resultado?: string | null }, hoje: string): string[] {
  const f: string[] = [];
  if (!c.realizado_em) f.push("data da realização");
  else if (c.realizado_em > hoje) f.push("data da realização não pode ser futura");
  if (!c.resultado) f.push("resultado (apto ou inapto)");
  return f;
}
