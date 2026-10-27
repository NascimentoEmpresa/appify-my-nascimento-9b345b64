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

// SIS-2026-0724: totais de Saldo final (sistema), Saldo final (extrato) e Diferença, para a leitura de cima da conferência mensal.
// Saldo é acumulado (o de um mês já carrega os anteriores), então NÃO se soma mês a mês: vale, por empresa + banco, o ÚLTIMO mês conferido do
// período (o mais recente com saldo do sistema e do extrato), e só então se soma entre as empresas/bancos. Grupo sem nenhum mês conferido fica
// de fora dos três totais (para Sistema − Extrato = Diferença) e é contado em `semConferencia`.
export interface TotaisSaldos {
  sistema: number;
  extrato: number;
  diferenca: number;
  grupos: number; // empresa + banco com saldo conferido
  divergentes: number; // desses, os que não batem
  semConferencia: number; // empresa + banco do filtro sem nenhum mês conferido
}

export function totaisDeSaldos(saldos: SaldoMensal[]): TotaisSaldos {
  const ultimo = new Map<string, SaldoMensal | null>();
  for (const s of saldos) {
    const g = `${s.empresaId}|${s.bancoId}`;
    if (!ultimo.has(g)) ultimo.set(g, null);
    if (s.saldoSistema == null || s.saldoExtrato == null) continue;
    const atual = ultimo.get(g);
    if (!atual || s.mes > atual.mes) ultimo.set(g, s);
  }
  let sistema = 0, extrato = 0, grupos = 0, divergentes = 0, semConferencia = 0;
  for (const s of ultimo.values()) {
    if (!s) { semConferencia += 1; continue; }
    grupos += 1;
    sistema += s.saldoSistema as number;
    extrato += s.saldoExtrato as number;
    if (s.confere === "nao") divergentes += 1;
  }
  return { sistema: r2(sistema), extrato: r2(extrato), diferenca: r2(sistema - extrato), grupos, divergentes, semConferencia };
}

// SIS-2026-0736: soma de entradas e saídas do período de movimentação, para comparar com "Entradas/Saídas (filtro atual)" do Fluxo de Caixa —
// Realizado. Tem de dar o MESMO número, então segue a conta daquela tela: o Fluxo junta as fatias do rateio numa linha por lançamento
// (despesa_id + parcela, valor somado, e empresa/banco/data/tipo da primeira fatia), tira o que ainda não aconteceu (data depois de hoje) e só
// então filtra por período, empresa e banco. Nada é descartado além disso: saldo anterior e conta vinculada contam, porque o Fluxo os mostra.
export interface LinhaParaTotais {
  despesa_id: string;
  numero_parcela: number | null;
  empresa_id: string | null;
  banco_id: string | null;
  data_pagamento: string | null;
  tipo: "entrada" | "saida";
  valor: number | string;
  situacao_base?: "aberto" | "cancelado" | null;
}

export function totaisDeMovimentacao(
  linhas: LinhaParaTotais[],
  f: { dataDe: string; dataAte: string; empresaId: string | null; bancoId: string | null },
  hoje: string,
): { entradas: number; saidas: number; lancamentos: number } {
  const grupos = new Map<string, { base: LinhaParaTotais; valor: number }>();
  for (const l of linhas) {
    const chave = `${l.despesa_id}::${l.numero_parcela ?? ""}`;
    const g = grupos.get(chave);
    if (g) g.valor += Number(l.valor) || 0;
    else grupos.set(chave, { base: l, valor: Number(l.valor) || 0 });
  }
  let entradas = 0, saidas = 0, lancamentos = 0;
  for (const { base, valor } of grupos.values()) {
    const data = base.data_pagamento?.slice(0, 10) ?? null;
    if (base.situacao_base || (data && data > hoje)) continue; // ainda não aconteceu: é do Projetado
    if (f.dataDe && (!data || data < f.dataDe)) continue;
    if (f.dataAte && (!data || data > f.dataAte)) continue;
    if (f.empresaId && base.empresa_id !== f.empresaId) continue;
    if (f.bancoId && base.banco_id !== f.bancoId) continue;
    lancamentos += 1;
    if (base.tipo === "entrada") entradas += valor; else saidas += valor;
  }
  return { entradas: r2(entradas), saidas: r2(saidas), lancamentos };
}

// SIS-2026-0720: valores gravados em UMA conciliação (Fluxo, extrato e conciliado, entradas e saídas), sem o saldo de abertura. Conciliações
// antigas com o "saldo anterior do extrato" digitado gravaram esse saldo como uma linha nos totais do Fluxo (e no conciliado), mas o total do
// extrato vem só do OFX: aqui ele sai, como na Auditoria (saldo de abertura não é movimento). null = conciliação sem os valores gravados.
export interface ValoresConciliacao {
  fe: number; fs: number; ee: number; es: number; ce: number; cs: number;
  difEntradas: number; difSaidas: number;
}
export function valoresDaConciliacao(c: {
  fluxo_entradas?: number | null; fluxo_saidas?: number | null; extrato_entradas?: number | null; extrato_saidas?: number | null;
  conciliado_entradas?: number | null; conciliado_saidas?: number | null; saldo_anterior_fluxo?: number | null; saldo_anterior_extrato?: number | null;
}): ValoresConciliacao | null {
  if (c.fluxo_entradas == null || c.fluxo_saidas == null || c.extrato_entradas == null || c.extrato_saidas == null || c.conciliado_entradas == null || c.conciliado_saidas == null) return null;
  let fe = Number(c.fluxo_entradas), fs = Number(c.fluxo_saidas), ce = Number(c.conciliado_entradas), cs = Number(c.conciliado_saidas);
  if (c.saldo_anterior_extrato != null && c.saldo_anterior_fluxo != null) {
    const saldo = Number(c.saldo_anterior_fluxo);
    const bateu = Number(c.saldo_anterior_extrato) === saldo;
    if (saldo > 0) { fe -= saldo; if (bateu) ce -= saldo; }
    else if (saldo < 0) { fs += saldo; if (bateu) cs += saldo; }
  }
  const ee = Number(c.extrato_entradas), es = Number(c.extrato_saidas);
  return { fe: r2(fe), fs: r2(fs), ee: r2(ee), es: r2(es), ce: r2(ce), cs: r2(cs), difEntradas: r2(fe - ee), difSaidas: r2(fs - es) };
}
