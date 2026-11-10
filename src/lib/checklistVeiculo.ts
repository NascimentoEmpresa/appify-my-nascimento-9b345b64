/**
 * Checklist de SAÍDA e de CHEGADA do Agendamento de Veículos (04/11/2026).
 *
 * Substitui o formulário antigo "Checklist Veículos Retorno". Do formulário
 * saíram as perguntas que o sistema já sabe — nome do condutor (é quem
 * agendou) e qual veículo (é o do agendamento) —; ficaram as fotos.
 *
 * Regra do Pablo: NADA bloqueia. Quem não preencheu continua agendando outro
 * carro; o que muda é que o novo agendamento nasce com o texto explícito
 * "FULANO NÃO PREENCHEU A SAÍDA E A CHEGADA…" no histórico, e a pessoa recebe
 * o aviso "VOCÊ PRECISA PREENCHER A CHEGADA do veículo X".
 *
 * Esta lib é a régua da TELA (banner, chips do card). O banco tem a mesma
 * régua em SQL — cs_veic_checklist_pendencias() na migration
 * 20261105009300_veiculos_checklist_saida_chegada.sql —, que é quem escreve
 * o histórico e manda o sino. Mudou aqui, muda lá.
 */

export type TipoChecklist = "saida" | "chegada";
export type TurnoChecklist = "manha" | "tarde" | "dia_todo";

export const LABEL_TIPO_CHECKLIST: Record<TipoChecklist, string> = {
  saida: "Checklist de saída",
  chegada: "Checklist de chegada",
};

/** Hora em que cada turno começa / termina (mesmo HORARIO_TURNO da tela). */
export const HORA_INICIO_TURNO: Record<TurnoChecklist, number> = { manha: 8, tarde: 13, dia_todo: 8 };
export const HORA_FIM_TURNO: Record<TurnoChecklist, number> = { manha: 12, tarde: 18, dia_todo: 18 };

/** As fotos do checklist, na ordem do formulário antigo. */
export const FOTOS_UNICAS = [
  { campo: "foto_lateral_direita", rotulo: "Foto lateral direita" },
  { campo: "foto_lateral_esquerda", rotulo: "Foto lateral esquerda" },
  { campo: "foto_dianteira", rotulo: "Foto dianteira" },
  { campo: "foto_traseira", rotulo: "Foto traseira" },
] as const;
export type CampoFotoUnica = (typeof FOTOS_UNICAS)[number]["campo"] | "foto_km";

/** Quantas fotos do interior o formulário pede. */
export const FOTOS_INTERIOR_EXIGIDAS = 4;

export interface ChecklistVeiculo {
  id?: string;
  agendamento_id: string;
  tipo: TipoChecklist;
  realizado_em?: string | null;
  km?: number | null;
  foto_lateral_direita: string | null;
  foto_lateral_esquerda: string | null;
  foto_dianteira: string | null;
  foto_traseira: string | null;
  fotos_interior: string[] | null;
  foto_km: string | null;
  fotos_defeito?: string[] | null;
  observacao?: string | null;
  condutor_nome?: string | null;
  preenchido_por_nome?: string | null;
  /** Coluna gerada no banco; a tela recalcula com checklistCompleto() quando não vier. */
  completo?: boolean | null;
  /** Prestação da viagem (chegada, mig 20261110200000). */
  video_veiculo?: string | null;
  agua_verificada?: boolean | null;
  oleo_verificado?: boolean | null;
  /** Possível avaria: true/false; null = não respondido. */
  avaria?: boolean | null;
  avaria_descricao?: string | null;
}

