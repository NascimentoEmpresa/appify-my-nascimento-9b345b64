// =====================================================================
// DOCUMENTOS DA INVESTIGAÇÃO — regras puras (19/11/2026)
//
// Termo de Abertura e Parecer Conclusivo de cada procedimento, gravados em
// CANAL_DENUNCIA_DOCUMENTO (mig 20261120123000). Aqui fica só o que a tela
// decide sem banco: quem pode redigir (espelho da função
// canal_denuncia_documento_pode_redigir — quem recusa de verdade é a RLS),
// em que situação o documento está e como a minuta da I.A entra no editor.
// Testado em src/test/comite-etica-documentos.test.ts.
//
// A minuta da I.A NUNCA vira versão final sozinha: ela só preenche o editor.
// O relator salva (rascunho) e, num segundo clique, marca a versão final.
// =====================================================================

export type TipoDocumento = "termo_abertura" | "parecer_conclusivo";

export const TIPOS_DOCUMENTO: { id: TipoDocumento; rotulo: string; aba: string; desc: string }[] = [
  {
    id: "termo_abertura",
    rotulo: "Termo de Abertura do Procedimento Investigativo",
    aba: "Termo de Abertura",
    desc: "Formaliza o início da apuração e descreve os fatos a investigar.",
  },
  {
    id: "parecer_conclusivo",
    rotulo: "Parecer Conclusivo",
    aba: "Parecer Conclusivo",
    desc: "Registra a análise das informações reunidas e a conclusão do relator.",
  },
];

export interface DocumentoInvestigacao {
  id: string;
  denuncia_id: string;
  tipo: TipoDocumento;
  conteudo: string;
  versao: number;
  final: boolean;
  usou_minuta_ia: boolean;
  finalizado_em: string | null;
  finalizado_por_nome: string | null;
  atualizado_por_nome: string | null;
  updated_at: string;
}

/** Espelho da RLS: relator do caso, Presidência ou a capacidade própria. */
export function podeRedigirDocumento(p: {
  userId: string | null | undefined;
  relatorId: string | null | undefined;
  presidencia: boolean;
  capacidadeDocumentos: boolean;
}): boolean {
  if (!p.userId) return false;
  return (!!p.relatorId && p.relatorId === p.userId) || p.presidencia || p.capacidadeDocumentos;
}

export type SituacaoDocumento = "vazio" | "rascunho" | "final" | "alterado";

/** O que o selo da aba mostra. "alterado" = há texto no editor ainda não salvo. */
export function situacaoDocumento(doc: Pick<DocumentoInvestigacao, "conteudo" | "final"> | null, rascunho: string): SituacaoDocumento {
  const salvo = doc?.conteudo ?? "";
  if (rascunho !== salvo) return "alterado";
  if (!salvo.trim()) return "vazio";
  return doc?.final ? "final" : "rascunho";
}

export const ROTULO_SITUACAO_DOC: Record<SituacaoDocumento, string> = {
  vazio: "Não iniciado",
  rascunho: "Rascunho salvo",
  final: "Versão final",
  alterado: "Alterações não salvas",
};

/** Versão final só com texto salvo e sem alteração pendente no editor. */
export function podeMarcarFinal(doc: Pick<DocumentoInvestigacao, "conteudo" | "final"> | null, rascunho: string): boolean {
  return !!doc && !doc.final && !!doc.conteudo.trim() && rascunho === doc.conteudo;
}

/**
 * Leva a minuta da I.A para o editor. "substituir" troca o texto;
 * "acrescentar" junta ao fim (é o caso do roteiro de entrevistas, que vai
 * como anexo do termo). Nunca grava: só devolve o novo texto do editor.
 */
export function aplicarMinuta(atual: string, minuta: string, modo: "substituir" | "acrescentar"): string {
  const m = minuta.trim();
  if (modo === "substituir" || !atual.trim()) return m;
  return `${atual.trimEnd()}\n\n${m}`;
}
