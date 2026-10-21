// =====================================================================
// ORGANOGRAMA › ESTRUTURA DE SETORES E PROCESSOS (mig 20261020000060)
// Regras puras das duas telas (Organograma Geral e Cadastro da Estrutura).
// Com teste em src/test/organograma-estrutura-processos.test.ts.
// =====================================================================

export type TipoConexao = "fluxo" | "intersetorial" | "retorno" | "bloqueado" | "revisao";
export type StatusProcesso = "ativo" | "em_revisao" | "inativo";

export interface Unidade {
  id: string; codigo: string | null; tipo: "presidencia" | "diretoria"; nome: string; subtitulo: string | null;
  responsavel_nome: string | null; responsavel_cargo: string | null; empregado_id: number | null; user_id: string | null;
  parent_id: string | null; cor: string; ordem: number; avatar_url?: string | null;
}
export interface Setor {
  id: string; codigo: string | null; nome: string; unidade_id: string | null; icone: string; cor: string;
  descricao: string | null; ordem: number; ativo: boolean;
}
export interface Membro {
  id: string; setor_id: string; nome: string; cargo: string; nivel: number; parent_id: string | null; responsavel: boolean;
  atividades: string | null; empregado_id: number | null; user_id: string | null; ordem: number; avatar_url?: string | null;
}
export interface Macro { id: string; codigo: string | null; nome: string; cor: string; ordem: number }
export interface Processo {
  id: string; codigo: string; setor_id: string | null; unidade_id: string | null; nome: string; descricao: string | null;
  responsavel_membro_id: string | null; frequencia: string | null; entrada: string | null; saida: string | null;
  status: StatusProcesso; proximo_id: string | null; macro_id: string | null; principal: boolean;
  exibir_organograma: boolean; permite_intersetorial: boolean; bloquear_posicao: boolean;
  pos_x: number | null; pos_y: number | null; ordem: number;
}
export interface Conexao { id: string; origem_id: string; destino_id: string; tipo: TipoConexao; rotulo: string | null }
export interface Documento {
  id: string; processo_id: string; nome_arquivo: string | null; storage_path: string; mime_type: string | null;
  tamanho_bytes: number | null; enviado_por: string | null; created_at: string;
}
export interface Estrutura {
  unidades: Unidade[]; setores: Setor[]; membros: Membro[]; macros: Macro[]; processos: Processo[];
  conexoes: Conexao[]; documentos: Documento[];
  publicacao?: { versao: number; em: string; por: string | null } | null;
  rascunho?: boolean;
}

export const ESTRUTURA_VAZIA: Estrutura = { unidades: [], setores: [], membros: [], macros: [], processos: [], conexoes: [], documentos: [] };

export const NIVEIS = [
  { nivel: 1, rotulo: "Gerência" },
  { nivel: 2, rotulo: "Supervisão / Coordenação" },
  { nivel: 3, rotulo: "Analista / Especialista" },
  { nivel: 4, rotulo: "Assistente / Técnico" },
  { nivel: 5, rotulo: "Auxiliar / Estagiário" },
  { nivel: 6, rotulo: "Jovem Aprendiz" },
] as const;
export const rotuloNivel = (n: number) => NIVEIS.find((x) => x.nivel === n)?.rotulo ?? `Nível ${n}`;

export const ROTULO_CONEXAO: Record<TipoConexao, string> = {
  fluxo: "Fluxo principal", intersetorial: "Conexão intersetorial", retorno: "Retorno / Validação",
  bloqueado: "Bloqueado", revisao: "Em revisão",
};
export const ROTULO_STATUS: Record<StatusProcesso, string> = { ativo: "Ativo", em_revisao: "Em revisão", inativo: "Inativo" };
export const FREQUENCIAS = ["Diária", "Semanal", "Quinzenal", "Mensal", "Trimestral", "Anual", "Sob demanda"];

// ---- Consultas simples ------------------------------------------------------

export const processosDoSetor = (e: Estrutura, setorId: string) =>
  e.processos.filter((p) => p.setor_id === setorId).sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo));
