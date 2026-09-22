// =====================================================================
// Tipo de processo e partes (SIS-2026-0488, 22/09/2026, mig 207).
//
// "Trabalhista" é o cadastro de sempre: reclamante × reclamada (a empresa).
// "Outros" (cível, cobrança, execução, contratual…) tem Autor × Réu, e a
// empresa do grupo pode estar em qualquer um dos lados — inclusive autora.
//
// Em "Outros" a tela grava também reclamante = autor e reclamada = réu, pra
// lista/filtros/agenda/exportação continuarem funcionando sem saber do tipo.
// Aqui ficam as regras puras (rótulos, lado da empresa, validação).
// =====================================================================

export type TipoProcesso = "trabalhista" | "outros";
export type TipoParte = "pf" | "pj" | "grupo";

export const ROTULO_TIPO_PROCESSO: Record<TipoProcesso, string> = {
  trabalhista: "Processo Trabalhista",
  outros: "Outros",
};
export const ROTULO_TIPO_PARTE: Record<TipoParte, string> = {
  pf: "Pessoa física",
  pj: "Pessoa jurídica",
  grupo: "Empresa do grupo",
};
/** Sugestões do campo "Natureza da ação" (texto livre — pode digitar outra). */
export const NATUREZAS_ACAO = [
  "Cível", "Cobrança", "Execução", "Execução fiscal", "Contratual", "Indenizatória",
  "Consumidor", "Tributária", "Administrativa", "Criminal", "Mandado de segurança", "Monitória",
];

export interface Parte { tipo: TipoParte | ""; nome: string; documento: string }
export const PARTE_VAZIA = (): Parte => ({ tipo: "", nome: "", documento: "" });

/** O que a tela precisa de um processo pra falar das partes. */
export interface ComPartes {
  tipo_processo?: string | null;
  reclamante?: string | null; reclamada?: string | null;
  autor_tipo?: string | null; autor_nome?: string | null;
  reu_tipo?: string | null; reu_nome?: string | null;
  natureza_acao?: string | null;
}

export const ehOutros = (p: ComPartes) => p.tipo_processo === "outros";

/** Rótulos e nomes das duas partes, na ordem em que a tela mostra. */
export function partes(p: ComPartes): { rotulo1: string; nome1: string; rotulo2: string; nome2: string } {
  if (ehOutros(p)) {
    return { rotulo1: "Autor", nome1: p.autor_nome || p.reclamante || "", rotulo2: "Réu", nome2: p.reu_nome || p.reclamada || "" };
  }
  return { rotulo1: "Reclamante", nome1: p.reclamante || "", rotulo2: "Reclamada", nome2: p.reclamada || "" };
}

/**
 * Onde a empresa do grupo está no processo. Trabalhista: sempre ré
 * (reclamada). Outros: pelo tipo das partes — as duas do grupo (ação entre
 * empresas do grupo) conta como autora.
 */
export function posicaoEmpresa(p: ComPartes): "autora" | "re" | "nenhuma" {
  if (!ehOutros(p)) return "re";
  if (p.autor_tipo === "grupo") return "autora";
  if (p.reu_tipo === "grupo") return "re";
  return "nenhuma";
}

/** A empresa do grupo envolvida (o "Por empresa" do dashboard agrupa por ela). */
export function empresaDoGrupo(p: ComPartes): string {
  if (!ehOutros(p)) return p.reclamada || "";
  if (p.autor_tipo === "grupo") return p.autor_nome || "";
  if (p.reu_tipo === "grupo") return p.reu_nome || "";
  return "";
}

/** Selo curto pra lista: "Cível · Empresa autora". */
export function seloOutros(p: ComPartes): string {
  const pos = posicaoEmpresa(p);
  const lado = pos === "autora" ? "Empresa autora" : pos === "re" ? "Empresa ré" : "";
  return [p.natureza_acao || "Outros", lado].filter(Boolean).join(" · ");
}

const digitos = (s: string) => s.replace(/\D/g, "");

/** CPF (11) ou CNPJ (14) formatado; outro tamanho volta como veio. */
export function formatarDocumento(s: string): string {
  const d = digitos(s);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return s.trim();
}

/** Erro das partes de um processo "Outros", ou null. */
export function erroDasPartes(autor: Parte, reu: Parte): string | null {
  for (const [rot, p] of [["Autor", autor], ["Réu", reu]] as const) {
    if (!p.tipo) return `Informe se o ${rot.toLowerCase()} é pessoa física, jurídica ou empresa do grupo.`;
    if (!p.nome.trim()) return p.tipo === "grupo" ? `Escolha a empresa do grupo (${rot.toLowerCase()}).` : `Informe o nome do ${rot.toLowerCase()}.`;
    const d = digitos(p.documento);
    if (d && p.tipo === "pf" && d.length !== 11) return `CPF do ${rot.toLowerCase()} deve ter 11 dígitos.`;
    if (d && p.tipo === "pj" && d.length !== 14) return `CNPJ do ${rot.toLowerCase()} deve ter 14 dígitos.`;
  }
  if (autor.tipo === "grupo" && reu.tipo === "grupo" && autor.nome === reu.nome) return "Autor e réu não podem ser a mesma empresa.";
  return null;
}
