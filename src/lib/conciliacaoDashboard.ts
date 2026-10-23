import { ehSaldoAnterior } from "@/lib/conciliacaoSaldoAnterior";
import { ignoraNaConciliacao } from "@/hooks/useConciliacaoFluxoCaixa";

// SIS-2026-0713: dashboard de conciliações e conferência mensal dos saldos.
//
// Regras do chamado (conferência empresa por empresa e banco por banco, nunca somando nem compensando entre grupos):
//  - saldo do sistema = saldo inicial manual (fechamento de dezembro do 1º ano do histórico) + entradas − saídas, mês a mês; o fechamento de um
//    mês é a base do seguinte. O saldo inicial entra UMA vez, não é entrada/saída e não é lançamento a conciliar: por isso as linhas
//    "SALDO ANTERIOR" do Fluxo (importação histórica) ficam fora destas contas;
//  - saldo do extrato = saldo final (LEDGERBAL) gravado na conciliação do mês;
//  - diferença = sistema − extrato; dado ausente é "não informado" (null), nunca zero;
//  - "Saldos conferem?" é independente da situação da conciliação.

const r2 = (n: number) => Math.round(n * 100) / 100;

export type ConfereSaldo = "sim" | "nao" | "pendente";

export interface LinhaFluxoSaldo {
  empresa_id: string | null;
  banco_id: string | null;
  banco_nome?: string | null;
  data_pagamento: string | null;
  tipo: "entrada" | "saida";
  valor: number | string;
  descricao: string | null;
  classificacao_nome: string | null;
}

export interface SaldoInicialConta {
  empresa_id: string;
  banco_id: string;
  conta: string;
  ano: number;
  valor: number;
}

export interface ConciliacaoParaSaldo {
  id: string;
  data_inicio: string;
  data_fim: string;
  banco_id: string | null;
  todas_empresas: boolean;
  empresa_ids: string[];
  conta_extrato: string | null;
  saldo_final_extrato?: number | null;
  created_at: string;
}

export interface SaldoMensal {
  chave: string; // empresa|banco|mês
  empresaId: string;
  bancoId: string;
  conta: string;
  mes: string; // YYYY-MM
  entradas: number;
  saidas: number;
  saldoSistema: number | null;
  saldoExtrato: number | null;
  diferenca: number | null;
  confere: ConfereSaldo;
  conciliacaoId: string | null;
}

export function ultimoDiaDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
}

function proximoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
}

export const chaveRegistro = (c: Pick<ConciliacaoParaSaldo, "banco_id" | "todas_empresas" | "empresa_ids" | "conta_extrato" | "data_inicio" | "data_fim">) =>
  [c.banco_id ?? "", c.todas_empresas ? "todas" : [...c.empresa_ids].sort().join(","), c.conta_extrato ?? "", c.data_inicio, c.data_fim].join("|");

