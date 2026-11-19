// =====================================================================
// RESUMO DO PARECER DA PRESIDÊNCIA PARA O JURÍDICO (SIS-2026-0957)
//
// Quando a presidente aprova uma medida do parecer do Comitê de Ética e a
// encaminha ao Jurídico, ela manda junto um resumo do parecer dela, para o
// Jurídico redigir a advertência padrão (ou formalizar outra diretriz). A
// I.A ajuda a escrever esse resumo — Edge denuncia-parecer-ia, modo
// "encaminhamento" — a partir do dossiê do caso (o mesmo do parecer I.A),
// do Parecer Conclusivo enviado à Presidência e da medida aprovada.
//
// A I.A só devolve texto: a presidente revisa, edita e é ela quem grava
// (RPC cetica_medida_decidir). Nada daqui vai para log.
//
// SIGILO: o resumo sai da Presidência para o Jurídico. Por isso a regra é
// mais estreita que a do parecer I.A: só o fato apurado, a conduta e a
// medida — nada da identidade de quem denunciou, de testemunhas ou de
// quem mais foi ouvido, e nada de anexos sigilosos.
//
// Lógica pura, sem Deno nem React: a Edge usa o pedido e a conferência, e
// src/test/comite-etica-encaminhamento.test.ts testa as regras.
// =====================================================================

export const REGRAS_ENCAMINHAMENTO = `Regras adicionais deste pedido (resumo para o Jurídico):
- O texto sai da Presidência para o Jurídico, que vai redigir a advertência padrão (ou formalizar outra diretriz). Escreva só o que o Jurídico precisa para isso.
- NUNCA identifique, nem indiretamente, quem denunciou, as testemunhas ou outras pessoas ouvidas. Não cite o relato literal, mensagens trocadas nem anexos.
- Cite o colaborador e o contrato só se constarem no dossiê ou na medida informada.
- Não invente fatos, datas nem enquadramentos legais; onde faltar dado, escreva "[a confirmar]".
- Sem Markdown: texto simples, títulos em CAIXA ALTA, uma linha cada.`;

export interface PedidoEncaminhamento {
  medidaRotulo: string;
  colaborador?: string | null;
  contrato?: string | null;
  /** Parecer Conclusivo enviado à Presidência (o do ciclo). */
  parecer?: string | null;
  /** Observação da presidente sobre a decisão (opcional). */
  orientacao?: string | null;
}

export const LIMITES_ENCAMINHAMENTO = { min: 200, max: 4000, parecer: 12000, orientacao: 1500 } as const;

const corta = (t: string | null | undefined, n: number) => {
  const s = String(t ?? "").trim();
  return s.length > n ? `${s.slice(0, n)}… [cortado]` : s;
};

export function montarPedidoEncaminhamento(p: PedidoEncaminhamento): string {
  const parecer = corta(p.parecer, LIMITES_ENCAMINHAMENTO.parecer);
  const orient = corta(p.orientacao, LIMITES_ENCAMINHAMENTO.orientacao);
  return [
    `A Presidência APROVOU a medida "${p.medidaRotulo}" recomendada pelo Comitê e vai encaminhá-la ao Jurídico.`,
    `Colaborador: ${p.colaborador?.trim() || "não informado"}.`,
    `Contrato: ${p.contrato?.trim() || "não informado"}.`,
    parecer ? `\n=== PARECER CONCLUSIVO DO COMITÊ (o que a Presidência analisou) ===\n${parecer}\n=== FIM DO PARECER ===` : "",
    orient ? `\nObservação da Presidência sobre a decisão: ${orient}` : "",
    `\nRedija o RESUMO DO PARECER DA PRESIDÊNCIA PARA O JURÍDICO, com estas seções (títulos em CAIXA ALTA, uma por linha):
DENÚNCIA (o protocolo)
FATO APURADO (a conduta comprovada, objetiva, com data quando constar)
MEDIDA APROVADA PELA PRESIDÊNCIA (a medida e, quando houver, o colaborador e o contrato)
FUNDAMENTO (por que a Presidência aprovou, a partir do parecer — sem citar o denunciante)
ORIENTAÇÕES AO JURÍDICO (o que a advertência ou a diretriz precisa conter)
No máximo uns 300 palavras.`,
  ].filter(Boolean).join("\n");
}

/** Limpa Markdown que escapar e confere o tamanho. */
export function conferirEncaminhamento(texto: string): { ok: true; texto: string } | { ok: false; erro: string } {
  const limpo = String(texto ?? "")
    .replace(/^```[a-z]*\s*\n?/i, "").replace(/\n?```\s*$/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
  if (limpo.length < LIMITES_ENCAMINHAMENTO.min) {
    return { ok: false, erro: `O resumo saiu curto demais (${limpo.length} caracteres). Escreva todas as seções.` };
  }
  if (!/MEDIDA APROVADA/i.test(limpo)) {
    return { ok: false, erro: "Falta a seção MEDIDA APROVADA PELA PRESIDÊNCIA. Reescreva com todas as seções." };
  }
  if (limpo.length > LIMITES_ENCAMINHAMENTO.max) {
    return { ok: true, texto: `${limpo.slice(0, LIMITES_ENCAMINHAMENTO.max)}\n[resumo cortado no limite]` };
  }
  return { ok: true, texto: limpo };
}
