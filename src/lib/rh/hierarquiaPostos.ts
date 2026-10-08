// =====================================================================
// RH › HIERARQUIA DE POSTOS (mig 20261007000024, 07/10/2026)
//
// Réplica da hierarquia de postos da Senior (estrutura 003 "Hagg 2026",
// hierarquia 002 "Hierarquia de Ponto", revisão 001). A RPC rh_hier_painel
// manda os postos (com o pai), os colaboradores ativos (com o posto que a
// Senior dá a cada um) e os contratos; aqui vira a árvore, os líderes, os
// contratos de cada ramo e as pendências (postos fora da hierarquia,
// colaborador sem posto, posto sem ninguém, posto acima das vagas).
//
// LÍDER = posto que tem postos abaixo dele. Quem ocupa um posto de líder
// "responde" por todo o ramo — é isso que vai dar acesso a contrato e ponto.
//
// 08/10/2026 (mig 20261008000005): a hierarquia virou editável. Trocar quem
// está num posto grava um AJUSTE do ERP (RH_POSTO_OCUPANTE_ERP) — o posto
// que chega aqui já é o efetivo, e `ajustado`/`postoSenior` dizem quando
// difere da Senior. O RESPONSÁVEL de cada contrato (quem dá o OK do ponto)
// vem pronto do banco em `responsaveis` — a mesma conta que trava as RPCs
// do ponto, para a tela nunca mostrar um responsável que o banco não aceita.
// =====================================================================

/** [codigo, descricao, titulo, empresa, filial, cargo_cod, vagas, pai, ordem, na_hierarquia, origem] */
export type PostoBruto = [string, string, string | null, number | null, number | null, string | null, number | null, string | null, number, boolean, string | null];
/** [id, nome, cadastro, cargo, situação, posto, tem_login, empresa, filial, nome do posto, ajustado no ERP?, posto da Senior?] */
export type OcupanteBruto = [number, string, number | null, string | null, string | null, string | null, boolean, number | null, number | null, string | null, boolean?, (string | null)?];
/** [empresa, filial, nome, ativo] */
export type ContratoBruto = [number, number, string | null, boolean];
/** [empresa, filial, posto_lider, empregado_id] */
export type ResponsavelBruto = [number, number, string, number];

export interface HistoricoHierarquia {
  id: number; posto_codigo: string; pai_antes: string | null; pai_depois: string | null; motivo: string | null; autor_nome: string | null; created_at: string;
  /** 'posto' (mudou o lugar do posto) | 'ocupante' (trocou a pessoa) | 'vagas'. Ausente = 'posto' (antes da mig 20261008000005). */
  tipo?: "posto" | "ocupante" | "vagas"; empregado_id?: number | null; empregado_nome?: string | null; valor_antes?: string | null; valor_depois?: string | null;
}

export interface PainelHierarquiaBruto {
  postos: PostoBruto[]; ocupantes: OcupanteBruto[]; contratos: ContratoBruto[];
  responsaveis?: ResponsavelBruto[];
  historico: HistoricoHierarquia[]; pode_alterar: boolean;
}

export interface Ocupante {
  id: number; nome: string; cadastro: number | null; cargo: string | null; situacao: string | null;
  posto: string | null; temLogin: boolean; empresa: number | null; filial: number | null; nomePosto: string | null;
  /** O posto foi trocado no ERP (difere do que a Senior diz). */
  ajustado: boolean;
  /** O posto que a Senior dá (igual a `posto` quando não há ajuste). */
  postoSenior: string | null;
}

/** Quem dá o OK do ponto de um contrato: o ocupante de um posto líder. */
export interface Responsavel { posto: string; ocupante: Ocupante }

export interface NoPosto {
  codigo: string; descricao: string; titulo: string; empresa: number | null; filial: number | null; cargoCod: string | null;
  vagas: number | null; pai: string | null; ordem: number; naHierarquia: boolean; origem: string | null;
  contrato: string | null;
  ocupantes: Ocupante[];
  filhos: NoPosto[];
  nivel: number;
  /** Totais do ramo (o próprio posto + tudo abaixo). */
  ramo: { postos: number; colaboradores: number; vagas: number; contratos: string[] };
}

