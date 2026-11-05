// =====================================================================
// HORA EXTRA — limite de 48h por mês (Pablo, 04/11/2026)
//
// "limite de 48h por mês no MÁXIMO, integrados com o PONTO DA SENIOR, lembrando
// que se tiver feriado tem que puxar igual também". Lógica pura, testada em
// src/test/hora-extra-limite.test.ts.
//
// DE ONDE VEM O TOTAL
//   · Ponto da Senior: a mesma conta da Gestão de Ponto (montarEspelho). Hora
//     extra do dia é o que passou do previsto; em feriado, folga e fim de
//     semana, nada é previsto e tudo o que foi trabalhado conta.
//   · HE do ERP ainda fora do ponto: a HE de sexta que foi aprovada hoje ainda
//     não tem batida. Se contasse só o ponto, dava para pedir 200h adiantadas.
//
// NÃO SOMA OS DOIS NO MESMO DIA: quem bateu o ponto e abriu a HE do mesmo dia
// fez uma hora extra só, registrada em dois lugares. Em cada dia vale o maior.
//
// O LIMITE NÃO É BLOQUEIO: passou de 48h, a tela pede três confirmações e
// depois salva normalmente. Exatamente 48h ainda não passou.
// =====================================================================

import { montarEspelho, minutosExtraDoDia, type ColaboradorPonto } from "@/lib/gestaoPonto";

export const LIMITE_HE_MES_MIN = 48 * 60;

/** Os textos são os do pedido, palavra por palavra. */
export const CONFIRMACOES_LIMITE_HE = [
  "VOCÊ JÁ CHEGOU NO LIMITE DE HORAS EXTRAS, TEM CERTEZA QUE DESEJA CONFIRMAR?",
  "CERTEZA MESMO?",
  "CERTEZA ABSOLUTA?",
] as const;

export type MotivoSemPonto = "sem_vinculo" | "sem_espelho" | null;

export interface SolicitacaoDoMes {
  id: string;
  data_he: string;
  minutos: number;
  feriado: boolean;
  status: string;
}

/** Resposta da RPC hora_extra_ponto_mes (mig 20261104010000). */
export interface PontoMesHoraExtra {
  mes: string;
  hoje: string;
  ponto_disponivel: boolean;
  motivo: MotivoSemPonto;
  colaborador: ColaboradorPonto | null;
  solicitacoes: SolicitacaoDoMes[];
}

export interface ResumoMesHoraExtra {
  /** O que o ponto da Senior registrou no mês. */
  minutosPonto: number;
  /** HE do ERP que ainda não apareceu no ponto (dia sem batida, ou HE maior que a batida). */
  minutosForaDoPonto: number;
  total: number;
  passouLimite: boolean;
  /** Quanto passou de 48h; zero quando não passou. */
  excedente: number;
  pontoDisponivel: boolean;
}

export interface OpcoesResumoMes {
  /** A HE sendo editada, aprovada ou concluída: o valor antigo sai da conta. */
  ignorarId?: string | null;
  /** A HE que está sendo confirmada, ainda fora da conta. */
  novaHe?: { data: string; minutos: number } | null;
}

export function resumirMesHoraExtra(resposta: PontoMesHoraExtra, opcoes: OpcoesResumoMes = {}): ResumoMesHoraExtra {
  const solicitacoes = (resposta.solicitacoes ?? []).filter(
    (s) => s.status !== "reprovada" && s.id !== opcoes.ignorarId,
  );

  const hePorDia = new Map<string, number>();
  const somarHe = (data: string, minutos: number) =>
    hePorDia.set(data, (hePorDia.get(data) ?? 0) + (Number(minutos) || 0));
  solicitacoes.forEach((s) => somarHe(s.data_he, s.minutos));
  if (opcoes.novaHe) somarHe(opcoes.novaHe.data, opcoes.novaHe.minutos);

  const pontoPorDia = new Map<string, number>();
  if (resposta.colaborador) {
    // Dia marcado como feriado na solicitação: é o único registro de feriado
    // municipal do ERP. Sem isto, só a parte acima da jornada contaria.
    const feriadosExtras = new Map(
      solicitacoes.filter((s) => s.feriado).map((s) => [s.data_he, "Feriado informado na HE"] as const),
    );
    const espelho = montarEspelho(resposta.colaborador, resposta.mes, resposta.hoje, feriadosExtras);
    espelho.dias.forEach((d) => pontoPorDia.set(d.data, minutosExtraDoDia(d)));
  }

  let minutosPonto = 0;
  let total = 0;
  new Set([...hePorDia.keys(), ...pontoPorDia.keys()]).forEach((dia) => {
    const ponto = pontoPorDia.get(dia) ?? 0;
    minutosPonto += ponto;
    total += Math.max(ponto, hePorDia.get(dia) ?? 0);
  });

  return {
    minutosPonto,
    minutosForaDoPonto: total - minutosPonto,
    total,
    passouLimite: total > LIMITE_HE_MES_MIN,
    excedente: Math.max(0, total - LIMITE_HE_MES_MIN),
    pontoDisponivel: !!resposta.colaborador,
  };
}

/**
 * As três perguntas em sequência. A primeira resposta negativa encerra: as
 * seguintes nem aparecem e nada é salvo.
 */
export async function confirmarLimiteHoraExtra(
  perguntar: (mensagem: string) => Promise<boolean>,
): Promise<boolean> {
  for (const mensagem of CONFIRMACOES_LIMITE_HE) {
    if (!(await perguntar(mensagem))) return false;
  }
  return true;
}

// ---- Mês -------------------------------------------------------------------

export const mesDaData = (data: string) => data.slice(0, 7);

export function mesDeHoje(hoje = new Date()): string {
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-01", -1 → "2025-12". */
export function deslocarMes(mes: string, delta: number): string {
  const [ano, m] = mes.split("-").map(Number);
  const d = new Date(ano, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Primeiro e último dia do mês, sem passar por UTC. */
export function periodoDoMes(mes: string): { inicio: string; fim: string } {
  const [ano, m] = mes.split("-").map(Number);
  const ultimo = new Date(ano, m, 0).getDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

/** "2026-11" → "novembro de 2026". */
export function rotuloMesHoraExtra(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(ano, m - 1, 1));
}