/** O mínimo do agendamento que a régua precisa. */
export interface AgendamentoParaChecklist {
  id: string;
  numero: number;
  veiculo_nome: string;
  veiculo_identificador?: string | null;
  data_inicio: string; // YYYY-MM-DD
  data_fim: string; // YYYY-MM-DD
  turno: TurnoChecklist;
  status: string;
  solicitante_nome?: string | null;
  /** false = agendamento anterior ao checklist (não cobra nada). */
  checklist_exigido?: boolean | null;
  /** "Não usei o carro no dia" (mig 20261105009200): não cobra checklist. */
  nao_utilizado_em?: string | null;
  /** Provável data/hora da chegada, ISO. Ausente em agendamento antigo. */
  chegada_prevista?: string | null;
}

export interface Pendencia {
  saida: boolean;
  chegada: boolean;
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** "2026-11-04" + 8 → Date local às 08:00. */
function dataComHora(iso: string, hora: number): Date {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d, hora, 0, 0, 0);
}

/** Quando a viagem começa: dia da saída na hora de início do turno. */
export function inicioDoAgendamento(a: Pick<AgendamentoParaChecklist, "data_inicio" | "turno">): Date {
  return dataComHora(a.data_inicio, HORA_INICIO_TURNO[a.turno] ?? 8);
}

/** Sugestão para o campo "provável chegada": dia do retorno no fim do turno, no formato do datetime-local. */
export function chegadaPrevistaPadrao(dataFim: string, turno: TurnoChecklist): string {
  return `${dataFim}T${doisDigitos(HORA_FIM_TURNO[turno] ?? 18)}:00`;
}

/** Quando a chegada passa a ser cobrada: a provável chegada; sem ela (antigo), o fim do turno do retorno. */
export function chegadaDoAgendamento(a: Pick<AgendamentoParaChecklist, "data_fim" | "turno" | "chegada_prevista">): Date {
  if (a.chegada_prevista) {
    const d = new Date(a.chegada_prevista);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return dataComHora(a.data_fim, HORA_FIM_TURNO[a.turno] ?? 18);
}

/**
 * Valida o campo "provável data/hora da chegada" do Novo Agendamento.
 * Devolve a mensagem de erro, ou null quando está tudo certo.
 */
export function validarChegadaPrevista(
  valor: string,
  a: Pick<AgendamentoParaChecklist, "data_inicio" | "turno">,
): string | null {
  if (!valor?.trim()) return "Informe a provável data e hora da chegada.";
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return "Data/hora da chegada inválida.";
  if (d.getTime() < inicioDoAgendamento(a).getTime()) return "A chegada não pode ser antes da saída.";
  return null;
}

/** Rótulos do que ainda falta num checklist (vazio = completo). */
export function camposFaltando(c: ChecklistVeiculo | null | undefined): string[] {
  const falta: string[] = [];
  for (const f of FOTOS_UNICAS) if (!c?.[f.campo]) falta.push(f.rotulo);
  const interior = c?.fotos_interior?.filter(Boolean).length ?? 0;
  if (interior < FOTOS_INTERIOR_EXIGIDAS) {
    const faltam = FOTOS_INTERIOR_EXIGIDAS - interior;
    falta.push(`${faltam} foto${faltam > 1 ? "s" : ""} do interior`);
  }
  if (!c?.foto_km) falta.push("Foto do KM");
  return falta;
}

export function checklistCompleto(c: ChecklistVeiculo | null | undefined): boolean {
  if (!c) return false;
  if (typeof c.completo === "boolean") return c.completo;
  return camposFaltando(c).length === 0;
}

/** Situação de um checklist para o chip do card. */
export type SituacaoChecklist = "preenchido" | "incompleto" | "pendente" | "aguardando" | "nao_exigido";

export function situacaoChecklist(
  a: AgendamentoParaChecklist,
  tipo: TipoChecklist,
  c: ChecklistVeiculo | null | undefined,
  agora: Date = new Date(),
): SituacaoChecklist {
  if (checklistCompleto(c)) return "preenchido";
  if (c) return "incompleto";
  if (a.status === "cancelado" || !a.checklist_exigido || a.nao_utilizado_em) return "nao_exigido";
  const devido = tipo === "saida" ? inicioDoAgendamento(a) : chegadaDoAgendamento(a);
  return agora.getTime() >= devido.getTime() ? "pendente" : "aguardando";
}

/**
 * O que está ATRASADO num agendamento: a saída depois que a viagem começou,
 * a chegada depois da provável chegada. Agendamento cancelado ou anterior ao
 * checklist não cobra nada. Checklist incompleto conta como não preenchido.
 */
export function pendenciasDoAgendamento(
  a: AgendamentoParaChecklist,
  checklists: ChecklistVeiculo[],
  agora: Date = new Date(),
): Pendencia {
  if (a.status === "cancelado" || !a.checklist_exigido || a.nao_utilizado_em) return { saida: false, chegada: false };
  const doTipo = (t: TipoChecklist) => checklists.find((c) => c.agendamento_id === a.id && c.tipo === t);
  return {
    saida: !checklistCompleto(doTipo("saida")) && agora.getTime() >= inicioDoAgendamento(a).getTime(),
    chegada: !checklistCompleto(doTipo("chegada")) && agora.getTime() >= chegadaDoAgendamento(a).getTime(),
  };
}

const formatarDataBR = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};

