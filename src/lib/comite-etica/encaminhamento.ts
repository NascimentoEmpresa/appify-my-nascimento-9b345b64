// =====================================================================
// COMITÊ DE ÉTICA → PRESIDÊNCIA → JURÍDICO → SUPERVISOR (SIS-2026-0957)
//
// Vocabulário e regras que as quatro pontas do fluxo precisam ler igual:
// a ficha do Comitê, a da Presidência, o card "Recebidos da presidência"
// do Jurídico e o card "Recebido do jurídico" do supervisor do contrato.
//
// Quem grava é o banco (RPCs cetica_* na migration
// 20261121150000_sis_2026_0957_comite_etica_presidencia_juridico_supervisor);
// os `value` daqui são os mesmos dos CHECKs de lá — mudar um lado obriga o
// outro. Testes em src/test/comite-etica-encaminhamento.test.ts.
// =====================================================================

export type SituacaoCiclo = "aguardando_presidencia" | "devolvido" | "decidido" | "cancelado";
export type SituacaoMedida = "pendente" | "aprovada" | "desaprovada";
export type SituacaoItem = "aguardando_aplicacao" | "aplicada";
export type Etapa = "comite" | "presidencia" | "juridico" | "supervisor";

export const SITUACAO_CICLO: Record<SituacaoCiclo, string> = {
  aguardando_presidencia: "Aguardando a Presidência",
  devolvido: "Devolvido ao Comitê",
  decidido: "Decidido",
  cancelado: "Retirado pelo Comitê",
};

export const SITUACAO_MEDIDA: Record<SituacaoMedida, string> = {
  pendente: "Aguardando decisão",
  aprovada: "Aprovada",
  desaprovada: "Desaprovada",
};

export const ETAPA: Record<Etapa, string> = {
  comite: "Comitê",
  presidencia: "Presidência",
  juridico: "Jurídico",
  supervisor: "Supervisor",
};

/** Bucket do documento do Jurídico e do comprovante do supervisor. */
export const BUCKET_MEDIDAS = "comite-etica-medidas";

export interface Ciclo {
  id: string;
  denuncia_id: string;
  ciclo: number;
  status: SituacaoCiclo;
  parecer_versao: number | null;
  medida_principal: string | null;
  origem: "automatico" | "manual";
  enviado_por_nome: string | null;
  enviado_em: string;
  encerrado_em: string | null;
}

export interface Medida {
  id: string;
  ciclo_id: string;
  denuncia_id: string;
  protocolo: string | null;
  medida: string;
  medida_rotulo: string;
  status: SituacaoMedida;
  decisao_texto: string | null;
  decidido_por_nome: string | null;
  decidido_em: string | null;
  resumo_juridico: string | null;
  resumo_usou_ia: boolean;
  colaborador_id: number | null;
  colaborador_nome: string | null;
  contrato_texto: string | null;
  advertencia_id: number | null;
  created_at: string;
}

/** O item no painel do supervisor — de propósito, sem nada da denúncia. */
export interface ItemSupervisor {
  id: string;
  medida_id: string;
  denuncia_id: string;
  protocolo: string | null;
  contrato_nome: string | null;
  supervisor_nome: string | null;
  colaborador_nome: string | null;
  medida_rotulo: string;
  aprovado_em: string | null;
  orientacoes: string;
  documento_path: string | null;
  documento_nome: string | null;
  encaminhado_por_nome: string | null;
  encaminhado_em: string;
  status: SituacaoItem;
  aplicada_em: string | null;
  aplicacao_obs: string | null;
  comprovante_path: string | null;
  comprovante_nome: string | null;
  registrado_por_nome: string | null;
  registrado_em: string | null;
}

export interface EventoFluxo {
  id: number;
  ciclo_id: string | null;
  medida_id: string | null;
  etapa: Etapa;
  evento: string;
  detalhe: string | null;
  usuario_nome: string | null;
  em: string;
}

// Colunas explícitas (nada de select("*")): o que cada tela lê.
export const COLS_CICLO = "id, denuncia_id, ciclo, status, parecer_versao, medida_principal, origem, enviado_por_nome, enviado_em, encerrado_em";
export const COLS_MEDIDA = "id, ciclo_id, denuncia_id, protocolo, medida, medida_rotulo, status, decisao_texto, decidido_por_nome, decidido_em, resumo_juridico, resumo_usou_ia, colaborador_id, colaborador_nome, contrato_texto, advertencia_id, created_at";
export const COLS_ITEM = "id, medida_id, denuncia_id, protocolo, contrato_nome, supervisor_nome, colaborador_nome, medida_rotulo, aprovado_em, orientacoes, documento_path, documento_nome, encaminhado_por_nome, encaminhado_em, status, aplicada_em, aplicacao_obs, comprovante_path, comprovante_nome, registrado_por_nome, registrado_em";
export const COLS_EVENTO = "id, ciclo_id, medida_id, etapa, evento, detalhe, usuario_nome, em";