export interface Hierarquia {
  raizes: NoPosto[];
  porCodigo: Map<string, NoPosto>;
  fora: NoPosto[];               // postos fora da hierarquia
  semPosto: Ocupante[];          // ativos sem posto da estrutura
  ocupantes: Ocupante[];
  contratos: Map<string, string>;
  /** Chaves (empresa-filial) dos contratos ativos no cadastro. */
  contratosAtivos: Set<string>;
  /** Por contrato (empresa-filial): quem responde por ele no ponto. */
  responsaveis: Map<string, Responsavel[]>;
  historico: HistoricoHierarquia[];
  podeAlterar: boolean;
}

export const chaveContrato = (empresa: number | null | undefined, filial: number | null | undefined) => `${empresa ?? "?"}-${filial ?? "?"}`;

/** "01-1099-0071-0061-06-RECEPCIONISTA-A 30H 5X2" → partes. */
export function partesDoPosto(descricao: string) {
  const p = descricao.split("-");
  const num = (s: string | undefined) => (s && /^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
  return { empresa: num(p[0]), filial: num(p[1]), local: p[2]?.trim() ?? null, cargo: p[3]?.trim() ?? null, sindicato: p[4]?.trim() ?? null, titulo: p.slice(5).join("-").trim() || descricao };
}

/** Posto de liderança pelo título (para destacar mesmo sem filhos, ex.: "SUPERVISOR" fora da árvore). */
export const tituloDeLideranca = (titulo: string) => /SUPERVIS|ENCARREG|L[IÍ]DER|COORDENA|GERENTE|ANALISTA DE CONTRATO|ANALISTA OPERACIONAL/i.test(titulo);

export function montarHierarquia(b: PainelHierarquiaBruto): Hierarquia {
  const contratos = new Map(b.contratos.map(([e, f, n]) => [chaveContrato(e, f), n ?? `Filial ${f}`]));
  const contratosAtivos = new Set(b.contratos.filter(([, , , ativo]) => ativo).map(([e, f]) => chaveContrato(e, f)));
  const ocupantes: Ocupante[] = b.ocupantes.map(([id, nome, cadastro, cargo, situacao, posto, temLogin, empresa, filial, nomePosto, ajustado, postoSenior]) => ({
    id, nome, cadastro, cargo, situacao, posto, temLogin, empresa, filial, nomePosto,
    ajustado: !!ajustado, postoSenior: postoSenior === undefined ? posto : postoSenior,
  }));
  const porId = new Map(ocupantes.map((o) => [o.id, o]));
  const responsaveis = new Map<string, Responsavel[]>();
  for (const [e, f, posto, empregadoId] of b.responsaveis ?? []) {
    const o = porId.get(empregadoId);
    if (!o) continue;
    const k = chaveContrato(e, f);
    responsaveis.set(k, [...(responsaveis.get(k) ?? []), { posto, ocupante: o }]);
  }
  const porCodigo = new Map<string, NoPosto>();
  for (const [codigo, descricao, titulo, empresa, filial, cargoCod, vagas, pai, ordem, naHierarquia, origem] of b.postos) {
    porCodigo.set(codigo, {
      codigo, descricao, titulo: titulo || partesDoPosto(descricao).titulo, empresa, filial, cargoCod, vagas, pai, ordem, naHierarquia, origem,
      contrato: contratos.get(chaveContrato(empresa, filial)) ?? null,
      ocupantes: [], filhos: [], nivel: 0, ramo: { postos: 0, colaboradores: 0, vagas: 0, contratos: [] },
    });
  }
  const semPosto: Ocupante[] = [];
  for (const o of ocupantes) {
    const n = o.posto ? porCodigo.get(o.posto) : undefined;
    if (n) n.ocupantes.push(o); else semPosto.push(o);
  }
  const raizes: NoPosto[] = [];
  const fora: NoPosto[] = [];
  for (const n of porCodigo.values()) {
    if (!n.naHierarquia) { fora.push(n); continue; }
    const pai = n.pai ? porCodigo.get(n.pai) : undefined;
    if (pai) pai.filhos.push(n); else raizes.push(n);
  }
  const ordenar = (xs: NoPosto[]) => xs.sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo));
  const visitados = new Set<string>();
  const percorrer = (n: NoPosto, nivel: number): NoPosto["ramo"] => {
    visitados.add(n.codigo);
    n.nivel = nivel;
    ordenar(n.filhos);
    const contr = new Set<string>();
    if (n.contrato) contr.add(n.contrato);
    let postos = 1, colaboradores = n.ocupantes.length, vagas = n.vagas ?? 0;
    for (const f of n.filhos) {
      if (visitados.has(f.codigo)) continue;     // trava de ciclo
      const r = percorrer(f, nivel + 1);
      postos += r.postos; colaboradores += r.colaboradores; vagas += r.vagas;
      r.contratos.forEach((c) => contr.add(c));
    }
    n.ramo = { postos, colaboradores, vagas, contratos: [...contr].sort((a, b) => a.localeCompare(b, "pt-BR")) };
    return n.ramo;
  };
  ordenar(raizes).forEach((r) => percorrer(r, 0));
  fora.sort((a, b) => b.ocupantes.length - a.ocupantes.length || a.codigo.localeCompare(b.codigo));
  return {
    raizes, porCodigo, fora, semPosto, ocupantes, contratos, contratosAtivos, responsaveis,
    historico: b.historico ?? [], podeAlterar: !!b.pode_alterar,
  };
}

