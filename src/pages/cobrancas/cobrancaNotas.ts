import { diasEntre, faixaDeDias, hojeEmSaoPaulo, ORDEM_FAIXAS, PRAZO_PAGAMENTO_DIAS, type Faixa } from "../../../supabase/functions/_shared/cobranca-automatica";
import { situacaoEspecial } from "@/pages/financeiro/nf-emissao/shared";

// SIS-2026-0653: regras puras da tela Cobranças (notas em aberto), calculadas direto do Relatório de Serviços (nf_emissao).
// A faixa, os dias e o prazo de 30 dias são os MESMOS da cobrança automática (supabase/functions/_shared/cobranca-automatica.ts):
// a tela e o envio nunca discordam sobre em que faixa uma nota está.

export type StatusCobranca = "a_vencer" | "em_atraso" | "parcial" | "cancelada";

export const ROTULO_STATUS: Record<StatusCobranca, string> = {
  a_vencer: "A vencer",
  em_atraso: "Em atraso",
  parcial: "Parcialmente pago",
  cancelada: "Cancelada",
};

// Mesmo critério do Relatório de Serviços: só entra nota concluída pelo Financeiro, fora da lixeira e sem pagamento total.
export interface NfParaCobranca {
  id: string;
  contrato_id: string;
  empresa_id: string;
  numero_nf: string | null;
  data_emissao: string | null;
  competencia: string;
  status: string;
  deleted_at?: string | null;
  data_pagamento: string | null;
  valor_pago: number | null;
  vlr_liquido_total: number;
  situacao_site_pmt?: string | null;
  situacao_dominio?: string | null;
  contrato?: { nome: string } | null;
}

export interface LinhaCobranca {
  id: string;
  contratoId: string;
  contrato: string;
  empresaId: string;
  empresaCodigo: string;
  numero: string;
  dataEmissao: string;
  competencia: string;
  valor: number; // em aberto: líquido − já pago
  dias: number; // corridos desde a emissão
  atraso: number; // dias − 30 (≤ 0 = ainda no prazo)
  faixa: Faixa | null; // null = no prazo, ainda sem aviso
  status: StatusCobranca;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// A nota só ganha "faixa" (aviso amigável) a partir de 5 dias antes do vencimento, igual à automação (aviso_dias_antes = 5).
export const AVISO_DIAS_ANTES = 5;

export function linhasDeCobranca(nfs: NfParaCobranca[], empresaCodigo: Map<string, string>, agora: Date = new Date()): LinhaCobranca[] {
  const hoje = hojeEmSaoPaulo(agora);
  const linhas: LinhaCobranca[] = [];
  for (const n of nfs) {
    if (n.deleted_at || n.status !== "concluida" || n.data_pagamento || !n.data_emissao) continue;
    const pago = Number(n.valor_pago) || 0;
    const valor = r2((Number(n.vlr_liquido_total) || 0) - pago);
    const cancelada = !!situacaoEspecial(n);
    if (!cancelada && valor <= 0.005) continue;
    const dias = diasEntre(n.data_emissao, hoje);
    const atraso = dias - PRAZO_PAGAMENTO_DIAS;
    const status: StatusCobranca = cancelada ? "cancelada" : pago > 0.005 ? "parcial" : atraso > 0 ? "em_atraso" : "a_vencer";
    linhas.push({
      id: n.id,
      contratoId: n.contrato_id,
      contrato: n.contrato?.nome ?? "(contrato não encontrado)",
      empresaId: n.empresa_id,
      empresaCodigo: empresaCodigo.get(n.empresa_id) ?? "",
      numero: n.numero_nf ?? "s/n",
      dataEmissao: n.data_emissao,
      competencia: n.competencia,
      valor: cancelada ? r2(Number(n.vlr_liquido_total) || 0) : valor,
      dias,
      atraso,
      faixa: dias >= PRAZO_PAGAMENTO_DIAS - AVISO_DIAS_ANTES ? faixaDeDias(dias) : null,
      status,
    });
  }
  return linhas;
}

// ── Filtros ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FiltrosCobranca {
  busca: string;
  de: string; // emissão, YYYY-MM-DD
  ate: string;
  empresaId: string;
  contratoId: string;
  status: StatusCobranca | "";
}

export const FILTROS_VAZIOS: FiltrosCobranca = { busca: "", de: "", ate: "", empresaId: "", contratoId: "", status: "" };

// Quem tem só parte do acesso à tela vê só as notas já atrasadas há mais de N dias (Jurídico: 30, Comercial: 60).
export type RestricaoDias = 0 | 30 | 60;

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function rotuloFaixa(f: Faixa | null): string {
  return f ? ROTULO_FAIXA_CURTO[f] : "No prazo";
}
export const ROTULO_FAIXA_CURTO: Record<Faixa, string> = {
  aviso: "Aviso pré-vencimento",
  verde: "Faixa verde",
  amarela: "Faixa amarela",
  laranja: "Faixa laranja",
  vermelha: "Faixa vermelha",
  roxa: "Faixa roxa",
  preta: "Faixa preta",
};

