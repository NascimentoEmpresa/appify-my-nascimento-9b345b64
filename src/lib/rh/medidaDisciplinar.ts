// =====================================================================
// MEDIDA DISCIPLINAR (22/09/2026) — o que era "Solicitar Advertência".
//
// A tela agora começa perguntando QUAL medida, e o tipo fica travado nela:
//   • verbal       → REGISTRO, não pedido: entra direto no histórico do
//                    colaborador (status "Registrada"), sem aprovação.
//   • escrita / suspensão / justa causa → solicitação como sempre foi
//                    (Aguardando Aprovação → Jurídico).
//
// Antes de pedir escrita/suspensão/justa causa, a tela verifica se existe
// verbal registrada para aquele colaborador: é a "escadinha" que o Jurídico
// cobra. Sem verbal, não barra — pergunta (Sim / Não / Registrar verbal).
//
// Tudo mora na mesma tabela (SISTEMA_SOLICITACOES_ADVERTENCIA); aqui ficam
// só as regras puras, pra tela e teste usarem a mesma verdade.
// =====================================================================

export type MedidaDisciplinar = "verbal" | "escrita" | "suspensao" | "justa_causa";

export interface OpcaoMedida {
  chave: MedidaDisciplinar;
  titulo: string;
  descricao: string;
  /** O que vai em tipo_advertencia (o valor que o Jurídico já lê hoje). */
  tipoGravado: string;
  icone: string;
  /** Registro direto no histórico (não passa por aprovação). */
  registro: boolean;
}

export const MEDIDAS: OpcaoMedida[] = [
  {
    chave: "verbal", titulo: "Registrar advertência verbal", icone: "🗣️", tipoGravado: "Verbal", registro: true,
    descricao: "Registra no histórico do colaborador a conversa já feita. Não precisa de aprovação e serve de base para uma advertência escrita depois.",
  },
  {
    chave: "escrita", titulo: "Solicitar advertência escrita", icone: "📄", tipoGravado: "Escrita", registro: false,
    descricao: "Vai para aprovação e depois para o parecer do Jurídico, que emite o documento.",
  },
  {
    chave: "suspensao", titulo: "Solicitar suspensão", icone: "⏸️", tipoGravado: "Suspensão", registro: false,
    descricao: "Afastamento disciplinar por dias. Passa por aprovação e pelo Jurídico.",
  },
  {
    chave: "justa_causa", titulo: "Solicitar justa causa", icone: "⛔", tipoGravado: "Justa Causa", registro: false,
    descricao: "Desligamento por falta grave. Exige histórico bem descrito e é analisado pelo Jurídico.",
  },
];

export const medidaPor = (chave: MedidaDisciplinar | "") => MEDIDAS.find((m) => m.chave === chave) ?? null;

/** Status gravado: verbal é registro pronto; o resto entra na fila. */
export const statusDaMedida = (chave: MedidaDisciplinar) => (medidaPor(chave)?.registro ? "Registrada" : "Aguardando Aprovação");

/** Registro (verbal) não pergunta nada sobre verbal anterior — ele É a verbal. */
export const exigeChecarVerbal = (chave: MedidaDisciplinar | "") => !!chave && !medidaPor(chave)?.registro;

export interface DadosMedida {
  colaborador_id: number | null;
  data_ocorrido: string;
  descricao_ocorrido: string;
  grau?: string;
}

export const MIN_DESCRICAO = 50;

/**
 * Erro que impede gravar, ou null. A verbal não pede grau (não há punição a
 * graduar, é registro do fato); as demais continuam pedindo.
 */
export function erroDaMedida(chave: MedidaDisciplinar | "", d: DadosMedida): string | null {
  const medida = medidaPor(chave);
  if (!medida) return "Escolha a medida disciplinar.";
  if (!d.colaborador_id) return "Selecione o colaborador.";
  if (!d.data_ocorrido) return "Informe a data do ocorrido.";
  if (!medida.registro && !d.grau) return "Selecione o grau da advertência.";
  if (d.descricao_ocorrido.trim().length < MIN_DESCRICAO) {
    return `Descreva o ocorrido com pelo menos ${MIN_DESCRICAO} caracteres.`;
  }
  return null;
}

/** Data do ocorrido no futuro não existe; a tela também limita o input. */
export const dataNoFuturo = (data: string, hoje = new Date()): boolean => {
  if (!data) return false;
  const d = new Date(`${data}T00:00:00`);
  const h = new Date(hoje); h.setHours(0, 0, 0, 0);
  return d > h;
};

export interface VerbaisDoColaborador {
  total: number;
  lista: { id: number; data_ocorrido: string | null; created_at: string; solicitante_nome: string | null; minha?: boolean; descricao_ocorrido?: string | null }[];
}

/** Precisa perguntar "não tem verbal, quer mesmo assim?" */
export const perguntarSemVerbal = (chave: MedidaDisciplinar | "", verbais: VerbaisDoColaborador | null) =>
  exigeChecarVerbal(chave) && !!verbais && verbais.total === 0;
