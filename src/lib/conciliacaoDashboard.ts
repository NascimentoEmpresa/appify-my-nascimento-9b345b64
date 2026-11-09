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
  /** SIS-2026-0777: conta do banco atribuída ao lançamento (ex.: Sicredi HAGG 119). Ausente = sem conta definida. */
  conta_banco_id?: string | null;
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
  /** SIS-2026-0777: conciliação feita por conta do banco; ausente/nulo = por banco + empresa, como antes. */
  conta_banco_id?: string | null;
  saldo_final_extrato?: number | null;
  saldo_final_extrato_data?: string | null;
  created_at: string;
}

export interface SaldoMensal {
  chave: string; // empresa|banco[|conta]|mês
  empresaId: string;
  bancoId: string;
  /** SIS-2026-0777: conta do banco do grupo; vazio = lançamentos/conciliações sem conta definida (o comportamento de antes). */
  contaBancoId?: string;
  conta: string;
  mes: string; // YYYY-MM
  entradas: number;
  saidas: number;
  saldoSistema: number | null;
  saldoExtrato: number | null;
  // Data a que o saldo do extrato se refere, só quando é POSTERIOR ao fim do período (extrato baixado depois e sem os movimentos até lá):
  // aí o saldo não é o do último dia do mês e a comparação com o sistema não vale. null = é do fim do período (ou não se sabe).
  saldoExtratoDeOutraData: string | null;
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

export const chaveRegistro = (c: Pick<ConciliacaoParaSaldo, "banco_id" | "todas_empresas" | "empresa_ids" | "conta_extrato" | "data_inicio" | "data_fim"> & { conta_banco_id?: string | null }) =>
  [c.banco_id ?? "", c.todas_empresas ? "todas" : [...c.empresa_ids].sort().join(","), c.conta_extrato ?? "", c.conta_banco_id ?? "", c.data_inicio, c.data_fim].join("|");

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
function conciliacaoDoMes(concs: ConciliacaoParaSaldo[], empresaId: string, bancoId: string, mes: string, contaId = ""): ConciliacaoParaSaldo | null {
  const fim = ultimoDiaDoMes(mes);
  let melhor: ConciliacaoParaSaldo | null = null;
  for (const c of concs) {
    if (c.banco_id !== bancoId || c.data_fim !== fim) continue;
    if ((c.conta_banco_id ?? "") !== contaId) continue;
    if (c.todas_empresas || c.empresa_ids.length !== 1 || c.empresa_ids[0] !== empresaId) continue;
    if (!melhor || c.created_at > melhor.created_at) melhor = c;
  }
  return melhor;
}

// SIS-2026-0777: o saldo inicial guarda no campo `conta` (texto) o id da conta do banco; valor antigo/livre conta como "sem conta".
const contaDoSaldoInicial = (conta: string) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conta) ? conta : "");
const chaveGrupo = (empresaId: string, bancoId: string, contaId: string) => (contaId ? `${empresaId}|${bancoId}|${contaId}` : `${empresaId}|${bancoId}`);

