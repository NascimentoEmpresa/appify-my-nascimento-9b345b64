// Postos da vaga = postos da PLANILHA DE CUSTO do contrato (13/11/2026).
//
// RELATO (Pablo): no Solicitar Nova Vaga, contrato 1065 - DMAE - 895/0, o
// "Selecione o posto" mostrava GALERIA DE ARTES, PORTARIA DA GDCE... —
// locais antigos do catálogo de Suprimentos — em vez dos 4 postos da
// planilha. sup_cat_postos_do_contrato devolve todo sup_posto ativo (os da
// planilha + os do quadro + os antigos que ainda têm função), o que está
// certo pro Catálogo e errado pra vaga: V.A e V.T só saem de posto que está
// na planilha (rec_custo_do_posto casa pelo nome).
//
// A planilha vem de rec_postos_planilha_do_contrato (mig 20261115000500),
// que já traz o id do espelho em sup_posto (é ele que a vaga grava) e os
// endereços cadastrados no posto (planilha_posto_localizacao).

export interface PostoCatalogoBase { id: string; nome: string; na_planilha?: boolean }

export interface LocalPlanilha {
  nome?: string | null; cep?: string | null; logradouro?: string | null; numero?: string | null;
  complemento?: string | null; bairro?: string | null; municipio?: string | null; uf?: string | null;
}

export interface PostoPlanilha {
  sup_posto_id: string | null;
  posto: string;
  planilha_custo_id: string;
  vigencia: string | null;
  locais: LocalPlanilha[] | null;
}

/**
 * Quais postos do catálogo a vaga oferece.
 *
 * - planilha lida e com posto → só os do catálogo que são espelho dela;
 * - planilha não pôde ser lida (`null`: RPC ainda não aplicada, erro) → cai
 *   no `na_planilha` que o próprio catálogo devolve;
 * - contrato sem nenhum posto na planilha → catálogo inteiro, como era
 *   antes: não há planilha que contradiga, e o posto ainda define os
 *   uniformes/EPIs da admissão.
 */
export function postosDaPlanilha<T extends PostoCatalogoBase>(catalogo: T[], planilha: PostoPlanilha[] | null): T[] {
  if (planilha === null) {
    const marcados = catalogo.filter(p => p.na_planilha === true);
    return marcados.length ? marcados : catalogo;
  }
  const ids = new Set(planilha.map(p => p.sup_posto_id).filter((x): x is string => !!x));
  if (planilha.length === 0) return catalogo;
  return catalogo.filter(p => ids.has(p.id));
}

const limpa = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ");

/** Um local da planilha em uma linha: "Rua X, 120 - sala 2, Centro, Porto Alegre/RS, CEP 90000-000". */
export function formatarLocal(l: LocalPlanilha): string {
  const rua = [limpa(l.logradouro), limpa(l.numero)].filter(Boolean).join(", ");
  const ruaComp = [rua, limpa(l.complemento)].filter(Boolean).join(" - ");
  const cidade = [limpa(l.municipio), limpa(l.uf).toUpperCase()].filter(Boolean).join("/");
  const cep = limpa(l.cep);
  // Sem rua nem bairro não é endereço — só a cidade não ajuda o candidato.
  if (!ruaComp && !limpa(l.bairro)) return "";
  return [ruaComp, limpa(l.bairro), cidade, cep ? `CEP ${cep}` : ""].filter(Boolean).join(", ");
}

/**
 * Endereço do posto pra preencher a vaga.
 * - nenhum local com endereço → `endereco: ""` (quem pede digita);
 * - um endereço (ou vários locais com o mesmo) → esse;
 * - endereços diferentes → `endereco: ""` e a lista em `opcoes`: a planilha
 *   não diz em qual local a pessoa vai trabalhar, quem pede escolhe/digita.
 */
export function enderecoDoPosto(posto: PostoPlanilha | null | undefined): { endereco: string; opcoes: string[] } {
  const vistos = new Map<string, string>();
  for (const l of posto?.locais ?? []) {
    const e = formatarLocal(l);
    if (e) vistos.set(e.toUpperCase(), e);
  }
  const opcoes = [...vistos.values()];
  return { endereco: opcoes.length === 1 ? opcoes[0] : "", opcoes };
}

/**
 * O que fica no "Endereço efetivo" quando chega o endereço do posto.
 * `auto` é o que a tela preencheu sozinha da última vez: só esse texto é
 * trocado/apagado — o que a pessoa digitou nunca é sobrescrito.
 */
export function proximoEndereco(atual: string, auto: string, doPosto: string): { valor: string; auto: string } {
  const a = atual.trim();
  const ehAuto = !!auto && a === auto.trim();
  if (doPosto && (!a || ehAuto)) return { valor: doPosto, auto: doPosto };
  if (!doPosto && ehAuto) return { valor: "", auto: "" };
  return { valor: atual, auto: ehAuto ? auto : "" };
}

/** Aviso embaixo do endereço, conforme o que a planilha tem do posto. */
export function avisoEnderecoPosto(e: { posto_id: string; endereco: string; opcoes: string[] } | null, atual: string): string {
  if (!e?.posto_id) return "";
  if (e.endereco) return atual.trim() === e.endereco ? "Endereço puxado do posto na Planilha de Custo — confira." : "";
  if (e.opcoes.length > 1) return `Esse posto tem ${e.opcoes.length} locais na Planilha de Custo (${e.opcoes.join("; ")}). Digite em qual a pessoa vai trabalhar.`;
  return "Esse posto ainda não tem endereço na Planilha de Custo — digite o endereço.";
}

/** O posto da planilha que espelha o posto escolhido na vaga. */
export function postoPlanilhaDe(planilha: PostoPlanilha[] | null, postoId: string | null | undefined): PostoPlanilha | null {
  if (!planilha || !postoId) return null;
  return planilha.find(p => p.sup_posto_id === postoId) ?? null;
}
