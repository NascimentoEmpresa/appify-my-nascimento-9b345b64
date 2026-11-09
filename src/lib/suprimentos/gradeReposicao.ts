import type { ItemEstoqueSaudavel } from "./estoqueSaudavel";

export const LINHAS_REPOSICAO = [
  { campo: "demanda_mensal", nome: "Giro médio / mês", cor: "text-slate-600" },
  { campo: "disponivel", nome: "Disponível", cor: "text-blue-800" },
  { campo: "em_transito", nome: "Aguardando entrega", cor: "text-amber-800" },
  { campo: "alvo", nome: "Alvo saudável", cor: "text-emerald-800" },
  { campo: "comprar", nome: "Comprar para repor", cor: "bg-blue-50 font-bold text-blue-900" },
  { campo: "aguardando_compra", nome: "Aguardando compra (Malote)", cor: "text-violet-800" },
] as const;

/** Reorganiza linhas já calculadas pela RPC; não recalcula alvo nem compra no navegador. */
export function montarGradeReposicao(itens: ItemEstoqueSaudavel[], busca: string, soPendencias: boolean) {
  const familias = new Map<string, { id: string; nome: string; itens: Map<string | null, ItemEstoqueSaudavel> }>();
  for (const item of itens) {
    if (item.fora_do_plano || item.liquidar) continue;
    if (!item.item.toLocaleLowerCase("pt-BR").includes(busca.trim().toLocaleLowerCase("pt-BR"))) continue;
    let familia = familias.get(item.base_id);
    if (!familia) {
      familia = { id: item.base_id, nome: item.item, itens: new Map() };
      familias.set(item.base_id, familia);
    }
    familia.itens.set(item.tamanho, item);
  }
  // Filtra a família, preservando os tamanhos já cobertos: eles devem mostrar
  // compra zero, em vez de parecerem uma combinação ausente do planejamento.
  const selecionadas = [...familias.values()].filter((familia) => [...familia.itens.values()].some((item) =>
    item.comprar > 0 || item.em_transito > 0 || item.aguardando_compra > 0 ||
    (!soPendencias && (item.demanda_janela > 0 || item.disponivel > 0)),
  ));
  const tamanhos = new Map<string | null, number>();
  for (const familia of selecionadas) {
    for (const item of familia.itens.values()) tamanhos.set(item.tamanho, item.ordem);
  }
  return {
    familias: selecionadas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.id.localeCompare(b.id)),
    tamanhos: [...tamanhos.keys()].sort((a, b) => (tamanhos.get(a) ?? 0) - (tamanhos.get(b) ?? 0) || (a ?? "").localeCompare(b ?? "", "pt-BR", { numeric: true })),
  };
}

export function csvDaGradeReposicao(grade: ReturnType<typeof montarGradeReposicao>): string {
  const linhas: (string | number)[][] = [["Item", "Indicador", ...grade.tamanhos.map((t) => t ?? "Único")]];
  for (const familia of grade.familias) {
    for (const linha of LINHAS_REPOSICAO) {
      linhas.push([familia.nome, linha.nome, ...grade.tamanhos.map((tamanho) => {
        const valor = familia.itens.get(tamanho)?.[linha.campo];
        return valor == null ? "" : String(valor).replace(".", ",");
      })]);
    }
  }
  // Nomes do catálogo podem conter separadores, aspas ou quebras de linha.
  return linhas.map((linha) => linha.map((celula) => `"${String(celula).replace(/"/g, '""')}"`).join(";")).join("\r\n");
}