export function saldosMensais(
  linhas: LinhaFluxoSaldo[],
  iniciais: SaldoInicialConta[],
  conciliacoes: ConciliacaoParaSaldo[],
  /** último mês (YYYY-MM) a mostrar; padrão = o mês mais recente com lançamento ou conciliação do grupo */
  ateMes?: string,
  /** SIS-2026-0777: id da conta do banco → rótulo para mostrar ("119 — HAGG 119") */
  rotulosDeConta: Map<string, string> = new Map(),
): SaldoMensal[] {
  const atuais = registrosAtuais(conciliacoes);
  // movimento do mês por grupo (empresa|banco[|conta]): cada conta do banco é conferida à parte
  const mov = new Map<string, Map<string, { e: number; s: number }>>();
  for (const l of linhas) {
    if (!l.empresa_id || !l.banco_id || !l.data_pagamento) continue;
    if (ehSaldoAnterior(l) || ignoraNaConciliacao({ ...l, banco_nome: l.banco_nome ?? null })) continue;
    const g = chaveGrupo(l.empresa_id, l.banco_id, l.conta_banco_id ?? "");
    const meses = mov.get(g) ?? new Map();
    mov.set(g, meses);
    const mes = l.data_pagamento.slice(0, 7);
    const m = meses.get(mes) ?? { e: 0, s: 0 };
    meses.set(mes, m);
    if (l.tipo === "entrada") m.e += Number(l.valor) || 0;
    else m.s += Number(l.valor) || 0;
  }

  const grupos = new Set<string>(mov.keys());
  for (const i of iniciais) grupos.add(chaveGrupo(i.empresa_id, i.banco_id, contaDoSaldoInicial(i.conta)));
  for (const c of atuais) if (c.banco_id && !c.todas_empresas && c.empresa_ids.length === 1) grupos.add(chaveGrupo(c.empresa_ids[0], c.banco_id, c.conta_banco_id ?? ""));

  const saida: SaldoMensal[] = [];
  for (const g of grupos) {
    const [empresaId, bancoId, contaBancoId = ""] = g.split("|");
    const meses = mov.get(g) ?? new Map<string, { e: number; s: number }>();
    const iniGrupo = iniciais.filter((i) => i.empresa_id === empresaId && i.banco_id === bancoId && contaDoSaldoInicial(i.conta) === contaBancoId);
    const anoBase = iniGrupo.length ? Math.min(...iniGrupo.map((i) => i.ano)) : null;
    const base = anoBase == null ? null : r2(iniGrupo.filter((i) => i.ano === anoBase).reduce((t, i) => t + Number(i.valor), 0));
    const contas = contaBancoId
      ? rotulosDeConta.get(contaBancoId) ?? "conta do banco"
      : [
          ...new Set([
            ...iniGrupo.map((i) => i.conta),
            ...atuais.filter((c) => c.banco_id === bancoId && !c.todas_empresas && c.empresa_ids.length === 1 && c.empresa_ids[0] === empresaId && !c.conta_banco_id).map((c) => c.conta_extrato ?? ""),
          ].filter(Boolean)),
        ].join(" · ");

    const conhecidos = [
      ...meses.keys(),
      ...atuais.filter((c) => c.banco_id === bancoId && !c.todas_empresas && c.empresa_ids[0] === empresaId && (c.conta_banco_id ?? "") === contaBancoId).map((c) => c.data_fim.slice(0, 7)),
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
      const conc = conciliacaoDoMes(atuais, empresaId, bancoId, mes, contaBancoId);
      const saldoExtrato = conc?.saldo_final_extrato ?? null;
      // sem conciliação processada naquele mês, a conferência fica pendente mesmo que exista saldo do sistema
      // Saldo de data posterior ao fim do período não é o do último dia: não compara (fica pendente) até alguém informar o saldo certo.
      const deOutraData = conc?.saldo_final_extrato_data && saldoExtrato != null && conc.saldo_final_extrato_data > conc.data_fim ? conc.saldo_final_extrato_data : null;
      const { confere, diferenca } = conc ? statusConfere(acumulado, deOutraData ? null : saldoExtrato) : { confere: "pendente" as const, diferenca: null };
      saida.push({
        chave: `${g}|${mes}`, empresaId, bancoId, contaBancoId, conta: contas, mes, entradas, saidas,
        saldoSistema: acumulado, saldoExtrato,
        saldoExtratoDeOutraData: deOutraData,
        diferenca, confere, conciliacaoId: conc?.id ?? null,
      });
    }
  }
  const grupoDe = (s: SaldoMensal) => s.empresaId + s.bancoId + (s.contaBancoId ?? "");
  return saida.sort((a, b) => (grupoDe(a) === grupoDe(b) ? (a.mes < b.mes ? -1 : 1) : grupoDe(a) < grupoDe(b) ? -1 : 1));
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
    const g = `${s.empresaId}|${s.bancoId}|${s.contaBancoId ?? ""}`;
    if (!ultimo.has(g)) ultimo.set(g, null);
    if (s.saldoSistema == null || s.saldoExtrato == null || s.saldoExtratoDeOutraData) continue;
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
  /** SIS-2026-0777 */
  conta_banco_id?: string | null;
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

// SIS-2026-0736 (continuação): o que o EXTRATO diz de entradas e saídas no período filtrado, lido das conciliações salvas (totais do OFX, sem o saldo
// de abertura, como na Auditoria). Só entra conciliação que existe: banco sem conciliação salva não tem extrato aqui.
type CamposExtrato = Parameters<typeof valoresDaConciliacao>[0];
export interface TotaisExtrato { entradas: number; saidas: number; conciliacoes: number; semValores: number }

function conciliacaoNoFiltro(c: ConciliacaoParaSaldo, f: { empresaId: string | null; bancoId: string | null; mesDe: string; mesAte: string }): boolean {
  const mes = c.data_fim.slice(0, 7);
  return (!f.empresaId || c.todas_empresas || c.empresa_ids.includes(f.empresaId)) && (!f.bancoId || c.banco_id === f.bancoId) && (!f.mesDe || mes >= f.mesDe) && (!f.mesAte || mes <= f.mesAte);
}

export function totaisDoExtrato<T extends ConciliacaoParaSaldo & CamposExtrato>(
  atuais: T[],
  f: { empresaId: string | null; bancoId: string | null; mesDe: string; mesAte: string },
): TotaisExtrato {
  let entradas = 0, saidas = 0, conciliacoes = 0, semValores = 0;
  for (const c of atuais) {
    if (!conciliacaoNoFiltro(c, f)) continue;
    const v = valoresDaConciliacao(c);
    if (v) { entradas += v.ee; saidas += v.es; conciliacoes += 1; continue; }
    if (c.extrato_entradas != null && c.extrato_saidas != null) { entradas += Number(c.extrato_entradas); saidas += Number(c.extrato_saidas); conciliacoes += 1; continue; }
    semValores += 1;
  }
  return { entradas: r2(entradas), saidas: r2(saidas), conciliacoes, semValores };
}

// O Fluxo só dos bancos que têm conciliação salva no mesmo mês e empresa (e sem o que a conciliação ignora e sem saldo anterior): é com ele que o extrato
// se compara. Linhas cruas, uma por cota, como na Auditoria.
export function totaisFluxoDosBancosConciliados(
  linhas: (LinhaParaTotais & { classificacao_nome?: string | null; descricao?: string | null; banco_nome?: string | null })[],
  atuais: ConciliacaoParaSaldo[],
  f: { dataDe: string; dataAte: string; empresaId: string | null; bancoId: string | null; mesDe: string; mesAte: string },
  hoje: string,
): { entradas: number; saidas: number } {
  const doFiltro = atuais.filter((c) => conciliacaoNoFiltro(c, f));
  let entradas = 0, saidas = 0;
  for (const l of linhas) {
    const data = l.data_pagamento?.slice(0, 10) ?? null;
    if (!data || l.situacao_base || data > hoje) continue;
    if (f.dataDe && data < f.dataDe) continue;
    if (f.dataAte && data > f.dataAte) continue;
    if (f.empresaId && l.empresa_id !== f.empresaId) continue;
    if (f.bancoId && l.banco_id !== f.bancoId) continue;
    if (ehSaldoAnterior({ classificacao_nome: l.classificacao_nome ?? null }) || ignoraNaConciliacao({ tipo: l.tipo, descricao: l.descricao ?? "", classificacao_nome: l.classificacao_nome ?? null, banco_nome: l.banco_nome ?? null })) continue;
    const mes = data.slice(0, 7);
    // Conciliação feita por conta só cobre os lançamentos ligados àquela conta (SIS-2026-0777); a feita por banco + empresa cobre todos, como antes.
    const coberta = !!l.banco_id && doFiltro.some((c) => c.banco_id === l.banco_id && c.data_fim.slice(0, 7) === mes && (!c.conta_banco_id || l.conta_banco_id === c.conta_banco_id) && (c.todas_empresas || (!!l.empresa_id && c.empresa_ids.includes(l.empresa_id))));
    if (!coberta) continue;
    const v = Number(l.valor) || 0;
    if (l.tipo === "entrada") entradas += v; else saidas += v;
  }
  return { entradas: r2(entradas), saidas: r2(saidas) };
}

// SIS-2026-0833: de onde vem a diferença entre o Fluxo (card "Saldo de movimentação") e o extrato conciliado.
// Os dois cards não medem a mesma coisa: o Fluxo soma TUDO (inclusive saldo anterior, resgate de conta vinculada que a conciliação ignora e bancos/meses
// sem conciliação salva); o extrato só existe onde há conciliação. Esta função abre a diferença em três partes (ponte) e, por conta, mostra Fluxo × extrato.
export type LinhaParaPonte = LinhaParaTotais & { classificacao_nome?: string | null; descricao?: string | null; banco_nome?: string | null };

export interface PonteTipo {
  fluxoTotal: number; // tudo o que o Fluxo mostra no filtro (uma linha por cota, sem juntar o rateio)
  saldoAnterior: number; // linhas "SALDO ANTERIOR": não é movimento
  ignoradas: number; // resgate de conta vinculada etc., que a conciliação ignora
  semConciliacao: number; // banco/conta/mês sem conciliação salva
  conciliado: number; // o que sobra: Fluxo dos bancos com conciliação (é o que se compara ao extrato)
  extrato: number;
  diferenca: number; // conciliado − extrato
}

export interface LinhaConferenciaConta {
  chave: string;
  bancoId: string | null;
  empresaIds: string[]; // empresas da conciliação ou, sem conciliação, a empresa dos lançamentos
  contaBancoId: string;
  mes: string;
  conciliacaoId: string | null; // null = sem conciliação salva
  fluxoE: number; fluxoS: number;
  extratoE: number | null; extratoS: number | null; // null = sem conciliação (ou sem totais gravados)
  difE: number | null; difS: number | null;
  /** Fluxo que a conciliação gravou no dia em que foi salva (null = sem valores gravados ou sem conciliação). Diferente do de hoje = o Fluxo mudou depois. */
  gravadoE: number | null; gravadoS: number | null;
  contaExtrato: string | null;
}

export interface PonteConciliacao { entradas: PonteTipo; saidas: PonteTipo; linhas: LinhaConferenciaConta[] }

export function explicarFluxoXExtrato<T extends ConciliacaoParaSaldo & CamposExtrato>(
  linhas: LinhaParaPonte[],
  atuais: T[],
  f: { dataDe: string; dataAte: string; empresaId: string | null; bancoId: string | null; mesDe: string; mesAte: string },
  hoje: string,
): PonteConciliacao {
  const doFiltro = atuais.filter((c) => conciliacaoNoFiltro(c, f));
  const nova = (): PonteTipo => ({ fluxoTotal: 0, saldoAnterior: 0, ignoradas: 0, semConciliacao: 0, conciliado: 0, extrato: 0, diferenca: 0 });
  const ponte = { entrada: nova(), saida: nova() };
  const porConc = new Map<string, LinhaConferenciaConta>();
  const semConc = new Map<string, LinhaConferenciaConta>();

  const extratoDe = (c: T): { e: number; s: number } | null => {
    const v = valoresDaConciliacao(c);
    if (v) return { e: v.ee, s: v.es };
    if (c.extrato_entradas != null && c.extrato_saidas != null) return { e: Number(c.extrato_entradas), s: Number(c.extrato_saidas) };
    return null;
  };
  for (const c of doFiltro) {
    const ex = extratoDe(c);
    porConc.set(c.id, {
      chave: c.id, bancoId: c.banco_id, empresaIds: c.todas_empresas ? [] : c.empresa_ids, contaBancoId: c.conta_banco_id ?? "", mes: c.data_fim.slice(0, 7), conciliacaoId: c.id,
      fluxoE: 0, fluxoS: 0, extratoE: ex ? ex.e : null, extratoS: ex ? ex.s : null, difE: null, difS: null,
      gravadoE: valoresDaConciliacao(c)?.fe ?? null, gravadoS: valoresDaConciliacao(c)?.fs ?? null, contaExtrato: c.conta_extrato ?? null,
    });
    if (ex) { ponte.entrada.extrato += ex.e; ponte.saida.extrato += ex.s; }
  }

  for (const l of linhas) {
    const data = l.data_pagamento?.slice(0, 10) ?? null;
    if (!data || l.situacao_base || data > hoje) continue;
    if (f.dataDe && data < f.dataDe) continue;
    if (f.dataAte && data > f.dataAte) continue;
    if (f.empresaId && l.empresa_id !== f.empresaId) continue;
    if (f.bancoId && l.banco_id !== f.bancoId) continue;
    const v = Number(l.valor) || 0;
    const p = l.tipo === "entrada" ? ponte.entrada : ponte.saida;
    p.fluxoTotal += v;
    if (ehSaldoAnterior({ classificacao_nome: l.classificacao_nome ?? null })) { p.saldoAnterior += v; continue; }
    if (ignoraNaConciliacao({ tipo: l.tipo, descricao: l.descricao ?? "", classificacao_nome: l.classificacao_nome ?? null, banco_nome: l.banco_nome ?? null })) { p.ignoradas += v; continue; }
    const mes = data.slice(0, 7);
    const c = l.banco_id
      ? doFiltro.find((x) => x.banco_id === l.banco_id && x.data_fim.slice(0, 7) === mes && (!x.conta_banco_id || l.conta_banco_id === x.conta_banco_id) && (x.todas_empresas || (!!l.empresa_id && x.empresa_ids.includes(l.empresa_id))))
      : undefined;
    if (c) {
      p.conciliado += v;
      const r = porConc.get(c.id)!;
      if (l.tipo === "entrada") r.fluxoE += v; else r.fluxoS += v;
    } else {
      p.semConciliacao += v;
      const k = `${l.empresa_id ?? ""}|${l.banco_id ?? ""}|${l.conta_banco_id ?? ""}|${mes}`;
      const r = semConc.get(k) ?? { chave: k, bancoId: l.banco_id, empresaIds: l.empresa_id ? [l.empresa_id] : [], contaBancoId: l.conta_banco_id ?? "", mes, conciliacaoId: null, fluxoE: 0, fluxoS: 0, extratoE: null, extratoS: null, difE: null, difS: null, gravadoE: null, gravadoS: null, contaExtrato: null };
      semConc.set(k, r);
      if (l.tipo === "entrada") r.fluxoE += v; else r.fluxoS += v;
    }
  }

  const todas = [...porConc.values(), ...semConc.values()].map((r) => {
    const fluxoE = r2(r.fluxoE), fluxoS = r2(r.fluxoS);
    return { ...r, fluxoE, fluxoS, difE: r.extratoE == null ? null : r2(fluxoE - r.extratoE), difS: r.extratoS == null ? null : r2(fluxoS - r.extratoS) };
  });
  for (const p of [ponte.entrada, ponte.saida]) {
    p.fluxoTotal = r2(p.fluxoTotal); p.saldoAnterior = r2(p.saldoAnterior); p.ignoradas = r2(p.ignoradas);
    p.semConciliacao = r2(p.semConciliacao); p.conciliado = r2(p.conciliado); p.extrato = r2(p.extrato);
    p.diferenca = r2(p.conciliado - p.extrato);
  }
  const peso = (r: LinhaConferenciaConta) => (r.conciliacaoId ? Math.abs(r.difE ?? 0) + Math.abs(r.difS ?? 0) : r.fluxoE + r.fluxoS);
  todas.sort((a, b) => peso(b) - peso(a));
  return { entradas: ponte.entrada, saidas: ponte.saida, linhas: todas };
}

// SIS-2026-0833: a mesma conta do extrato (mesma empresa e mês) conciliada mais de uma vez em bancos/contas diferentes: o extrato é contado duas vezes.
// Só vale com número de conta de verdade (o "-" de bancos sem conta não identifica nada).
export interface GrupoDuplicado { contaExtrato: string; mes: string; empresaIds: string[]; ids: string[]; bancoIds: (string | null)[] }
export function conciliacoesDuplicadas(atuais: ConciliacaoParaSaldo[]): GrupoDuplicado[] {
  const grupos = new Map<string, ConciliacaoParaSaldo[]>();
  for (const c of atuais) {
    const conta = (c.conta_extrato ?? "").replace(/\s+/g, "");
    if (!/\d{4,}/.test(conta) || c.todas_empresas) continue;
    const k = [conta, [...c.empresa_ids].sort().join(","), c.data_inicio, c.data_fim].join("|");
    grupos.set(k, [...(grupos.get(k) ?? []), c]);
  }
  return [...grupos.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({ contaExtrato: g[0].conta_extrato ?? "", mes: g[0].data_fim.slice(0, 7), empresaIds: g[0].empresa_ids, ids: g.map((c) => c.id), bancoIds: g.map((c) => c.banco_id) }));
}