export const equipeDoSetor = (e: Estrutura, setorId: string) =>
  e.membros.filter((m) => m.setor_id === setorId).sort((a, b) => a.nivel - b.nivel || a.ordem - b.ordem || a.nome.localeCompare(b.nome));
export const responsavelDoSetor = (e: Estrutura, setorId: string): Membro | null => {
  const eq = equipeDoSetor(e, setorId);
  return eq.find((m) => m.responsavel) ?? eq[0] ?? null;
};
export const setorDoProcesso = (e: Estrutura, p: Pick<Processo, "setor_id">) => e.setores.find((s) => s.id === p.setor_id) ?? null;

/** Processo é "intersetorial" quando liga dois setores diferentes. */
export function conexaoEntreSetores(e: Estrutura, c: Pick<Conexao, "origem_id" | "destino_id">): boolean {
  const o = e.processos.find((p) => p.id === c.origem_id);
  const d = e.processos.find((p) => p.id === c.destino_id);
  return !!o && !!d && o.setor_id !== d.setor_id;
}

export interface Indicadores { colaboradores: number; setores: number; processos: number; conexoes: number }
export function indicadores(e: Estrutura): Indicadores {
  return {
    colaboradores: e.membros.length,
    setores: e.setores.length,
    processos: e.processos.filter((p) => p.status !== "inativo").length,
    conexoes: e.conexoes.filter((c) => conexaoEntreSetores(e, c)).length,
  };
}

/** Os principais do setor para o card do organograma: os marcados, completando pela ordem. */
export function processosPrincipais(e: Estrutura, setorId: string, n = 4): Processo[] {
  const todos = processosDoSetor(e, setorId).filter((p) => p.exibir_organograma && p.status !== "inativo");
  const marcados = todos.filter((p) => p.principal);
  return [...marcados, ...todos.filter((p) => !p.principal)].slice(0, n);
}

/** A cadeia de fluxo do setor, seguindo "próxima etapa" a partir de quem não é próximo de ninguém. */
export function cadeiaDoSetor(processos: Processo[]): Processo[] {
  const ids = new Set(processos.map((p) => p.id));
  const alvo = new Set(processos.map((p) => p.proximo_id).filter((x): x is string => !!x && ids.has(x)));
  const ordenados = [...processos].sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo));
  const out: Processo[] = [];
  const vistos = new Set<string>();
  for (const ini of ordenados.filter((p) => !alvo.has(p.id))) {
    let cur: Processo | undefined = ini;
    while (cur && !vistos.has(cur.id)) {
      vistos.add(cur.id); out.push(cur);
      cur = cur.proximo_id ? processos.find((p) => p.id === cur!.proximo_id) : undefined;
    }
  }
  for (const p of ordenados) if (!vistos.has(p.id)) out.push(p);   // ciclos/órfãos
  return out;
}

/** Equipe em árvore (quem responde a quem), dentro do setor. */
export interface NoEquipe { membro: Membro; filhos: NoEquipe[] }
export function arvoreEquipe(membros: Membro[]): NoEquipe[] {
  const ids = new Set(membros.map((m) => m.id));
  const ord = [...membros].sort((a, b) => a.nivel - b.nivel || a.ordem - b.ordem || a.nome.localeCompare(b.nome));
  const no = (m: Membro): NoEquipe => ({ membro: m, filhos: ord.filter((f) => f.parent_id === m.id).map(no) });
  return ord.filter((m) => !m.parent_id || !ids.has(m.parent_id)).map(no);
}

/** Atividades (uma por linha) em lista limpa. */
export const listaAtividades = (t: string | null | undefined) =>
  String(t ?? "").split(/\r?\n/).map((l) => l.replace(/^[-•\s]+/, "").trim()).filter(Boolean);

