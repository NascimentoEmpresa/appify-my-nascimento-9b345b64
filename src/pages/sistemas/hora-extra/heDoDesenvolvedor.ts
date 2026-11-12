// =====================================================================
// HORA EXTRA NO "MEU DASHBOARD" DO DESENVOLVEDOR (Chamados de Sistemas).
//
// As contas são as MESMAS da RPC `hora_extra_dashboard` (mig
// 20261008000009), para o número do dev bater com o Dashboard de Hora
// Extra. Aqui elas rodam no navegador sobre as linhas que a RLS de
// HORA_EXTRA_SOLICITACAO já libera (as próprias, ou todas para quem
// aprova HE), porque nem todo dev tem o menu do Dashboard de HE e a RPC
// devolveria zero para ele.
//
//   • mês = mês do `data_he` (o dia em que a HE foi feita);
//   • HE aprovadas  = total PREVISTO das aprovada / aguardando_validacao /
//                     concluida (reprovada e aguardando_liberacao não contam);
//   • HE realizadas = total REAL das aguardando_validacao / concluida;
//   • Pendentes de conclusão = aprovadas com data já passada e sem conclusão;
//   • Rosca de status = minutos de cada HE liberada (real se houver, senão
//     o previsto) em Aprovadas / Concluídas / Pendentes.
// =====================================================================

export interface LinhaHeDev {
  data_he: string;
  status: string;
  total_previsto_min: number | null;
  total_real_min: number | null;
}

const LIBERADAS = new Set(["aprovada", "aguardando_validacao", "concluida"]);
const COM_REAL = new Set(["aguardando_validacao", "concluida"]);

const n = (v: number | null | undefined) => Number(v) || 0;

/** `2026-11-05` → `2026-11`. */
export const mesDe = (data: string) => String(data ?? "").slice(0, 7);

/** `2026-11` → `2026-08` com `delta` = -3, sem `Date` (fuso não interfere). */
export function somarMeses(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number);
  const total = a * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export interface ResumoMesHe {
  aprovadas_min: number;
  realizadas_min: number;
  pendentes: number;
  solicitacoes: number;
}

/** Cards do mês escolhido. `hoje` em `AAAA-MM-DD` (fuso de São Paulo). */
export function resumoMesHe(linhas: LinhaHeDev[], mes: string, hoje: string): ResumoMesHe {
  return linhas
    .filter((l) => mesDe(l.data_he) === mes)
    .reduce<ResumoMesHe>((r, l) => {
      r.solicitacoes += 1;
      if (LIBERADAS.has(l.status)) r.aprovadas_min += n(l.total_previsto_min);
      if (COM_REAL.has(l.status)) r.realizadas_min += n(l.total_real_min);
      if (l.status === "aprovada" && l.data_he < hoje) r.pendentes += 1;
      return r;
    }, { aprovadas_min: 0, realizadas_min: 0, pendentes: 0, solicitacoes: 0 });
}

export interface MesSerieHe { mes: string; previsto_min: number; realizado_min: number }

/** Previsto x Realizado dos `qtd` meses que terminam em `mesFim`, com os vazios em zero. */
export function seriePrevistoRealizado(linhas: LinhaHeDev[], mesFim: string, qtd = 12): MesSerieHe[] {
  const serie = Array.from({ length: qtd }, (_, k) => ({
    mes: somarMeses(mesFim, k - (qtd - 1)), previsto_min: 0, realizado_min: 0,
  }));
  const porMes = new Map(serie.map((s) => [s.mes, s]));
  linhas.forEach((l) => {
    const alvo = porMes.get(mesDe(l.data_he));
    if (!alvo) return;
    if (LIBERADAS.has(l.status)) alvo.previsto_min += n(l.total_previsto_min);
    if (COM_REAL.has(l.status)) alvo.realizado_min += n(l.total_real_min);
  });
  return serie;
}

export interface FatiaStatusHe { chave: "aprovadas" | "concluidas" | "pendentes"; rotulo: string; minutos: number }

/** Rosca "Status das HEs" do mês — mesmas três fatias do Dashboard de HE. */
export function statusMesHe(linhas: LinhaHeDev[], mes: string, hoje: string): FatiaStatusHe[] {
  const f = { aprovadas: 0, concluidas: 0, pendentes: 0 };
  linhas.filter((l) => mesDe(l.data_he) === mes).forEach((l) => {
    const min = n(l.total_real_min ?? l.total_previsto_min);
    if (l.status === "concluida") f.concluidas += min;
    else if (l.status === "aguardando_validacao" || (l.status === "aprovada" && l.data_he >= hoje)) f.aprovadas += min;
    else if (l.status === "aprovada") f.pendentes += min;
  });
  return [
    { chave: "aprovadas", rotulo: "Aprovadas", minutos: f.aprovadas },
    { chave: "concluidas", rotulo: "Concluídas", minutos: f.concluidas },
    { chave: "pendentes", rotulo: "Pendentes", minutos: f.pendentes },
  ];
}

/** Hoje em São Paulo, `AAAA-MM-DD` — o `hoje_sp` da RPC. */
export function hojeSaoPaulo(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}
