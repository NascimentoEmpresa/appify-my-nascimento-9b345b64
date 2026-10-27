// SIS-2026-0726: os cards de Entradas, Saídas e Saldo do Fluxo separam o que é de uso livre do que não pode ser usado (conta vinculada, CDB).
// A natureza vem da CLASSIFICAÇÃO de cada lançamento (mapa financeiro_fluxo_classificacao_natureza). Lançamento rateado com classificações
// diferentes conta cada cota na natureza da sua classificação. Sem classificação, ou classificação sem natureza, NÃO é chutado para um grupo:
// fica em "semNatureza", que a tela acusa.
//
// V1 (conta vinculada): enquanto não existe classificação própria para ela, o lançamento SEM natureza definida na classificação cujo banco ou
// descrição diga "conta vinculada" entra em Conta vinculada. A classificação mapeada sempre vence, e os cards mostram quanto veio por esse texto.

export type NaturezaFluxo = "livre" | "conta_vinculada" | "cdb";
export type GrupoNatureza = NaturezaFluxo | "semNatureza";

export const NATUREZAS: { valor: NaturezaFluxo; rotulo: string }[] = [
  { valor: "livre", rotulo: "Conta movimento (livre utilização)" },
  { valor: "conta_vinculada", rotulo: "Conta vinculada" },
  { valor: "cdb", rotulo: "Aplicações em CDB" },
];

export type MapaNatureza = Map<string, NaturezaFluxo>;

export interface ParteClassificacao {
  classificacaoId: string | null;
  valor: number;
}

interface LinhaNatureza {
  tipo: "entrada" | "saida";
  valor: number | string;
  // Valor da linha repartido por classificação (cotas do rateio). Ausente = a linha inteira é da classificação dela.
  partesClassificacao?: ParteClassificacao[];
  classificacao_id?: string | null;
  descricao?: string | null;
  banco_nome?: string | null;
}

const semAcento = (t: string | null | undefined) => (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

// "CONTA VINCULADA" no nome do banco (ex.: "Banco do Brasil Conta Vinculada Embrapa") ou na descrição ("RESGATE CONTA VINCULADA").
export function ehContaVinculadaPorTexto(l: { descricao?: string | null; banco_nome?: string | null }): boolean {
  return semAcento(l.banco_nome).includes("CONTA VINCULADA") || semAcento(l.descricao).includes("CONTA VINCULADA");
}

export interface TotaisPorGrupo {
  livre: number;
  conta_vinculada: number;
  cdb: number;
  semNatureza: number;
  total: number;
}

export interface TotaisNatureza {
  entradas: TotaisPorGrupo;
  saidas: TotaisPorGrupo;
  // entradas − saídas de cada grupo
  saldo: TotaisPorGrupo;
  // lançamentos (e o valor) que caíram em "sem natureza", por classificação (null = sem classificação), para o aviso e o diálogo
  semNaturezaPorClassificacao: { classificacaoId: string | null; valor: number; qtd: number }[];
  // parte de Conta vinculada que veio do texto (banco/descrição) e não da classificação
  contaVinculadaPorTexto: { entradas: number; saidas: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const zerado = (): TotaisPorGrupo => ({ livre: 0, conta_vinculada: 0, cdb: 0, semNatureza: 0, total: 0 });

export function totaisPorNatureza(linhas: LinhaNatureza[], mapa: MapaNatureza): TotaisNatureza {
  const entradas = zerado();
  const saidas = zerado();
  const semMapa = new Map<string, { classificacaoId: string | null; valor: number; qtd: number }>();
  const porTexto = { entradas: 0, saidas: 0 };

  for (const l of linhas) {
    const partes: ParteClassificacao[] = l.partesClassificacao?.length
      ? l.partesClassificacao
      : [{ classificacaoId: l.classificacao_id ?? null, valor: Number(l.valor) || 0 }];
    const alvo = l.tipo === "entrada" ? entradas : saidas;
    const textoVinculada = ehContaVinculadaPorTexto(l);
    for (const p of partes) {
      const mapeada = p.classificacaoId ? mapa.get(p.classificacaoId) : undefined;
      const viaTexto = !mapeada && textoVinculada;
      if (viaTexto) porTexto[l.tipo === "entrada" ? "entradas" : "saidas"] += p.valor;
      const natureza: NaturezaFluxo | undefined = mapeada ?? (viaTexto ? "conta_vinculada" : undefined);
      const grupo: GrupoNatureza = natureza ?? "semNatureza";
      alvo[grupo] += p.valor;
      alvo.total += p.valor;
      if (grupo === "semNatureza") {
        const k = p.classificacaoId ?? "";
        const atual = semMapa.get(k) ?? { classificacaoId: p.classificacaoId, valor: 0, qtd: 0 };
        atual.valor += p.valor;
        atual.qtd += 1;
        semMapa.set(k, atual);
      }
    }
  }

  const arredonda = (t: TotaisPorGrupo): TotaisPorGrupo => ({
    livre: r2(t.livre), conta_vinculada: r2(t.conta_vinculada), cdb: r2(t.cdb), semNatureza: r2(t.semNatureza), total: r2(t.total),
  });
  const e = arredonda(entradas);
  const s = arredonda(saidas);
  const saldo: TotaisPorGrupo = {
    livre: r2(e.livre - s.livre),
    conta_vinculada: r2(e.conta_vinculada - s.conta_vinculada),
    cdb: r2(e.cdb - s.cdb),
    semNatureza: r2(e.semNatureza - s.semNatureza),
    total: r2(e.total - s.total),
  };
  return {
    entradas: e,
    saidas: s,
    saldo,
    contaVinculadaPorTexto: { entradas: r2(porTexto.entradas), saidas: r2(porTexto.saidas) },
    semNaturezaPorClassificacao: Array.from(semMapa.values())
      .map((x) => ({ ...x, valor: r2(x.valor) }))
      .sort((a, b) => b.valor - a.valor),
  };
}