/** Os contratos (chave → nome) de que os ocupantes deste posto são responsáveis no ponto. */
export function contratosDoPosto(h: Hierarquia, codigo: string): { chave: string; nome: string }[] {
  const out: { chave: string; nome: string }[] = [];
  for (const [chave, rs] of h.responsaveis) {
    if (rs.some((r) => r.posto === codigo)) out.push({ chave, nome: h.contratos.get(chave) ?? chave });
  }
  return out.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Contratos ativos que ninguém responde no ponto (ninguém consegue dar o OK do encarregado). */
export function contratosSemResponsavel(h: Hierarquia): { chave: string; nome: string }[] {
  return [...h.contratosAtivos].filter((k) => !h.responsaveis.get(k)?.length)
    .map((chave) => ({ chave, nome: h.contratos.get(chave) ?? chave }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * Busca de colaborador para pôr num posto: por nome, cadastro ou cargo, sem
 * acento. Só seleciona — a pessoa vem da EMPREGADOS, nada é digitado.
 */
export function buscarOcupantes(h: Hierarquia, termo: string, limite = 30): Ocupante[] {
  const t = norm(termo.trim());
  if (t.length < 2) return [];
  const out: Ocupante[] = [];
  for (const o of h.ocupantes) {
    if (norm(`${o.nome} ${o.cadastro ?? ""} ${o.cargo ?? ""}`).includes(t)) out.push(o);
    if (out.length >= limite) break;
  }
  return out;
}

/** Do posto até a raiz: [raiz, ..., pai, posto]. */
export function caminho(h: Hierarquia, codigo: string): NoPosto[] {
  const out: NoPosto[] = [];
  const vistos = new Set<string>();
  let n = h.porCodigo.get(codigo);
  while (n && !vistos.has(n.codigo)) { out.unshift(n); vistos.add(n.codigo); n = n.pai && n.naHierarquia ? h.porCodigo.get(n.pai) : undefined; }
  return out;
}

/** Todos os postos abaixo (sem o próprio). */
export function descendentes(n: NoPosto): NoPosto[] {
  const out: NoPosto[] = [];
  const pilha = [...n.filhos];
  while (pilha.length) { const x = pilha.shift()!; out.push(x); pilha.push(...x.filhos); }
  return out;
}

export interface Lider {
  posto: NoPosto; ocupantes: Ocupante[]; postosAbaixo: number; colaboradoresAbaixo: number; contratos: string[]; chefe: NoPosto | null;
}

/** Postos com postos abaixo, do topo para baixo. */
export function lideres(h: Hierarquia): Lider[] {
  const out: Lider[] = [];
  const visitar = (n: NoPosto) => {
    if (n.filhos.length) {
      out.push({
        posto: n, ocupantes: n.ocupantes, postosAbaixo: n.ramo.postos - 1,
        colaboradoresAbaixo: n.ramo.colaboradores - n.ocupantes.length, contratos: n.ramo.contratos,
        chefe: n.pai ? h.porCodigo.get(n.pai) ?? null : null,
      });
    }
    n.filhos.forEach(visitar);
  };
  h.raizes.forEach(visitar);
  return out;
}

/**
 * Por contrato: postos e colaboradores na árvore, os líderes diretos dos
 * postos e — `responsaveis` — quem dá o OK do ponto, como o banco calcula.
 * Chave = empresa-filial (dois contratos podem ter o mesmo nome).
 */
export function responsaveisPorContrato(h: Hierarquia) {
  const m = new Map<string, { chave: string; contrato: string; postos: number; colaboradores: number; lideres: Map<string, NoPosto> }>();
  const visitar = (n: NoPosto, cadeia: NoPosto[]) => {
    if (n.contrato) {
      const chave = chaveContrato(n.empresa, n.filial);
      const e = m.get(chave) ?? { chave, contrato: n.contrato, postos: 0, colaboradores: 0, lideres: new Map() };
      e.postos++; e.colaboradores += n.ocupantes.length;
      const lider = [...cadeia].reverse().find((x) => x.filhos.length && x.codigo !== n.codigo) ?? null;
      if (lider) e.lideres.set(lider.codigo, lider);
      m.set(chave, e);
    }
    n.filhos.forEach((f) => visitar(f, [...cadeia, n]));
  };
  h.raizes.forEach((r) => visitar(r, []));
  return [...m.values()]
    .map((e) => ({ ...e, lideres: [...e.lideres.values()], responsaveis: h.responsaveis.get(e.chave) ?? [] }))
    .sort((a, b) => b.colaboradores - a.colaboradores);
}

export interface ResumoHierarquia {
  postos: number; naArvore: number; fora: number; lideres: number; niveis: number;
  ativos: number; ativosNaArvore: number; ativosFora: number; semPosto: number;
  postosVazios: number; postosAcimaDasVagas: number; lideresSemOcupante: number; contratos: number;
}

export function resumo(h: Hierarquia): ResumoHierarquia {
  const arv = [...h.porCodigo.values()].filter((n) => n.naHierarquia);
  const ls = lideres(h);
  return {
    postos: h.porCodigo.size, naArvore: arv.length, fora: h.fora.length, lideres: ls.length,
    niveis: arv.reduce((m, n) => Math.max(m, n.nivel + 1), 0),
    ativos: h.ocupantes.length,
    ativosNaArvore: arv.reduce((s, n) => s + n.ocupantes.length, 0),
    ativosFora: h.fora.reduce((s, n) => s + n.ocupantes.length, 0),
    semPosto: h.semPosto.length,
    postosVazios: arv.filter((n) => !n.ocupantes.length && (n.vagas ?? 0) > 0).length,
    postosAcimaDasVagas: arv.filter((n) => n.vagas != null && n.ocupantes.length > n.vagas).length,
    lideresSemOcupante: ls.filter((l) => !l.ocupantes.length).length,
    contratos: new Set(arv.map((n) => n.contrato).filter(Boolean)).size,
  };
}

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Códigos que batem com a busca + todos os ancestrais deles (para a árvore filtrada mostrar o caminho). */
export function filtrarArvore(h: Hierarquia, termo: string): { visiveis: Set<string>; achados: Set<string> } | null {
  const t = norm(termo.trim());
  if (!t) return null;
  const achados = new Set<string>();
  for (const n of h.porCodigo.values()) {
    if (!n.naHierarquia) continue;
    const alvo = norm(`${n.codigo} ${n.descricao} ${n.contrato ?? ""} ${n.ocupantes.map((o) => `${o.nome} ${o.cadastro ?? ""}`).join(" ")}`);
    if (alvo.includes(t)) achados.add(n.codigo);
  }
  const visiveis = new Set<string>();
  for (const c of achados) caminho(h, c).forEach((n) => visiveis.add(n.codigo));
  return { visiveis, achados };
}

/** Pode mover `posto` para baixo de `novoPai`? (não pode ir para baixo de si mesmo) */
export function podeMover(h: Hierarquia, posto: string, novoPai: string | null): boolean {
  if (!novoPai) return true;
  if (novoPai === posto) return false;
  const n = h.porCodigo.get(posto);
  return !!n && !descendentes(n).some((d) => d.codigo === novoPai);
}