/**
 * Onde a medida está agora, do ponto de vista de quem acompanha. É o que a
 * linha mostra no Comitê, na Presidência e no card do Jurídico.
 */
export function etapaDaMedida(m: Pick<Medida, "status" | "medida">, item?: Pick<ItemSupervisor, "status" | "aplicada_em"> | null):
  { rotulo: string; tom: "neutro" | "atencao" | "ok" | "erro" } {
  if (m.status === "pendente") return { rotulo: "Aguardando a Presidência", tom: "atencao" };
  if (m.status === "desaprovada") return { rotulo: "Desaprovada — devolvida ao Comitê", tom: "erro" };
  if (m.medida === "nenhuma") return { rotulo: "Parecer aprovado (sem medida)", tom: "ok" };
  if (!item) return { rotulo: "No Jurídico — aguardando formalização", tom: "atencao" };
  if (item.status === "aguardando_aplicacao") return { rotulo: "Com o supervisor — aguardando aplicação", tom: "atencao" };
  return { rotulo: `Aplicada em ${dataBr(item.aplicada_em)}`, tom: "ok" };
}

/** Cumprimento da denúncia: aplicadas / aprovadas que precisam de aplicação. */
export function cumprimento(medidas: Pick<Medida, "id" | "status" | "medida">[], itens: Pick<ItemSupervisor, "medida_id" | "status">[]) {
  const aplicar = medidas.filter((m) => m.status === "aprovada" && m.medida !== "nenhuma");
  const aplicadas = aplicar.filter((m) => itens.some((i) => i.medida_id === m.id && i.status === "aplicada")).length;
  return { total: aplicar.length, aplicadas, completo: aplicar.length > 0 && aplicadas === aplicar.length };
}

/** O ciclo que está com a Presidência agora (no máximo um, o banco garante). */
export const cicloAberto = (ciclos: Pick<Ciclo, "status">[]) => ciclos.find((c) => c.status === "aguardando_presidencia") ?? null;

/**
 * Comitê pode (re)enviar à Presidência: parecer em versão final, nenhum
 * ciclo aberto e denúncia não encerrada. O envio da primeira vez é sozinho
 * (ao finalizar o parecer); o botão cobre o reenvio e a falha do automático.
 */
export function podeEnviarParecer(a: { parecerFinal: boolean; ciclos: Pick<Ciclo, "status">[]; statusDenuncia: string }): boolean {
  return a.parecerFinal && !cicloAberto(a.ciclos) && !["concluida", "arquivada"].includes(a.statusDenuncia);
}

/** O que a presidente precisa preencher para cada comando. Erro em texto ou null. */
export function validarDecisao(a: { aprovar: boolean; medida: string; texto: string; resumo: string }): string | null {
  if (!a.aprovar) {
    return a.texto.trim() ? null : "Escreva a medida que propõe ou o aditivo à decisão.";
  }
  if (a.medida !== "nenhuma" && !a.resumo.trim()) return "Escreva o resumo do parecer para o Jurídico (pode gerar com a I.A).";
  return null;
}

/** Registrar aplicação: data obrigatória, nunca no futuro. */
export function validarAplicacao(data: string, hoje: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return "Informe a data da aplicação.";
  if (data > hoje) return "A data da aplicação não pode ser futura.";
  return null;
}

/** Caminho no bucket: <medida>/<pasta>/<carimbo>_<nome limpo>. É o que a RLS do storage confere. */
export function caminhoArquivo(medidaId: string, pasta: "documento" | "comprovante", nome: string, agora = Date.now()): string {
  const limpo = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").slice(-80) || "arquivo";
  return `${medidaId}/${pasta}/${agora}_${limpo}`;
}

/** Data de hoje no fuso da empresa, 'YYYY-MM-DD'. */
export const hojeSp = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

export function dataBr(s?: string | null): string {
  if (!s) return "—";
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(s);
  if (String(s).length <= 10) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return isNaN(+d) ? `${m[3]}/${m[2]}/${m[1]}` : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function dataHoraBr(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? String(s)
    : `${d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}`;
}
