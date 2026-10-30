// Férias FRACIONADAS — mais de um pedido para o mesmo colaborador (30/10/2026).
//
// O CASO (Pablo): "Ao solicitar 20 dias de férias do CARLOS AUGUSTO BRUNING o
// sistema está bloqueando porque já tem solicitação, mas preciso solicitar 20
// dias pra janeiro, e o segundo período de 10 dias queria em fevereiro."
// A trava era solicitacao_em_aberto (mig 20260930000104): UM pedido de férias
// a cada 150 dias, ponto. Pela CLT (art. 134 §1º) as férias podem ser
// divididas em até 3 períodos — um com pelo menos 14 dias corridos e os
// outros com pelo menos 5 cada.
//
// Agora o segundo/terceiro pedido passa se:
//   · não se sobrepõe a outro período ativo (Reprovada/Cancelada não contam);
//   · férias + abono de todos os períodos, mais a venda avulsa dos últimos
//     12 meses, não passam de 30 dias;
//   · são no máximo 3 períodos, cada um com 5 dias ou mais, e um deles com
//     14 ou mais — se nenhum chegou a 14 ainda, tem que sobrar espaço para ele.
//
// "Mesmo ciclo" = pedidos de férias ativos criados nos últimos 150 dias (a
// mesma janela da trava antiga): o ERP não guarda o período aquisitivo, ele
// está na Senior.
//
// A mesma regra mora no gatilho ferias_valida_fracionamento (mig
// 20261030003300): a tela avisa antes, o banco recusa. Sem React e sem
// Supabase de propósito — é o que os testes carregam.

export const DIAS_FERIAS_ANO = 30;
export const MAX_PERIODOS = 3;
export const MIN_DIAS_PERIODO = 5;
export const MIN_DIAS_PERIODO_PRINCIPAL = 14;

/** Um pedido de férias já feito (ativo, do mesmo ciclo). `saida` em AAAA-MM-DD. */
export interface PeriodoFerias {
  id?: number | null;
  status?: string | null;
  saida: string;
  dias: number;
  abono?: number | null;
}

/** O pedido novo (ou o refeito). */
export interface NovoPeriodoFerias {
  saida: string;
  dias: number;
  abono?: number | null;
}

const DIA_MS = 86400000;
const paraDia = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10) + "T00:00:00Z") / DIA_MS);
const deDia = (d: number) => new Date(d * DIA_MS).toISOString().slice(0, 10);
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Último dia de férias (o retorno é o dia seguinte). */
export function ultimoDiaFerias(saida: string, dias: number): string {
  return deDia(paraDia(saida) + Math.max(dias, 1) - 1);
}

/** "04/01/2027 a 23/01/2027" */
export function descreverPeriodo(p: { saida: string; dias: number }): string {
  return `${br(p.saida)} a ${br(ultimoDiaFerias(p.saida, p.dias))}`;
}

/** Dias que ainda sobram para pedir (férias + abono). */
export function sobraDias(existentes: PeriodoFerias[], vendidosAvulsos = 0): number {
  const usados = existentes.reduce((s, p) => s + (p.dias || 0) + (p.abono || 0), 0);
  return DIAS_FERIAS_ANO - (vendidosAvulsos || 0) - usados;
}

/**
 * O pedido novo cabe junto com os que já existem?
 * `existentes` NÃO inclui o próprio pedido quando é um refazer.
 */
export function validarPeriodoFerias(
  novo: NovoPeriodoFerias,
  existentes: PeriodoFerias[],
  vendidosAvulsos = 0,
): { ok: boolean; motivo: string } {
  const dias = novo.dias || 0;
  const abono = novo.abono || 0;

  if (dias < MIN_DIAS_PERIODO) {
    return { ok: false, motivo: `Cada período de férias tem que ter pelo menos ${MIN_DIAS_PERIODO} dias.` };
  }

  const ini = paraDia(novo.saida), fim = ini + dias;   // [saída, retorno)
  const conflito = existentes.find(p => {
    const pi = paraDia(p.saida);
    return ini < pi + (p.dias || 0) && pi < fim;
  });
  if (conflito) {
    return { ok: false, motivo: `Conflita com as férias de ${descreverPeriodo(conflito)}${conflito.id ? ` (#${conflito.id})` : ""}.` };
  }

  if (existentes.length >= MAX_PERIODOS) {
    return { ok: false, motivo: `Este colaborador já tem ${MAX_PERIODOS} períodos de férias pedidos — é o máximo que a CLT permite.` };
  }

  const sobra = sobraDias(existentes, vendidosAvulsos);
  if (dias + abono > sobra) {
    return {
      ok: false,
      motivo: sobra <= 0
        ? "Este colaborador já tem os 30 dias de férias pedidos."
        : `Sobra${sobra === 1 ? "" : "m"} ${sobra} dia(s) de férias para este colaborador (férias + abono) — este pedido tem ${dias + abono}.`,
    };
  }

  const temPrincipal = dias >= MIN_DIAS_PERIODO_PRINCIPAL || existentes.some(p => (p.dias || 0) >= MIN_DIAS_PERIODO_PRINCIPAL);
  if (!temPrincipal) {
    const sobraDepois = sobra - dias - abono;
    if (existentes.length + 1 >= MAX_PERIODOS || sobraDepois < MIN_DIAS_PERIODO_PRINCIPAL) {
      return {
        ok: false,
        motivo: `Pela CLT, um dos períodos tem que ter pelo menos ${MIN_DIAS_PERIODO_PRINCIPAL} dias — com este pedido não sobra espaço para ele. Aumente este período para ${MIN_DIAS_PERIODO_PRINCIPAL} dias ou mais.`,
      };
    }
  }

  return { ok: true, motivo: "" };
}
