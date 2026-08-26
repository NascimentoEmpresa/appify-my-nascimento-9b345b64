/**
 * Espelha `sup_uniforme_ciclo` do Postgres.
 *
 * A regra tem dois sinais que não podem virar um alerta só, porque a ação de
 * cada um é oposta:
 *
 *   troca devida → passou o ciclo desde a última entrega; alguém precisa
 *                  providenciar a muda.
 *   excesso      → entregas demais na janela; alguém precisa explicar.
 *
 * Receber menos que o previsto NUNCA alerta. Foi decisão explícita do Eduardo
 * em 26/08/2026: "aqui para a empresa é até economia e mais lucro nesse caso".
 *
 * A janela é de meses corridos a contar de hoje, não de ano-calendário — três
 * entregas em dezembro e janeiro cairiam em anos diferentes e escapariam de um
 * corte por ano, que é justamente o padrão de quem está abusando.
 */

export const CICLO_MESES_PADRAO = 12;
export const LIMITE_JANELA_PADRAO = 2;

export interface EntregaUniforme {
  /** Um evento de entrega (um pedido), não uma peça. */
  pedidoId: string;
  entregueEm: string | Date;
}

export interface CicloUniforme {
  entregasNaJanela: number;
  ultimaEntrega: string | null;
  mesesDesdeUltima: number | null;
  trocaDevida: boolean;
  excesso: boolean;
}

/** Dia civil estável, sem deslocamento por fuso — mesmo cuidado de `situacaoCa`. */
function diaCivil(valor: string | Date | null | undefined): number | null {
  if (!valor) return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return Date.UTC(valor.getFullYear(), valor.getMonth(), valor.getDate());
  }
  const p = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!p) return null;
  const [ano, mes, dia] = [Number(p[1]), Number(p[2]), Number(p[3])];
  const inst = Date.UTC(ano, mes - 1, dia);
  const c = new Date(inst);
  if (c.getUTCFullYear() !== ano || c.getUTCMonth() !== mes - 1 || c.getUTCDate() !== dia) {
    return null;
  }
  return inst;
}

function hojeUTC(): number {
  const a = new Date();
  return Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
}

/** Recua `meses` a partir de hoje, preservando o dia quando possível. */
function limiteDaJanela(meses: number, hoje: number): number {
  const d = new Date(hoje);
  const alvo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - meses, d.getUTCDate()));
  // Se o dia não existe no mês de destino (31 → fevereiro), o Date rola para o
  // mês seguinte; puxar de volta para o último dia do mês pretendido mantém a
  // janela com o tamanho que foi pedido.
  if (alvo.getUTCDate() !== d.getUTCDate()) alvo.setUTCDate(0);
  return alvo.getTime();
}

export function calcularCicloUniforme(
  entregas: EntregaUniforme[],
  cicloMeses: number = CICLO_MESES_PADRAO,
  limiteJanela: number = LIMITE_JANELA_PADRAO,
): CicloUniforme {
  const hoje = hojeUTC();
  const limite = limiteDaJanela(cicloMeses, hoje);

  // Um pedido é um evento, mesmo que apareça repetido na origem.
  const porPedido = new Map<string, number>();
  for (const e of entregas) {
    const dia = diaCivil(e.entregueEm);
    if (dia === null) continue;
    const atual = porPedido.get(e.pedidoId);
    if (atual === undefined || dia > atual) porPedido.set(e.pedidoId, dia);
  }

  const dias = [...porPedido.values()].sort((a, b) => a - b);
  if (!dias.length) {
    return {
      entregasNaJanela: 0,
      ultimaEntrega: null,
      mesesDesdeUltima: null,
      trocaDevida: false,
      excesso: false,
    };
  }

  const ultima = dias[dias.length - 1];
  const entregasNaJanela = dias.filter((d) => d > limite).length;

  return {
    entregasNaJanela,
    ultimaEntrega: new Date(ultima).toISOString().slice(0, 10),
    mesesDesdeUltima: mesesEntre(ultima, hoje),
    // `<=` e não `<`: no dia exato em que fecha o ciclo, a troca já é devida.
    trocaDevida: ultima <= limite,
    excesso: entregasNaJanela > limiteJanela,
  };
}

function mesesEntre(de: number, ate: number): number {
  const a = new Date(de);
  const b = new Date(ate);
  let meses = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) meses--;
  return Math.max(meses, 0);
}