export function filtrarLinhas(linhas: LinhaCobranca[], f: FiltrosCobranca, restricao: RestricaoDias = 0): LinhaCobranca[] {
  const termo = semAcento(f.busca).trim();
  return linhas.filter((l) => {
    if (restricao > 0 && l.atraso <= restricao) return false;
    // "Todos" não inclui canceladas: são registros antigos que só atrapalhariam a cobrança; ficam no filtro próprio.
    if (f.status ? l.status !== f.status : l.status === "cancelada") return false;
    if (f.empresaId && l.empresaId !== f.empresaId) return false;
    if (f.contratoId && l.contratoId !== f.contratoId) return false;
    if (f.de && l.dataEmissao < f.de) return false;
    if (f.ate && l.dataEmissao > f.ate) return false;
    if (termo) {
      const alvo = semAcento(`${l.contrato} ${l.numero} ${rotuloFaixa(l.faixa)} ${l.empresaCodigo}`);
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });
}

// ── Totais, gráficos e agrupamento ────────────────────────────────────────────────────────────────────────────────

export interface Totais {
  totalGeral: number;
  qtdNotas: number;
  atraso: number; // dias > 30
  qtdAtraso: number;
  aVencer: number; // dias ≤ 30
  qtdAVencer: number;
  pctAtraso: number | null;
}

// Totais de dinheiro: tudo o que está em aberto (a vencer, em atraso e parcial); cancelada fica de fora.
export function totaisDe(linhas: LinhaCobranca[]): Totais {
  const abertas = linhas.filter((l) => l.status !== "cancelada");
  const soma = (ls: LinhaCobranca[]) => r2(ls.reduce((s, l) => s + l.valor, 0));
  const vencidas = abertas.filter((l) => l.atraso > 0);
  const aVencer = abertas.filter((l) => l.atraso <= 0);
  const totalGeral = soma(abertas);
  return {
    totalGeral,
    qtdNotas: abertas.length,
    atraso: soma(vencidas),
    qtdAtraso: vencidas.length,
    aVencer: soma(aVencer),
    qtdAVencer: aVencer.length,
    pctAtraso: totalGeral > 0 ? soma(vencidas) / totalGeral : null,
  };
}

// Gráfico "Valores por Status": cada nota cai em UM status (parcialmente pago separado), então as barras somam o total geral.
export function valoresPorStatus(linhas: LinhaCobranca[]): { status: StatusCobranca; rotulo: string; valor: number }[] {
  const ordem: StatusCobranca[] = ["em_atraso", "a_vencer", "parcial", "cancelada"];
  return ordem.map((s) => ({ status: s, rotulo: ROTULO_STATUS[s], valor: r2(linhas.filter((l) => l.status === s).reduce((t, l) => t + l.valor, 0)) }));
}

// Gráfico "Notas por faixa de dias em atraso": as faixas oficiais (as mesmas do e-mail), só notas já vencidas.
export function notasPorFaixa(linhas: LinhaCobranca[]): { faixa: Faixa; qtd: number; valor: number; pct: number | null }[] {
  const vencidas = linhas.filter((l) => l.status !== "cancelada" && l.atraso > 0 && l.faixa);
  const total = vencidas.reduce((s, l) => s + l.valor, 0);
  return ORDEM_FAIXAS.filter((f) => f !== "aviso")
    .map((f) => {
      const doGrupo = vencidas.filter((l) => l.faixa === f);
      const valor = r2(doGrupo.reduce((s, l) => s + l.valor, 0));
      return { faixa: f, qtd: doGrupo.length, valor, pct: total > 0 ? valor / total : null };
    })
    .filter((x) => x.qtd > 0);
}

export function topContratos(linhas: LinhaCobranca[], n = 5): { contratoId: string; contrato: string; valor: number }[] {
  const por = new Map<string, { contrato: string; valor: number }>();
  for (const l of linhas) {
    if (l.status === "cancelada") continue;
    const atual = por.get(l.contratoId) ?? { contrato: l.contrato, valor: 0 };
    atual.valor += l.valor;
    por.set(l.contratoId, atual);
  }
  return [...por.entries()].map(([contratoId, v]) => ({ contratoId, contrato: v.contrato, valor: r2(v.valor) })).sort((a, b) => b.valor - a.valor).slice(0, n);
}

export interface GrupoContrato {
  contratoId: string;
  contrato: string;
  empresaCodigo: string;
  linhas: LinhaCobranca[];
  total: number;
  diasMax: number;
  faixa: Faixa | null; // a mais grave entre as notas
}

export function agruparPorContrato(linhas: LinhaCobranca[]): GrupoContrato[] {
  const por = new Map<string, LinhaCobranca[]>();
  for (const l of linhas) {
    const arr = por.get(l.contratoId) ?? [];
    arr.push(l);
    por.set(l.contratoId, arr);
  }
  return [...por.entries()]
    .map(([contratoId, ls]) => {
      const ordenadas = [...ls].sort((a, b) => a.dataEmissao.localeCompare(b.dataEmissao) || a.numero.localeCompare(b.numero));
      const faixas = ordenadas.map((l) => l.faixa).filter((f): f is Faixa => f !== null);
      return {
        contratoId,
        contrato: ordenadas[0].contrato,
        empresaCodigo: ordenadas[0].empresaCodigo,
        linhas: ordenadas,
        total: r2(ordenadas.reduce((s, l) => s + (l.status === "cancelada" ? 0 : l.valor), 0)),
        diasMax: Math.max(...ordenadas.map((l) => l.dias)),
        faixa: faixas.sort((a, b) => ORDEM_FAIXAS.indexOf(b) - ORDEM_FAIXAS.indexOf(a))[0] ?? null,
      };
    })
    .sort((a, b) => b.total - a.total || a.contrato.localeCompare(b.contrato, "pt-BR"));
}

// ── Recebido do mês ───────────────────────────────────────────────────────────────────────────────────────────────

export interface NfParaRecebido {
  contrato_id: string;
  empresa_id: string;
  status: string;
  deleted_at?: string | null;
  data_pagamento: string | null;
  valor_pago: number | null;
}

/** Soma do valor pago das notas com pagamento no mês ("YYYY-MM") e a variação sobre o mês anterior. */
export function recebidoDoMes(nfs: NfParaRecebido[], anoMes: string, filtro: { empresaId?: string; contratoId?: string } = {}): { valor: number; anterior: number; variacao: number | null } {
  const [a, m] = anoMes.split("-").map(Number);
  const anterior = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
  let valor = 0, ant = 0;
  for (const n of nfs) {
    if (n.deleted_at || n.status !== "concluida" || !n.data_pagamento) continue;
    if (filtro.empresaId && n.empresa_id !== filtro.empresaId) continue;
    if (filtro.contratoId && n.contrato_id !== filtro.contratoId) continue;
    const mes = n.data_pagamento.slice(0, 7);
    if (mes === anoMes) valor += Number(n.valor_pago) || 0;
    else if (mes === anterior) ant += Number(n.valor_pago) || 0;
  }
  return { valor: r2(valor), anterior: r2(ant), variacao: ant > 0 ? (valor - ant) / ant : null };
}

// ── Próxima ação ──────────────────────────────────────────────────────────────────────────────────────────────────

export type DecisaoAuto = "enviar" | "aguardar" | "judicial" | "manual" | "sem_destinatario";
export type ModoAuto = "desligado" | "simulacao" | "piloto" | "producao";
export interface PlanoDoContrato { decisao: DecisaoAuto; proximo_envio: string | null }

export type TomAcao = "neutro" | "auto" | "juridico" | "alerta";
const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** O que acontece com a nota a seguir, juntando o estado da nota com o plano da cobrança automática do contrato. */
export function proximaAcao(l: Pick<LinhaCobranca, "status" | "faixa">, plano: PlanoDoContrato | undefined, modo: ModoAuto | undefined): { texto: string; tom: TomAcao } {
  if (l.status === "cancelada") return { texto: "—", tom: "neutro" };
  if (l.faixa === null) return { texto: "Aguardar vencimento", tom: "neutro" };
  if (l.faixa === "roxa" || l.faixa === "preta" || plano?.decisao === "judicial") return { texto: "Manual — Jurídico", tom: "juridico" };
  if (!plano) return { texto: "Cobrar cliente", tom: "alerta" };
  switch (plano.decisao) {
    case "manual": return { texto: "Só manual", tom: "alerta" };
    case "sem_destinatario": return { texto: "Cadastrar e-mail do tomador", tom: "alerta" };
    case "enviar": return modo === "producao" ? { texto: "Envio automático na próxima rodada", tom: "auto" } : { texto: "Enviar e-mail", tom: "alerta" };
    default: return plano.proximo_envio ? { texto: `Automático em ${dataBr(plano.proximo_envio)}`, tom: "auto" } : { texto: "Cobrança já enviada nesta faixa", tom: "neutro" };
  }
}

// ── Ordenação ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type ColunaOrdem = "emissao" | "numero" | "contrato" | "empresa" | "valor" | "dias" | "faixa" | "status";

const PESO_STATUS: Record<StatusCobranca, number> = { em_atraso: 0, parcial: 1, a_vencer: 2, cancelada: 3 };

export function ordenarLinhas(linhas: LinhaCobranca[], coluna: ColunaOrdem, desc: boolean): LinhaCobranca[] {
  const chave = (l: LinhaCobranca): number | string => {
    switch (coluna) {
      case "emissao": return l.dataEmissao;
      case "numero": return Number(l.numero) || 0;
      case "contrato": return l.contrato.toLowerCase();
      case "empresa": return l.empresaCodigo;
      case "valor": return l.valor;
      case "dias": return l.dias;
      case "faixa": return l.faixa ? ORDEM_FAIXAS.indexOf(l.faixa) : -1;
      case "status": return PESO_STATUS[l.status];
    }
  };
  return [...linhas].sort((a, b) => {
    const x = chave(a), y = chave(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR");
    return (desc ? -c : c) || a.contrato.localeCompare(b.contrato, "pt-BR") || a.numero.localeCompare(b.numero);
  });
}