/** Conexões de um processo com o que está do outro lado. */
export function conexoesDoProcesso(e: Estrutura, processoId: string) {
  const achar = (id: string) => e.processos.find((p) => p.id === id);
  return {
    entradas: e.conexoes.filter((c) => c.destino_id === processoId).map((c) => ({ c, p: achar(c.origem_id) })).filter((x) => x.p),
    saidas: e.conexoes.filter((c) => c.origem_id === processoId).map((c) => ({ c, p: achar(c.destino_id) })).filter((x) => x.p),
  };
}

/** Setores ligados a um setor (por qualquer conexão), com quantas ligações. */
export function setoresConectados(e: Estrutura, setorId: string): { setor: Setor; n: number; acima: boolean }[] {
  const meus = new Set(processosDoSetor(e, setorId).map((p) => p.id));
  const cont = new Map<string, { n: number; entra: number }>();
  for (const c of e.conexoes) {
    const o = e.processos.find((p) => p.id === c.origem_id);
    const d = e.processos.find((p) => p.id === c.destino_id);
    if (!o || !d) continue;
    let outro: string | null = null; let entra = false;
    if (meus.has(o.id) && d.setor_id && d.setor_id !== setorId) outro = d.setor_id;
    else if (meus.has(d.id) && o.setor_id && o.setor_id !== setorId) { outro = o.setor_id; entra = true; }
    if (!outro) continue;
    const x = cont.get(outro) ?? { n: 0, entra: 0 };
    x.n += 1; if (entra) x.entra += 1;
    cont.set(outro, x);
  }
  return [...cont.entries()]
    .map(([id, x]) => ({ setor: e.setores.find((s) => s.id === id)!, n: x.n, acima: x.entra >= x.n - x.entra }))
    .filter((x) => x.setor)
    .sort((a, b) => b.n - a.n || a.setor.ordem - b.setor.ordem);
}

// ---- Layout do canvas (Cadastro) ----------------------------------------------
//
// Setor escolhido no meio, com a cadeia de processos em linha; os setores
// que mandam algo para ele em cima, os que recebem embaixo (no máximo 4 em
// cada faixa — o resto vai para a faixa com menos). Coordenadas em px do
// canvas a 100%.

export const LAYOUT = {
  larguraSetor: 230, alturaSetorLateral: 160, larguraProcesso: 136, alturaProcesso: 80, gapProcesso: 36,
  topoLateral: 20, topoCentro: 210, margem: 20,
};

export interface LayoutCanvas {
  centro: { x: number; y: number; w: number; h: number };
  processos: Record<string, { x: number; y: number }>;
  laterais: { setor: Setor; x: number; y: number; posicao: "cima" | "baixo" }[];
  largura: number; altura: number;
}

/** salvas=true usa a posição gravada de cada processo; false reorganiza (menos os travados). */
export function autoOrganizar(e: Estrutura, setorId: string, salvas = true): LayoutCanvas {
  const L = LAYOUT;
  const cadeia = cadeiaDoSetor(processosDoSetor(e, setorId));
  const ligados = setoresConectados(e, setorId);
  const cima = ligados.filter((x) => x.acima);
  const baixo = ligados.filter((x) => !x.acima);
  // Equilibra as duas faixas (como na referência: metade em cima, metade embaixo).
  while (cima.length - baixo.length > 1) baixo.unshift(cima.pop()!);
  while (baixo.length - cima.length > 1) cima.push(baixo.shift()!);
  const porLinha = Math.max(1, Math.min(6, cadeia.length));
  const linhas = Math.max(1, Math.ceil(cadeia.length / porLinha));
  const larguraCentro = Math.max(4 * (L.larguraSetor + 30) - 30, porLinha * (L.larguraProcesso + L.gapProcesso) - L.gapProcesso + 2 * 24);
  const alturaCentro = 96 + linhas * (L.alturaProcesso + 26) + 10;
  const largura = larguraCentro + 2 * L.margem;
  const centro = { x: L.margem, y: L.topoCentro, w: larguraCentro, h: alturaCentro };

  const processos: Record<string, { x: number; y: number }> = {};
  cadeia.forEach((p, i) => {
    const lin = Math.floor(i / porLinha), col = i % porLinha;
    const auto = { x: centro.x + 24 + col * (L.larguraProcesso + L.gapProcesso), y: centro.y + 96 + lin * (L.alturaProcesso + 26) };
    // Posição salva no canvas vale sempre; com salvas=false ("Auto-organizar") só a travada fica onde está.
    const salva = p.pos_x != null && p.pos_y != null ? { x: Number(p.pos_x), y: Number(p.pos_y) } : null;
    processos[p.id] = salva && (salvas || p.bloquear_posicao) ? salva : auto;
  });

  const faixa = (lista: typeof ligados, y: number, posicao: "cima" | "baixo") => {
    const n = lista.length;
    const passo = n ? (larguraCentro - L.larguraSetor) / Math.max(1, n - 1) : 0;
    return lista.map((x, i) => ({
      setor: x.setor, posicao, y,
      x: L.margem + (n === 1 ? (larguraCentro - L.larguraSetor) / 2 : i * passo),
    }));
  };
  const yBaixo = centro.y + alturaCentro + 70;
  return {
    centro, processos,
    laterais: [...faixa(cima, L.topoLateral, "cima"), ...faixa(baixo, yBaixo, "baixo")],
    largura, altura: yBaixo + L.alturaSetorLateral + L.margem,
  };
}

