// =====================================================================
// Agendamento de Veículos — o DIA, a PRESTAÇÃO da viagem e o KM sem
// registro (10/11/2026, mig 20261110200000).
//
// Pedido (Cássio / Senilton):
//   · "conforme os agendamentos diários precisa aparecer o agendamento do
//     dia [...] quais os carros agendados estão realmente em rota no momento
//     e com checklist de início realizado";
//   · "não permitisse realizar o início do novo trajeto se o responsável tiver
//     viagem pendente de informação da última viagem: km de saída, km de
//     retorno, foto da nota do combustível, vídeo completo do veículo,
//     verificação de água e óleo e se tem uma possível avaria";
//   · "puxar sempre em cada veículo o último km informado pelo último
//     condutor [...] saber se tem alguém utilizando o veículo e não está
//     agendando ou não está fazendo checklist".
//
// Conta pura (sem React, sem banco), com teste. A prestação tem espelho no
// banco: cs_veic_prestacao_faltando() — mudou aqui, muda lá. Quem barra o
// início é o banco; aqui é o que a tela mostra.
// =====================================================================

import { HORA_INICIO_TURNO, type ChecklistVeiculo, type TurnoChecklist } from "@/lib/checklistVeiculo";

/** O mínimo da viagem que a prestação e o dia precisam. */
export interface ViagemDoDia {
  id: string;
  numero: number;
  patrimonio_id: string;
  veiculo_nome: string;
  veiculo_identificador?: string | null;
  data_inicio: string;
  data_fim: string;
  turno: TurnoChecklist;
  status: string;
  solicitante_nome?: string | null;
  km_inicial?: number | null;
  km_inicial_em?: string | null;
  km_final?: number | null;
  finalizada_em?: string | null;
  nao_utilizado_em?: string | null;
  sem_abastecimento?: boolean | null;
  prestacao_exigida?: boolean | null;
  km_anterior?: number | null;
  km_anterior_em?: string | null;
  km_anterior_numero?: number | null;
  km_anterior_condutor?: string | null;
  destino?: string | null;
}

/** O que falta na prestação — mesma régua de cs_veic_prestacao_faltando(). */
export function faltandoPrestacao(
  a: Pick<ViagemDoDia, "km_inicial" | "km_final" | "sem_abastecimento">,
  chegada: Pick<ChecklistVeiculo, "video_veiculo" | "agua_verificada" | "oleo_verificado" | "avaria" | "avaria_descricao"> | null | undefined,
  temNotaCombustivel: boolean,
): string[] {
  const f: string[] = [];
  if (a.km_inicial == null) f.push("KM de saída");
  if (a.km_final == null) f.push("KM de retorno");
  if (!a.sem_abastecimento && !temNotaCombustivel) f.push('Foto da nota do combustível (ou "não abasteci")');
  if (!chegada?.video_veiculo) f.push("Vídeo completo do veículo");
  if (!chegada?.agua_verificada || !chegada?.oleo_verificado) f.push("Verificação de água e óleo");
  if (chegada?.avaria == null) f.push("Informar se há avaria");
  else if (chegada.avaria && !(chegada.avaria_descricao ?? "").trim()) f.push("Descrição da avaria");
  return f;
}

// ---- O dia ----------------------------------------------------------------

export type EstadoDoDia = "aguardando" | "saida_atrasada" | "em_rota" | "retornou" | "nao_utilizado";

export const ROTULO_ESTADO: Record<EstadoDoDia, string> = {
  aguardando: "Aguardando saída",
  saida_atrasada: "Não saiu / sem checklist",
  em_rota: "Em rota",
  retornou: "Retornou",
  nao_utilizado: "Não utilizado",
};
export const ORDEM_ESTADO: EstadoDoDia[] = ["em_rota", "saida_atrasada", "aguardando", "retornou", "nao_utilizado"];

export interface LinhaDoDia {
  viagem: ViagemDoDia;
  estado: EstadoDoDia;
  /** Checklist de saída com todas as fotos. */
  saidaCompleta: boolean;
  /** Quando saiu (checklist de saída ou KM inicial). */
  saiuEm: string | null;
}

const hojeBR = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