// Salvar de novo o mesmo registro (mesma empresa, banco, conta e período) não duplica indicadores: vale o salvamento mais recente.
export function registrosAtuais<T extends ConciliacaoParaSaldo>(salvas: T[]): T[] {
  const porChave = new Map<string, T>();
  for (const c of salvas) {
    const atual = porChave.get(chaveRegistro(c));
    if (!atual || c.created_at > atual.created_at) porChave.set(chaveRegistro(c), c);
  }
  return [...porChave.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function statusConfere(saldoSistema: number | null, saldoExtrato: number | null): { confere: ConfereSaldo; diferenca: number | null } {
  if (saldoSistema == null || saldoExtrato == null) return { confere: "pendente", diferenca: null };
  const diferenca = r2(saldoSistema - saldoExtrato);
  return { confere: diferenca === 0 ? "sim" : "nao", diferenca };
}

// A conciliação é de UMA empresa para o saldo ser atribuído a ela ("todas" ou várias misturariam contas).
function conciliacaoDoMes(concs: ConciliacaoParaSaldo[], empresaId: string, bancoId: string, mes: string): ConciliacaoParaSaldo | null {
  const fim = ultimoDiaDoMes(mes);
  let melhor: ConciliacaoParaSaldo | null = null;
  for (const c of concs) {
    if (c.banco_id !== bancoId || c.data_fim !== fim) continue;
    if (c.todas_empresas || c.empresa_ids.length !== 1 || c.empresa_ids[0] !== empresaId) continue;
    if (!melhor || c.created_at > melhor.created_at) melhor = c;
  }
  return melhor;
}

export function saldosMensais(
  linhas: LinhaFluxoSaldo[],
  iniciais: SaldoInicialConta[],
  conciliacoes: ConciliacaoParaSaldo[],
  /** último mês (YYYY-MM) a mostrar; padrão = o mês mais recente com lançamento ou conciliação do grupo */
  ateMes?: string,
): SaldoMensal[] {
  const atuais = registrosAtuais(conciliacoes);
  // movimento do mês por grupo (empresa|banco)
  const mov = new Map<string, Map<string, { e: number; s: number }>>();
  for (const l of linhas) {
    if (!l.empresa_id || !l.banco_id || !l.data_pagamento) continue;
    if (ehSaldoAnterior(l) || ignoraNaConciliacao({ ...l, banco_nome: l.banco_nome ?? null })) continue;
    const g = `${l.empresa_id}|${l.banco_id}`;
    const meses = mov.get(g) ?? new Map();
    mov.set(g, meses);
    const mes = l.data_pagamento.slice(0, 7);
    const m = meses.get(mes) ?? { e: 0, s: 0 };
    meses.set(mes, m);
    if (l.tipo === "entrada") m.e += Number(l.valor) || 0;
    else m.s += Number(l.valor) || 0;
  }

  const grupos = new Set<string>(mov.keys());
  for (const i of iniciais) grupos.add(`${i.empresa_id}|${i.banco_id}`);
  for (const c of atuais) if (c.banco_id && !c.todas_empresas && c.empresa_ids.length === 1) grupos.add(`${c.empresa_ids[0]}|${c.banco_id}`);

  const saida: SaldoMensal[] = [];
  for (const g of grupos) {
    const [empresaId, bancoId] = g.split("|");
    const meses = mov.get(g) ?? new Map<string, { e: number; s: number }>();
    const iniGrupo = iniciais.filter((i) => i.empresa_id === empresaId && i.banco_id === bancoId);
    const anoBase = iniGrupo.length ? Math.min(...iniGrupo.map((i) => i.ano)) : null;
    const base = anoBase == null ? null : r2(iniGrupo.filter((i) => i.ano === anoBase).reduce((t, i) => t + Number(i.valor), 0));
    const contas = [
      ...new Set([
        ...iniGrupo.map((i) => i.conta),
        ...atuais.filter((c) => c.banco_id === bancoId && !c.todas_empresas && c.empresa_ids.length === 1 && c.empresa_ids[0] === empresaId).map((c) => c.conta_extrato ?? ""),
      ].filter(Boolean)),
    ].join(" · ");

    const conhecidos = [
      ...meses.keys(),
      ...atuais.filter((c) => c.banco_id === bancoId && !c.todas_empresas && c.empresa_ids[0] === empresaId).map((c) => c.data_fim.slice(0, 7)),
    ].sort();
    if (conhecidos.length === 0 && anoBase == null) continue;
    const inicio = anoBase != null ? `${anoBase}-01` : conhecidos[0];
    const fim = ateMes && ateMes > (conhecidos[conhecidos.length - 1] ?? inicio) ? ateMes : conhecidos[conhecidos.length - 1] ?? inicio;

    let acumulado = base;
    for (let mes = inicio; mes <= fim; mes = proximoMes(mes)) {
      const m = meses.get(mes) ?? { e: 0, s: 0 };
      const entradas = r2(m.e);
      const saidas = r2(m.s);
      if (acumulado != null) acumulado = r2(acumulado + entradas - saidas);
      const conc = conciliacaoDoMes(atuais, empresaId, bancoId, mes);
      const saldoExtrato = conc?.saldo_final_extrato ?? null;
      // sem conciliação processada naquele mês, a conferência fica pendente mesmo que exista saldo do sistema
      const { confere, diferenca } = conc ? statusConfere(acumulado, saldoExtrato) : { confere: "pendente" as const, diferenca: null };
      saida.push({
        chave: `${g}|${mes}`, empresaId, bancoId, conta: contas, mes, entradas, saidas,
        saldoSistema: acumulado, saldoExtrato, diferenca, confere, conciliacaoId: conc?.id ?? null,
      });
    }
  }
  return saida.sort((a, b) => (a.empresaId + a.bancoId === b.empresaId + b.bancoId ? (a.mes < b.mes ? -1 : 1) : a.empresaId + a.bancoId < b.empresaId + b.bancoId ? -1 : 1));
}
