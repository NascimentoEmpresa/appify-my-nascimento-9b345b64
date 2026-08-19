// Painel Gerencial — as contas. Funções puras: entram respostas e perguntas,
// sai número ou série. Nada aqui conhece React, o que deixa cada indicador
// conferível de fora da tela (e é o que a aba "Indicadores e Cálculos"
// descreve em português).
import { Pergunta } from "../Formularios";
import { ItemDist, Resp } from "./tipos";

// Converte a resposta de uma pergunta em nota 1..5.
// Escala: normaliza min..max. Opções: assume ordenadas da MELHOR para a PIOR
// (1ª opção = 5, última = 1) — é como os formulários de feedback são escritos.
export function nota(p: Pergunta, valor: string): number | null {
  if (!valor) return null;
  if (p.tipo === "escala") {
    const n = Number(valor); if (isNaN(n)) return null;
    const min = p.config?.min ?? 1, max = p.config?.max ?? 5;
    return max === min ? null : 1 + ((n - min) / (max - min)) * 4;
  }
  const i = p.opcoes.indexOf(valor);
  if (i < 0 || p.opcoes.length < 2) return null;
  return 5 - (i / (p.opcoes.length - 1)) * 4;
}
export const faixa = (n: number) => n >= 4 ? "destaque" : n >= 3 ? "atencao" : "critica";

// Nomes crus → lista de exibição: sem repetir, em ordem alfabética, marcando
// entre parênteses quem aparece em mais de uma resposta da mesma fatia.
export function listaQuem(nomes: string[]): string[] {
  const c = new Map<string, number>();
  nomes.forEach(n => { const k = (n ?? "").trim(); if (k) c.set(k, (c.get(k) ?? 0) + 1); });
  return [...c.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR")).map(([n, q]) => q > 1 ? `${n} (${q})` : n);
}

export function distrib(p: Pergunta | undefined, resps: Resp[], quemDa?: (r: Resp) => string): ItemDist[] {
  if (!p) return [];
  const cont: Record<string, number> = {};
  const quem: Record<string, string[]> = {};
  resps.forEach(r => {
    const v = r.itens[p.id]; if (v == null || v === "") return;
    const nome = quemDa ? quemDa(r) : "";
    (Array.isArray(v) ? v : [v]).forEach(x => {
      const k = String(x);
      cont[k] = (cont[k] || 0) + 1;
      if (nome) (quem[k] ??= []).push(nome);
    });
  });
  let chaves: string[];
  if (p.tipo === "escala") { chaves = []; for (let n = p.config?.min ?? 1; n <= (p.config?.max ?? 5); n++) chaves.push(String(n)); }
  else chaves = p.opcoes.length ? p.opcoes : Object.keys(cont);
  return chaves.map(k => ({ nome: k.length > 24 ? k.slice(0, 24) + "…" : k, completo: k, n: cont[k] || 0, quem: listaQuem(quem[k] ?? []) }));
}
export const trimestre = (iso: string) => { const d = new Date(iso); return `${Math.floor(d.getMonth() / 3) + 1}º Tri/${String(d.getFullYear()).slice(2)}`; };
export const respValor = (r: Resp, pid?: string) => { if (!pid) return ""; const v = r.itens[pid]; return v == null ? "" : String(Array.isArray(v) ? v[0] : v); };
// Resposta sem setor = respondente anônimo/sem vínculo E formulário sem pergunta
// de setor. Não é um setor real: aparece rotulada, mas fica fora dos rankings.
export const SEM_SETOR = "Sem setor";
export const setorDe = (r: Resp) => (r.setor ?? "").trim() || SEM_SETOR;

export function mediaNota(p: Pergunta | undefined, resps: Resp[]): number | null {
  if (!p) return null;
  const ns = resps.map(r => nota(p, respValor(r, p.id))).filter((x): x is number => x != null);
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
}

export function serieTrimestre(resps: Resp[], valor: (r: Resp) => number | null) {
  const porTri: Record<string, { soma: number; n: number; o: number }> = {};
  resps.forEach(r => {
    const v = valor(r); if (v == null) return;
    const t = trimestre(r.enviado_em);
    (porTri[t] ??= { soma: 0, n: 0, o: +new Date(r.enviado_em) }); porTri[t].soma += v; porTri[t].n++;
  });
  return Object.entries(porTri).map(([t, v]) => ({ tri: t, valor: +(v.soma / v.n).toFixed(2), _o: v.o }))
    .sort((a, b) => a._o - b._o).slice(-6);
}
export const deltaSerie = (s: { valor: number }[]) => s.length > 1 ? s[s.length - 1].valor - s[s.length - 2].valor : null;

// Agrupa por chave (líder, setor…) com média e evolução vs. trimestre anterior.
export function agrupaMedia(resps: Resp[], chave: (r: Resp) => string, valor: (r: Resp) => number | null) {
  const tot: Record<string, { soma: number; n: number }> = {};
  const tris: Record<string, Record<string, { soma: number; n: number; o: number }>> = {};
  resps.forEach(r => {
    const k = (chave(r) || "").trim(); if (!k) return;
    const v = valor(r); if (v == null) return;
    (tot[k] ??= { soma: 0, n: 0 }); tot[k].soma += v; tot[k].n++;
    const t = trimestre(r.enviado_em);
    ((tris[k] ??= {})[t] ??= { soma: 0, n: 0, o: +new Date(r.enviado_em) }); tris[k][t].soma += v; tris[k][t].n++;
  });
  return Object.entries(tot).map(([k, g]) => {
    const ts = Object.entries(tris[k] ?? {}).sort((a, b) => a[1].o - b[1].o);
    const ult = ts[ts.length - 1], ant = ts[ts.length - 2];
    const evol = ult && ant ? (ult[1].soma / ult[1].n) - (ant[1].soma / ant[1].n) : null;
    return { chave: k, media: g.soma / g.n, n: g.n, evol };
  }).sort((a, b) => b.media - a.media);
}

// % das respostas que marcaram a 1ª opção (ex.: "Sim" / "Concluída" / "No prazo").
export function pctPrimeiraOpcao(p: Pergunta | undefined, resps: Resp[]): number | null {
  if (!p || !p.opcoes.length) return null;
  const vals = resps.map(r => respValor(r, p.id)).filter(Boolean);
  return vals.length ? (vals.filter(v => v === p.opcoes[0]).length / vals.length) * 100 : null;
}