/** Minutos de agora no fuso de Brasília desde 00:00 de `hoje`. */
function minutoAgoraBR(agora: Date): number {
  const s = agora.toLocaleTimeString("sv-SE", { timeZone: "America/Sao_Paulo" });
  return +s.slice(0, 2) * 60 + +s.slice(3, 5);
}

/**
 * Em que pé está a viagem hoje:
 *   · não utilizado → marcou "Não usei o carro";
 *   · retornou      → checklist de chegada, KM de retorno ou viagem finalizada;
 *   · em rota       → saiu (checklist de saída ou KM inicial) e não voltou;
 *   · não saiu      → já passou a hora de início do turno no 1º dia e nada de saída;
 *   · aguardando    → ainda não chegou a hora.
 */
export function estadoDoDia(
  a: ViagemDoDia, saida: ChecklistVeiculo | null | undefined, chegada: ChecklistVeiculo | null | undefined,
  hoje = hojeBR(), agora = new Date(),
): LinhaDoDia {
  const saiuEm = saida?.realizado_em ?? (a.km_inicial != null ? a.km_inicial_em ?? null : null);
  const saiu = !!saida || a.km_inicial != null;
  let estado: EstadoDoDia;
  if (a.nao_utilizado_em) estado = "nao_utilizado";
  else if (chegada || a.km_final != null || a.finalizada_em) estado = "retornou";
  else if (saiu) estado = "em_rota";
  else if (a.data_inicio < hoje || minutoAgoraBR(agora) >= HORA_INICIO_TURNO[a.turno] * 60) estado = "saida_atrasada";
  else estado = "aguardando";
  return { viagem: a, estado, saidaCompleta: !!saida?.completo, saiuEm };
}

/** As viagens de hoje (não canceladas), com o estado, na ordem do painel. */
export function viagensDoDia(
  lista: ViagemDoDia[], checklists: ChecklistVeiculo[], hoje = hojeBR(), agora = new Date(),
): LinhaDoDia[] {
  const ck = new Map(checklists.map((c) => [`${c.agendamento_id}:${c.tipo}`, c]));
  return lista
    .filter((a) => a.status !== "cancelado" && a.data_inicio <= hoje && hoje <= a.data_fim)
    .map((a) => estadoDoDia(a, ck.get(`${a.id}:saida`), ck.get(`${a.id}:chegada`), hoje, agora))
    .sort((x, y) => ORDEM_ESTADO.indexOf(x.estado) - ORDEM_ESTADO.indexOf(y.estado)
      || x.viagem.veiculo_nome.localeCompare(y.viagem.veiculo_nome, "pt-BR") || x.viagem.numero - y.viagem.numero);
}

export function contarEstados(linhas: LinhaDoDia[]): Record<EstadoDoDia, number> {
  const c = { aguardando: 0, saida_atrasada: 0, em_rota: 0, retornou: 0, nao_utilizado: 0 } as Record<EstadoDoDia, number>;
  for (const l of linhas) c[l.estado]++;
  return c;
}

// ---- KM sem registro --------------------------------------------------------

export interface AlertaKm {
  viagem: ViagemDoDia;
  /** km_inicial − km_anterior. > 0: rodou sem registro; < 0: saída menor que o último (digitação?). */
  diferenca: number;
  tipo: "sem_registro" | "menor";
}

/**
 * Viagens cujo KM de saída não bate com o último KM do carro: alguém andou
 * com ele sem agendar ou sem checklist (ou digitou errado). `tolerancia` em
 * km absorve arredondamento do painel.
 */
export function alertasKm(lista: ViagemDoDia[], desde: string | null = null, tolerancia = 0): AlertaKm[] {
  return lista
    .filter((a) => a.status !== "cancelado" && a.km_inicial != null && a.km_anterior != null && (!desde || a.data_inicio >= desde))
    .map((a) => ({ viagem: a, diferenca: a.km_inicial! - a.km_anterior! }))
    .filter((x) => Math.abs(x.diferenca) > tolerancia)
    .map((x) => ({ ...x, tipo: x.diferenca > 0 ? "sem_registro" as const : "menor" as const }))
    .sort((x, y) => y.viagem.data_inicio.localeCompare(x.viagem.data_inicio) || Math.abs(y.diferenca) - Math.abs(x.diferenca));
}
