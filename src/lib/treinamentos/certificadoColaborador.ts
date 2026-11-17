// =====================================================================
// TREINAMENTOS — certificado com a assinatura do COLABORADOR (13/11/2026)
//
// Pedido do chamado: "ao término do treinamento em vídeo, o colaborador
// também realize sua assinatura, para que ela seja inserida
// automaticamente no certificado emitido. O certificado deverá apresentar
// a assinatura da Técnica responsável e a do colaborador". E do Pablo:
// "quando o colaborador clicar pra emitir o certificado, primeiro ele
// deve assinar ... pode ser por nome ou desenho".
//
// Regras (as mesmas no banco — col_assinar_certificado e col_certificado,
// mig 20261115000200; mudar nos dois lugares):
//   · sem a assinatura do colaborador o certificado NÃO abre: a RPC devolve
//     só { pendente_assinatura: true } e a tela pede a assinatura antes;
//   · a assinatura é uma CÓPIA gravada no próprio certificado (como a da
//     técnica, mig 20261005000003): trocar a assinatura depois não mexe no
//     que já foi emitido, e assinar de novo o mesmo certificado não troca;
//   · já assinou outro certificado? A última assinatura vem PREENCHIDA e
//     basta confirmar — mas o clique de assinar é por certificado. Decisão
//     registrada: assinatura é consentimento daquele documento, então não
//     se aplica sozinha; reaproveitar só evita redesenhar toda vez.
//
// Modelo por empresa (pptx "Certificado Nascimento" e "Certificado SN",
// enviados pelo Pablo em 13/11/2026 como "os certificados padrões dos
// cursos"): SN usa a arte da SN; HAGG — e NH/CANAÃ, que não têm arte
// própria — usam a da Nascimento. A empresa é a do colaborador NA EMISSÃO
// (gravada em TRN_CERTIFICADO.empresa pelo gatilho), não a de hoje.
//
// NH ganhou arte própria em 16/11/2026 (pptx "Certificado_NH", pedido do
// Pablo: "pra quem é da empresa NH tem que ser esse certificado"). Mesmo
// layout das outras duas — só o fundo muda. Régua igual à rh_empresa():
// código 5 = NH. CANAÃ segue com a da Nascimento.
// =====================================================================

export type ArteEmpresa = "nascimento" | "sn" | "nh";

/** Sigla (HAGG, SN, NH, CANAÃ) ou código da Senior (1, 2, 3, 5) → arte do certificado. */
export function arteDaEmpresa(empresa: string | number | null | undefined): ArteEmpresa {
  const e = String(empresa ?? "").trim().toUpperCase();
  if (e === "SN" || e === "2") return "sn";
  if (e === "NH" || e === "5") return "nh";
  return "nascimento";
}

export interface AssinaturaColaborador {
  tipo: "desenho" | "texto";
  imagem?: string | null;
  texto?: string | null;
  fonte?: string | null;
  tamanho?: number | null;
}

/** Mesmos limites do CHECK da TRN_ASSINATURA (desenho em PNG até ~400 kB, letra 0,6–1,4). */
export const LIMITE_IMAGEM = 400_000;
export const TAMANHO_MIN = 0.6, TAMANHO_MAX = 1.4;

/** O que falta para poder assinar; null = pode. */
export function problemaAssinaturaColaborador(a: Partial<AssinaturaColaborador> | null | undefined): string | null {
  if (!a || (a.tipo !== "desenho" && a.tipo !== "texto")) return "Escolha desenhar ou escrever a sua assinatura.";
  if (a.tipo === "desenho") {
    if (!a.imagem?.startsWith("data:image/png;base64,")) return "Desenhe a sua assinatura no quadro.";
    if (a.imagem.length > LIMITE_IMAGEM) return "A assinatura ficou grande demais — limpe e desenhe de novo.";
    return null;
  }
  const texto = (a.texto ?? "").trim();
  if (texto.length < 2) return "Escreva o seu nome para assinar.";
  if (texto.length > 80) return "A assinatura escrita pode ter no máximo 80 letras.";
  if (!(a.fonte ?? "").trim()) return "Escolha a letra da assinatura.";
  const t = a.tamanho == null ? 1 : Number(a.tamanho);
  if (!(t >= TAMANHO_MIN && t <= TAMANHO_MAX)) return "Tamanho da letra fora do permitido.";
  return null;
}

/** O que vai para o banco: só os campos do tipo escolhido. */
export function payloadAssinatura(a: AssinaturaColaborador): AssinaturaColaborador {
  return a.tipo === "desenho"
    ? { tipo: "desenho", imagem: a.imagem ?? null }
    : { tipo: "texto", texto: (a.texto ?? "").trim(), fonte: a.fonte ?? null, tamanho: a.tamanho ?? 1 };
}

/**
 * Rascunho com que a etapa de assinatura abre: a última assinatura que a
 * pessoa usou (se a tiver e ainda for válida) ou o nome dela escrito na
 * primeira letra cursiva.
 */
export function rascunhoInicial(ultima: AssinaturaColaborador | null | undefined, nome: string, fontePadrao: string): AssinaturaColaborador {
  if (ultima && !problemaAssinaturaColaborador(ultima)) return { ...ultima };
  return { tipo: "texto", texto: nomeParaAssinar(nome), fonte: fontePadrao, tamanho: 1 };
}

const LIGACOES = new Set(["da", "de", "do", "das", "dos", "e"]);
/**
 * O cadastro vem em MAIÚSCULAS ("MARIA DA SILVA") e letra cursiva em caixa
 * alta fica ilegível: a sugestão sai "Maria da Silva". A pessoa pode editar.
 */
export function nomeParaAssinar(nome: string): string {
  return nome.trim().toLocaleLowerCase("pt-BR").split(/\s+/).filter(Boolean)
    .map((p, i) => (i > 0 && LIGACOES.has(p) ? p : p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1)))
    .join(" ");
}

/** O certificado só abre (e imprime) com a assinatura do colaborador gravada. */
export const certificadoLiberado = (c: { assinatura_aluno?: unknown; pendente_assinatura?: boolean } | null | undefined) =>
  !!c && !c.pendente_assinatura && !!c.assinatura_aluno;
