// =====================================================================
// TV — Painel Executivo de Licitações (08/10/2026, mig 20261008000007)
//
// Pedido do Pablo: "transforma o dashboard de /app/painel-executivo/tv em
// um dashboard da licitação nos relatórios da TV — não modifica esse,
// apenas cria um se baseando nesse". A TV recebe a grade crua
// (tv_licitacao_dados, o grupo inteiro) e faz aqui as MESMAS contas do
// usePainelLicitacao (src/hooks/usePainelLicitacao.ts — de lá vêm as regras:
// "participados" sem Não Participado/Suspenso/Revogado, vitória = Finalizada
// em 1º lugar, valor da grade em texto BR, aberturas em até 7 dias só das
// fases ativas, evolução dos últimos 6 meses pela criação). O hook não foi
// tocado; se a regra mudar lá, mudar aqui também (teste em
// src/test/sistemas-tvs-licitacoes.test.ts).
// =====================================================================

/** [id, edital, fase, responsavel, cidade, uf, data, objeto, qtd_pessoas, valor_global, posicao, created_at, updated_at, empresa] */
export type LinhaLicitacaoTv = [
  string, string | null, string, string | null, string | null, string | null, string | null, string | null,
  number | null, string | null, number | null, string, string | null, string | null,
];

export interface ItemLicitacao {
  id: string; edital: string | null; fase: string; responsavel: string | null; cidade: string | null; uf: string | null;
  data: string | null; objeto: string | null; qtd_pessoas: number | null; valor_global: string | null; posicao: number | null;
  created_at: string; updated_at: string | null; empresa: string | null;
}

export const paraItensLicitacao = (linhas: LinhaLicitacaoTv[]): ItemLicitacao[] =>
  linhas.map(([id, edital, fase, responsavel, cidade, uf, data, objeto, qtd_pessoas, valor_global, posicao, created_at, updated_at, empresa]) => ({
    id, edital, fase, responsavel, cidade, uf, data, objeto, qtd_pessoas, valor_global, posicao, created_at, updated_at, empresa,
  }));

