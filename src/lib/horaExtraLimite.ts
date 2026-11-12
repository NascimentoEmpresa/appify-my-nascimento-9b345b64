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
// fez uma hora extra só, registrada em dois lugares.
//
// DIA FECHADO NO PONTO, VALE O PONTO (12/11/2026, Pablo: "não tá fazendo
// sentido o calculo das horas extras aqui. E no meu ponto da senior são 24h e
// 26min" — a tela dava 29h23). Antes valia o MAIOR entre ponto e HE em cada
// dia, e o dia de hoje contava pelo ponto. Deu errado de dois jeitos:
//   · HOJE: o dia ainda está aberto. A BI da Senior trouxe uma batida 21:18
//     com data de 12/11 (a saída repetida de 11/11), e 07:37→21:18 virou
//     4h53 de "hora extra" que não existe — a própria Senior mostrava só 07:37;
//   · ARREDONDAMENTO: HE pedida de 4h00 num dia que o ponto fechou com 3h56
//     somava os 4 minutos que ninguém fez.
// Agora: dia FECHADO (antes de hoje, batidas em pares) conta só pelo ponto —
// é o registro do que foi feito, igual ao da Senior. A HE pedida só entra nos
// dias que o ponto ainda não tem: hoje, futuro, sem batida ou batida ímpar.
// Continua não dando para pedir 200h adiantadas.
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
  /** HE do ERP de dia que o ponto ainda não fechou (hoje, futuro, sem batida, batida ímpar). */
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

  // Só dias FECHADOS: antes de hoje e com as batidas em pares.
  const pontoPorDia = new Map<string, number>();
  if (resposta.colaborador) {
    // Dia marcado como feriado na solicitação: é o único registro de feriado
    // municipal do ERP. Sem isto, só a parte acima da jornada contaria.
    const feriadosExtras = new Map(
      solicitacoes.filter((s) => s.feriado).map((s) => [s.data_he, "Feriado informado na HE"] as const),
    );
    const espelho = montarEspelho(resposta.colaborador, resposta.mes, resposta.hoje, feriadosExtras);
    espelho.dias
      .filter((d) => d.data < resposta.hoje && d.batidas.length > 0 && d.batidas.length % 2 === 0)
      .forEach((d) => pontoPorDia.set(d.data, minutosExtraDoDia(d)));
  }

  let minutosPonto = 0;
  let minutosForaDoPonto = 0;
  pontoPorDia.forEach((ponto) => { minutosPonto += ponto; });
  hePorDia.forEach((he, dia) => { if (!pontoPorDia.has(dia)) minutosForaDoPonto += he; });
  const total = minutosPonto + minutosForaDoPonto;

  return {
    minutosPonto,
    minutosForaDoPonto,
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
