// SIS-2026-0900: total do rateio de uma despesa do Malote por classificação (e, dentro de cada uma, por empresa).
// Caso de origem: o boleto do FGTS + consignado do RH é UMA despesa, rateada em várias empresas e em duas classificações (FGTS e Consignado).
// Quem aprova (e quem paga) via só o valor total e não conseguia conferir se cada classificação foi rateada certo. Só leitura, funções puras.

export interface LinhaParaTotal {
  classificacao_id?: string | null;
  empresa_id: string | null;
  valor: number;
}

export interface TotalEmpresa { empresaId: string | null; valor: number; linhas: number }
export interface TotalClassificacao {
  classificacaoId: string | null;
  valor: number;
  /** Parte do total rateado; null com total zero. */
  percentual: number | null;
  linhas: number;
  porEmpresa: TotalEmpresa[];
}
export interface ResumoRateio {
  grupos: TotalClassificacao[];
  /** Soma de todas as linhas do rateio. */
  total: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Agrupa as linhas por classificação, na ordem em que aparecem no rateio. A linha sem classificação própria vale a da despesa
 * (`classificacaoPadrao`). Dentro de cada classificação, subtotal por empresa (maior valor primeiro).
 */
export function totaisPorClassificacao(linhas: LinhaParaTotal[], classificacaoPadrao: string | null): ResumoRateio {
  const mapa = new Map<string, TotalClassificacao>();
  const porEmpresa = new Map<string, Map<string, TotalEmpresa>>();
  for (const l of linhas) {
    const classificacaoId = l.classificacao_id || classificacaoPadrao || null;
    const chave = classificacaoId ?? "";
    let g = mapa.get(chave);
    if (!g) {
      g = { classificacaoId, valor: 0, percentual: null, linhas: 0, porEmpresa: [] };
      mapa.set(chave, g);
      porEmpresa.set(chave, new Map());
    }
    const valor = Number(l.valor) || 0;
    g.valor += valor;
    g.linhas += 1;
    const empresas = porEmpresa.get(chave)!;
    const chaveEmpresa = l.empresa_id ?? "";
    const e = empresas.get(chaveEmpresa) ?? { empresaId: l.empresa_id ?? null, valor: 0, linhas: 0 };
    e.valor += valor;
    e.linhas += 1;
    empresas.set(chaveEmpresa, e);
  }
  const total = r2([...mapa.values()].reduce((s, g) => s + g.valor, 0));
  const grupos = [...mapa.entries()].map(([chave, g]) => ({
    ...g,
    valor: r2(g.valor),
    percentual: total !== 0 ? r2((g.valor / total) * 100) : null,
    porEmpresa: [...porEmpresa.get(chave)!.values()].map((e) => ({ ...e, valor: r2(e.valor) })).sort((a, b) => b.valor - a.valor),
  }));
  return { grupos, total };
}

/** O resumo só ajuda quando há mais de uma classificação no rateio (com uma só, o total é o próprio valor da despesa). */
export function mostrarResumoPorClassificacao(resumo: ResumoRateio): boolean {
  return resumo.grupos.length > 1;
}

/** Diferença entre o valor da despesa e a soma do rateio (positivo = falta ratear; negativo = rateado a mais). Só o ruído de ponto flutuante é ignorado: 1 centavo de diferença é diferença. */
export function diferencaDoRateio(valorDespesa: number, resumo: ResumoRateio): number {
  const dif = r2(valorDespesa - resumo.total);
  return Math.abs(dif) < 0.005 ? 0 : dif;
}