/** "R$ 1.750.267,32" → 1750267.32 (mesma conta do usePainelLicitacao). */
export function valorDaGrade(v: string | null | undefined): number {
  if (!v) return 0;
  const s = v.replace(/[R$\s]/g, "");
  const n = s.includes(",") ? parseFloat(s.replace(/\./g, "").replace(",", ".")) : parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

const NAO_PARTICIPADO = new Set(["Não Participado", "Suspenso", "Revogado"]);
export const FASES_ATIVAS = ["À Iniciar", "Iniciado", "Em Andamento"];

/** Cores das fases — as do Painel Executivo (fundo claro). */
export const COR_FASE: Record<string, string> = {
  "Em Andamento": "#f59e0b", "Finalizada (Ganho)": "#22c55e", "Finalizada (Perdido)": "#ef4444", "Suspenso": "#8b5cf6",
  "Revogado": "#6b7280", "À Iniciar": "#3b82f6", "Iniciado": "#06b6d4", "Não Participado": "#d1d5db",
};

/** Dias até a abertura (0 = hoje); null se já passou ou não tem data. */
export function diasAteAbertura(data: string | null | undefined, hoje: Date = new Date()): number | null {
  if (!data) return null;
  const h = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const d = new Date(`${data.slice(0, 10)}T00:00:00`);
  const dias = Math.ceil((d.getTime() - h.getTime()) / 86_400_000);
  return dias < 0 ? null : dias;
}
export const urgenciaAbertura = (dias: number | null) => (dias == null ? null : dias <= 3 ? "critica" : dias <= 7 ? "proxima" : "normal");

const chaveResp = (s: string) => s.trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// ---- Cidade e UF ---------------------------------------------------------------
// Na grade, 63% dos processos vêm SEM UF (306 de 486 em 08/10/2026) e a mesma
// cidade aparece escrita de vários jeitos ("FLORIANOPOLIS" / "Florianópolis").
// O Painel resolve isso no mapa com a lista oficial de municípios do IBGE; a
// TV faz o mesmo, em três passos: a UF da grade; senão, a UF que a MESMA
// cidade tem em outros processos; senão, a do IBGE (se o nome existe em mais
// de uma UF, a UF onde o grupo mais tem processos). Sem nada disso, fica
// "sem estado" (e o cartão diz quantos).

/** Município do IBGE (o mesmo formato do cache do Painel Executivo). */
export type Municipio = { nome: string; uf: string };

/** "São José do Norte" / "SAO JOSE DO NORTE" → "saojosenorte" (a mesma normalização do Painel). */
export const chaveCidade = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\b(da|de|do|das|dos|e|d')\b/g, "").replace(/[^a-z0-9]/g, "");

const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e"]);
/** "SÃO JOSÉ DO NORTE" → "São José do Norte"; escrito em caixa mista fica como está. */
export function nomeDeCidade(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().split(" ").map((w, i) => (i > 0 && PARTICULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}
/** Das grafias da mesma cidade, a mais "correta": com acento e em caixa mista. */
const melhorGrafia = (grafias: string[]) =>
  [...grafias].sort((a, b) => nota(b) - nota(a))[0];
const nota = (s: string) => (s.normalize("NFD") !== s ? 2 : 0) + (s !== s.toUpperCase() ? 1 : 0); // acento (decompõe) e caixa mista
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function estatisticasLicitacao(itens: ItemLicitacao[], hoje: Date = new Date(), municipios: Municipio[] = []) {
  const participados = itens.filter((i) => !NAO_PARTICIPADO.has(i.fase));
  const ativas = itens.filter((i) => FASES_ATIVAS.includes(i.fase));
  const finalizadas = itens.filter((i) => i.fase === "Finalizada");
  const ganhas = finalizadas.filter((i) => i.posicao === 1);
  const perdidas = finalizadas.filter((i) => i.posicao !== 1);
  const decididas = ganhas.length + perdidas.length;

  // Por fase (o funil do Painel): sem os não participados; Finalizada em ganho/perdido.
  const fases = new Map<string, number>();
  for (const i of participados) {
    const nome = i.fase === "Finalizada" ? (i.posicao === 1 ? "Finalizada (Ganho)" : "Finalizada (Perdido)") : i.fase;
    fases.set(nome, (fases.get(nome) ?? 0) + 1);
  }
  const porFase = [...fases.entries()].map(([nome, n]) => ({ nome, n, cor: COR_FASE[nome] ?? "#94a3b8" })).sort((a, b) => b.n - a.n);

  // Por responsável (participados), por valor — os 8 maiores, como no Painel.
  const resp = new Map<string, { nome: string; qtd: number; valor: number; vitorias: number; perdidas: number }>();
  for (const i of participados) {
    const k = i.responsavel ? chaveResp(i.responsavel) : "SEM RESPONSÁVEL";
    const cur = resp.get(k) ?? { nome: i.responsavel ? i.responsavel.trim().toUpperCase() : "Sem responsável", qtd: 0, valor: 0, vitorias: 0, perdidas: 0 };
    cur.qtd++; cur.valor += valorDaGrade(i.valor_global);
    if (i.fase === "Finalizada" && i.posicao === 1) cur.vitorias++;
    if (i.fase === "Finalizada" && i.posicao !== 1) cur.perdidas++;
    resp.set(k, cur);
  }
  const porResponsavel = [...resp.values()]
    .map((r) => ({ ...r, taxa: r.vitorias + r.perdidas > 0 ? (r.vitorias / (r.vitorias + r.perdidas)) * 100 : null }))
    .sort((a, b) => b.valor - a.valor).slice(0, 8);

  // Evolução: processos criados em cada um dos últimos 6 meses (e o valor deles).
  const evolucao = Array.from({ length: 6 }, (_, k) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - (5 - k), 1);
    const doMes = itens.filter((i) => { const c = new Date(i.created_at); return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth(); });
    return { rotulo: MESES[d.getMonth()], processos: doMes.length, valor: doMes.reduce((s, i) => s + valorDaGrade(i.valor_global), 0) };
  });

  // Próximas aberturas (só fases ativas, de hoje em diante), da mais próxima —
  // a lista "Alertas" do Painel; o número do cartão conta só as de até 7 dias.
  const proximasAberturas = ativas
    .map((i) => ({ item: i, dias: diasAteAbertura(i.data, hoje) }))
    .filter((x): x is { item: ItemLicitacao; dias: number } => x.dias != null)
    .sort((a, b) => a.dias - b.dias || (a.item.data ?? "").localeCompare(b.item.data ?? ""));

  // Onde estão os processos (todos, como o mapa do Painel).
  const ufDaGrade = (i: ItemLicitacao) => (i.uf ?? "").trim().toUpperCase();
  const pesoUf = new Map<string, number>();
  const ufsDaCidade = new Map<string, Map<string, number>>();
  for (const i of itens) {
    const uf = ufDaGrade(i);
    if (!uf) continue;
    pesoUf.set(uf, (pesoUf.get(uf) ?? 0) + 1);
    if (i.cidade?.trim()) {
      const k = chaveCidade(i.cidade);
      const m = ufsDaCidade.get(k) ?? new Map<string, number>();
      m.set(uf, (m.get(uf) ?? 0) + 1); ufsDaCidade.set(k, m);
    }
  }
  const ibge = new Map<string, Municipio[]>();
  for (const m of municipios) { const k = chaveCidade(m.nome); ibge.set(k, [...(ibge.get(k) ?? []), m]); }
  const ufDe = (i: ItemLicitacao): string | null => {
    const uf = ufDaGrade(i);
    if (uf) return uf;
    if (!i.cidade?.trim()) return null;
    const k = chaveCidade(i.cidade);
    const vistas = ufsDaCidade.get(k);
    if (vistas) return [...vistas.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const oficiais = ibge.get(k) ?? [];
    if (oficiais.length === 1) return oficiais[0].uf;
    const provavel = [...oficiais].sort((a, b) => (pesoUf.get(b.uf) ?? 0) - (pesoUf.get(a.uf) ?? 0))[0];
    return provavel && (pesoUf.get(provavel.uf) ?? 0) > 0 ? provavel.uf : null;
  };

  const ufs = new Map<string, number>();
  const cidades = new Map<string, { grafias: string[]; uf: string | null; n: number; chave: string }>();
  let semUF = 0;
  for (const i of itens) {
    const uf = ufDe(i);
    if (uf) ufs.set(uf, (ufs.get(uf) ?? 0) + 1); else semUF++;
    if (i.cidade?.trim()) {
      const chave = chaveCidade(i.cidade);
      const k = `${chave}|${uf ?? ""}`;
      const c = cidades.get(k) ?? { grafias: [], uf, n: 0, chave };
      c.n++; c.grafias.push(i.cidade.trim()); cidades.set(k, c);
    }
  }
  const nomeOficial = (chave: string, uf: string | null) => (ibge.get(chave) ?? []).find((m) => !uf || m.uf === uf)?.nome;

  const ultimosResultados = [...finalizadas]
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, 6)
    .map((i) => ({ item: i, ganhou: i.posicao === 1 }));

  return {
    total: itens.length,
    ativas: ativas.length,
    finalizadas: finalizadas.length,
    ganhas: ganhas.length,
    perdidas: perdidas.length,
    naoParticipados: itens.filter((i) => i.fase === "Não Participado").length,
    taxaVitoria: decididas ? (ganhas.length / decididas) * 100 : 0,
    valorPipeline: participados.reduce((s, i) => s + valorDaGrade(i.valor_global), 0),
    valorGanho: ganhas.reduce((s, i) => s + valorDaGrade(i.valor_global), 0),
    pessoasGanhas: ganhas.reduce((s, i) => s + (i.qtd_pessoas ?? 0), 0),
    porFase, porResponsavel, evolucao, proximasAberturas,
    aberturas7d: proximasAberturas.filter((a) => a.dias <= 7).length,
    porUF: ufs,
    semUF,
    topCidades: [...cidades.values()]
      .map((c) => ({ cidade: nomeOficial(c.chave, c.uf) ?? nomeDeCidade(melhorGrafia(c.grafias)), uf: c.uf, n: c.n }))
      .sort((a, b) => b.n - a.n),
    ultimosResultados,
  };
}

/** R$ curto para número grande de TV: 39.990.944.339 → { valor: "R$ 39,9", unidade: "bilhões" } (trunca, não arredonda — como o Painel). */
export function reaisCurto(v: number): { valor: string; unidade: string } {
  const t1 = (n: number) => (Math.floor(n * 10) / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (v >= 1e9) return { valor: `R$ ${t1(v / 1e9)}`, unidade: "bilhões" };
  if (v >= 1e6) return { valor: `R$ ${t1(v / 1e6)}`, unidade: "milhões" };
  if (v >= 1e3) return { valor: `R$ ${Math.floor(v / 1e3).toLocaleString("pt-BR")}`, unidade: "mil" };
  return { valor: `R$ ${Math.round(v).toLocaleString("pt-BR")}`, unidade: "" };
}

/** R$ abreviado para caber numa linha: "R$ 12,3 mi", "R$ 1,2 bi", "R$ 850 mil"; null sem valor. */
export function reaisAbreviado(v: number | null | undefined): string | null {
  if (v == null || !(v > 0)) return null;
  const { valor, unidade } = reaisCurto(v);
  const sigla: Record<string, string> = { "bilhões": "bi", "milhões": "mi", mil: "mil" };
  return unidade ? `${valor} ${sigla[unidade]}` : valor;
}

/**
 * O Brasil em quadradinhos (um por UF, na posição aproximada do mapa) —
 * no lugar do mapa com geocodificação do Painel: na TV não dá para depender
 * de serviço externo (IBGE/OpenStreetMap) a cada volta da playlist.
 */
export const MAPA_UF: { uf: string; col: number; lin: number }[] = [
  { uf: "RR", col: 2, lin: 0 }, { uf: "AP", col: 4, lin: 0 },
  { uf: "AM", col: 1, lin: 1 }, { uf: "PA", col: 3, lin: 1 }, { uf: "MA", col: 4, lin: 1 }, { uf: "CE", col: 5, lin: 1 }, { uf: "RN", col: 6, lin: 1 },
  { uf: "AC", col: 0, lin: 2 }, { uf: "RO", col: 1, lin: 2 }, { uf: "TO", col: 3, lin: 2 }, { uf: "PI", col: 4, lin: 2 }, { uf: "PE", col: 5, lin: 2 }, { uf: "PB", col: 6, lin: 2 },
  { uf: "MT", col: 2, lin: 3 }, { uf: "GO", col: 3, lin: 3 }, { uf: "BA", col: 4, lin: 3 }, { uf: "SE", col: 5, lin: 3 }, { uf: "AL", col: 6, lin: 3 },
  { uf: "MS", col: 2, lin: 4 }, { uf: "DF", col: 3, lin: 4 }, { uf: "MG", col: 4, lin: 4 }, { uf: "ES", col: 5, lin: 4 },
  { uf: "SP", col: 3, lin: 5 }, { uf: "RJ", col: 4, lin: 5 },
  { uf: "PR", col: 3, lin: 6 },
  { uf: "RS", col: 2, lin: 7 }, { uf: "SC", col: 3, lin: 7 },
];