/** "A SAÍDA E A CHEGADA" | "A SAÍDA" | "A CHEGADA" | null. */
export function oQueFalta(p: Pendencia): string | null {
  if (p.saida && p.chegada) return "A SAÍDA E A CHEGADA";
  if (p.saida) return "A SAÍDA";
  if (p.chegada) return "A CHEGADA";
  return null;
}

function veiculoEData(a: AgendamentoParaChecklist): string {
  const placa = a.veiculo_identificador ? ` ${a.veiculo_identificador}` : "";
  const periodo = a.data_fim && a.data_fim !== a.data_inicio
    ? `${formatarDataBR(a.data_inicio)} a ${formatarDataBR(a.data_fim)}`
    : formatarDataBR(a.data_inicio);
  return `${a.veiculo_nome}${placa} · ${periodo}`;
}

/**
 * O texto que vai para o histórico do agendamento NOVO quando a pessoa agenda
 * com checklist atrasado de um anterior — exatamente como o banco escreve:
 *   "FULANO NÃO PREENCHEU A SAÍDA E A CHEGADA do agendamento nº 13 (HILUX JBZ-4D93 · 26/01/2030)"
 */
export function textoHistoricoPendencia(
  nome: string | null | undefined,
  a: AgendamentoParaChecklist,
  p: Pendencia,
): string | null {
  const falta = oQueFalta(p);
  if (!falta) return null;
  const quem = (nome?.trim() || "USUÁRIO SEM NOME").toUpperCase();
  return `${quem} NÃO PREENCHEU ${falta} do agendamento nº ${a.numero} (${veiculoEData(a)})`;
}

/** O aviso na tela de quem agendou: "VOCÊ PRECISA PREENCHER A CHEGADA do veículo HILUX (nº 13)". */
export function avisoParaUsuario(a: AgendamentoParaChecklist, p: Pendencia): string | null {
  const falta = oQueFalta(p);
  if (!falta) return null;
  return `VOCÊ PRECISA PREENCHER ${falta} do veículo ${a.veiculo_nome} (agendamento nº ${a.numero}, ${veiculoEData(a).split(" · ")[1]})`;
}

/** Todos os agendamentos da pessoa com algo atrasado, do mais antigo para o mais novo. */
export function agendamentosComPendencia<T extends AgendamentoParaChecklist>(
  agendamentos: T[],
  checklists: ChecklistVeiculo[],
  agora: Date = new Date(),
): { agendamento: T; pendencia: Pendencia }[] {
  return agendamentos
    .map((agendamento) => ({ agendamento, pendencia: pendenciasDoAgendamento(agendamento, checklists, agora) }))
    .filter((x) => x.pendencia.saida || x.pendencia.chegada)
    .sort((x, y) => x.agendamento.data_inicio.localeCompare(y.agendamento.data_inicio) || x.agendamento.numero - y.agendamento.numero);
}
