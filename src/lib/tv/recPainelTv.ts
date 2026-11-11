// =====================================================================
// TV › RECRUTAMENTO E SELEÇÃO (11/11/2026, mig 20261111190000)
//
// "Onde precisamos agir para garantir o preenchimento dos postos?" — o
// layout do modelo do Pablo, animado, girando os contratos. As contas moram
// no banco (tv_recrutamento_dados, as mesmas dos cards da TV gerencial); aqui
// o tom de cada número (ruim só quando é verdadeiro) e os blocos de contratos.
// =====================================================================

export interface ContratoVagas {
  contrato: string; cidade: string; solicitadas: number; preenchimento: number; atrasadas: number; risco: number; mais_antiga: number;
}

export interface DadosRecPainelTv {
  vagas: {
    prazo_dias: number; abertas: number; contratos: number; cidades: number; em_preenchimento: number;
    acima_prazo: number; risco: number; por_status: { status: string; qtd: number }[]; por_contrato: ContratoVagas[];
  };
  admissoes: { previstas: number; concluidas: number; pendentes_por_contrato: { contrato: string; qtd: number }[] };
  desistencias: { dias: number; total: number; por_motivo: { motivo: string; qtd: number }[] };
  gerado_em?: string;
}

/** Cada bloco de contratos fica 10 s (pedido: "vai trocando os contratos com o tempo"). */
export const SEGUNDOS_POR_BLOCO_REC = 10;
export const CONTRATOS_POR_BLOCO = 4;

/** Meta de prazo: até 5 vagas acima do prazo é bom; até 10, atenção (a mesma do card gerencial). */
export const META_PRAZO = { bom: 5, atencao: 10 };
/** Meta de admissões: ≥ 90% concluídas é bom; ≥ 75%, atenção. */
export const META_ADMISSOES = { bom: 90, atencao: 75 };

export type Tom = "bom" | "atencao" | "critico" | "neutro";

export const pctAdmissoes = (a: DadosRecPainelTv["admissoes"]): number | null =>
  a.previstas > 0 ? Math.round((100 * a.concluidas) / a.previstas) : null;

export function tons(d: DadosRecPainelTv): Record<"risco" | "abertas" | "prazo" | "admissoes" | "desistencias", Tom> {
  const pct = pctAdmissoes(d.admissoes);
  return {
    risco: d.vagas.risco === 0 ? "bom" : "critico",
    abertas: "neutro",
    prazo: d.vagas.acima_prazo <= META_PRAZO.bom ? "bom" : d.vagas.acima_prazo <= META_PRAZO.atencao ? "atencao" : "critico",
    admissoes: pct == null ? "neutro" : pct >= META_ADMISSOES.bom ? "bom" : pct >= META_ADMISSOES.atencao ? "atencao" : "critico",
    // Desistência acontece em todo processo: o número informa, não acusa.
    desistencias: "neutro",
  };
}

/** Os contratos em blocos de N (a TV gira um bloco a cada 10 s). Sempre pelo menos um bloco. */
export function blocosDeContratos<T>(lista: T[], n = CONTRATOS_POR_BLOCO): T[][] {
  if (!lista.length) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

/** "Onde agir agora": só o que tem o que fazer. */
export function ondeAgir(d: DadosRecPainelTv): { texto: string; valor: number }[] {
  const pendentes = Math.max(d.admissoes.previstas - d.admissoes.concluidas, 0);
  return [
    { texto: "Evitar postos descobertos", valor: d.vagas.risco },
    { texto: "Destravar processos em atraso", valor: d.vagas.acima_prazo },
    { texto: "Concluir admissões previstas", valor: pendentes },
    { texto: "Entender as desistências", valor: d.desistencias.total },
  ].filter((x) => x.valor > 0);
}