// ---- Organograma Geral: filtros ------------------------------------------------

export interface FiltroGeral { busca: string; diretoria: string; setor: string; unidade: string }
export const FILTRO_GERAL_PADRAO: FiltroGeral = { busca: "", diretoria: "", setor: "", unidade: "" };

const norm = (s: string | null | undefined) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Setores que passam no filtro (a busca casa setor, pessoa da equipe ou processo). */
export function setoresFiltrados(e: Estrutura, f: FiltroGeral): Setor[] {
  const q = norm(f.busca).trim();
  return e.setores.filter((s) => {
    if (f.diretoria && s.unidade_id !== f.diretoria) return false;
    if (f.setor && s.id !== f.setor) return false;
    if (!q) return true;
    if (norm(s.nome).includes(q)) return true;
    if (equipeDoSetor(e, s.id).some((m) => norm(m.nome).includes(q) || norm(m.cargo).includes(q))) return true;
    return processosDoSetor(e, s.id).some((p) => norm(p.nome).includes(q) || norm(p.codigo).includes(q));
  });
}

/** Termo da busca bate neste texto? (para destacar processo/pessoa achada). */
export const casaBusca = (texto: string | null | undefined, busca: string) => !!busca.trim() && norm(texto).includes(norm(busca).trim());

/** "Yuri Rosa" → "YR". */
export function iniciais(nome: string | null | undefined): string {
  const p = String(nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return ((p[0][0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

/** Linhas CSV da estrutura (exportar). */
export function linhasCsv(e: Estrutura): string[][] {
  const nomeSetor = (id: string | null) => e.setores.find((s) => s.id === id)?.nome ?? "";
  const nomeMembro = (id: string | null) => e.membros.find((m) => m.id === id)?.nome ?? "";
  const cab = ["Código", "Processo", "Setor", "Responsável", "Frequência", "Entrada", "Saída", "Status", "Próxima etapa", "Conexões (saída)"];
  const linhas = [...e.processos].sort((a, b) => a.codigo.localeCompare(b.codigo)).map((p) => [
    p.codigo, p.nome, p.setor_id ? nomeSetor(p.setor_id) : "Presidência", nomeMembro(p.responsavel_membro_id), p.frequencia ?? "",
    p.entrada ?? "", p.saida ?? "", ROTULO_STATUS[p.status] ?? p.status,
    e.processos.find((x) => x.id === p.proximo_id)?.nome ?? "",
    e.conexoes.filter((c) => c.origem_id === p.id).map((c) => {
      const d = e.processos.find((x) => x.id === c.destino_id);
      return d ? `${d.codigo} ${d.nome} (${nomeSetor(d.setor_id)}; ${ROTULO_CONEXAO[c.tipo]})` : "";
    }).filter(Boolean).join(" | "),
  ]);
  return [cab, ...linhas];
}
