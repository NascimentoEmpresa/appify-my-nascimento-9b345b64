// SIS-2026-0933 (18/11/2026) — CCT do posto AUTOMÁTICA pelo nome do sindicato.
//
// PEDIDO (Licitações): a CCT SEEAC/SINDASSEIO RS rege ~80% dos contratos e os
// postos apareciam "Sem CCT" na Planilha de Custo, mesmo com o campo SINDICATO
// do posto igual ao sindicato da convenção. Vincular posto a posto não escala:
// o posto passa a enxergar sozinho a CCT cujo sindicato tem o mesmo nome. Toda
// convenção nova é cadastrada com o nome que já consta nos postos.
//
// Prioridade (quem decide é a tela da Planilha de Custo):
//   1. convenção do CONTRATO (LIC_CONTRATO_CONVENCAO, mig 20261113100500);
//   2. vínculo manual do POSTO (LIC_POSTO_CONVENCAO, mig 20261027000930);
//   3. esta regra — automática pelo sindicato. Nada é gravado: uma CCT
//      cadastrada depois liga sozinha, e trocar o sindicato do posto troca a CCT.
//
// De propósito, SÓ a Planilha de Custo usa a regra (o solicitante pediu que
// nenhuma outra aba mude "por hora"). O resolvedor do banco
// (lic_referencia_do_posto_interno), que a Abertura de Vagas usa, segue só com
// contrato + vínculo manual — levar os benefícios da CCT automática para a vaga
// é outro chamado, e aí esta regra é a que tem de ir para o SQL.

/** O mínimo da convenção que a regra olha (linha de LIC_CONVENCAO_COLETIVA). */
export interface ConvencaoParaVinculo {
  id: string;
  tipo: "cct" | "decreto" | string;
  sindicato: string | null;
  categoria_profissional?: string | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  contrato_id?: string | null;
  situacao?: string | null;
  updated_at?: string | null;
}

/** O mínimo do posto (linha da planilha_custo). */
export interface PostoParaVinculo {
  sindicato: string | null;
  data_vigencia: string | null;
  contrato_id?: string | null;
  servico?: string | null;
}

export interface CctAutomatica<C extends ConvencaoParaVinculo = ConvencaoParaVinculo> {
  convencao: C;
  /** A data do posto cai fora do período da CCT escolhida (nenhuma cobre a data). */
  foraDaVigencia: boolean;
}

/**
 * Chave de comparação do nome: sem acento, maiúsculo, espaços repetidos
 * colapsados e sem espaço em volta de "/" e "-" — "seeac / sindasseio  rs" e
 * "SEEAC/SINDASSEIO RS" são o mesmo sindicato.
 */
export function chaveSindicato(nome: string | null | undefined): string {
  return String(nome ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/\s*([/-])\s*/g, "$1")
    .trim();
}

const dia = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(a, (m || 1) - 1, d || 1) / 86400000;
};

/** Dias entre a data e o período (0 = dentro). Sem data no posto, todas valem 0. */
function distancia(c: ConvencaoParaVinculo, data: string | null): number {
  if (!data) return 0;
  const d = dia(data);
  if (c.vigencia_inicio && d < dia(c.vigencia_inicio)) return dia(c.vigencia_inicio) - d;
  if (c.vigencia_fim && d > dia(c.vigencia_fim)) return d - dia(c.vigencia_fim);
  return 0;
}

/**
 * A CCT automática do posto, ou null (sindicato vazio ou sem CCT desse nome).
 *
 * Entre as CCTs (decreto não entra) com o mesmo sindicato, desempata nesta ordem:
 *   1. a que cobre a DATA DE VIGÊNCIA do posto; se nenhuma cobre, a de período
 *      mais próximo da data — e marca `foraDaVigencia` (a tela avisa em vez de
 *      mostrar "Sem CCT": o vínculo existe, falta a CCT do período);
 *   2. a amarrada ao mesmo contrato do posto > a sem contrato > a de outro
 *      contrato (CCT antiga, do tempo em que a convenção pedia contrato);
 *   3. categoria profissional igual ao SERVIÇO do posto (o posto não tem
 *      campo de categoria; o serviço é o que mais se aproxima);
 *   4. a de vigência mais recente (início maior);
 *   5. a completa antes da pendente;
 *   6. a atualizada por último.
 * Versão: a linha da convenção já é a versão atual (as antigas moram em
 * LIC_CONVENCAO_COLETIVA_VERSAO), então não há o que escolher.
 */
export function cctAutomaticaDoPosto<C extends ConvencaoParaVinculo>(
  posto: PostoParaVinculo,
  convencoes: readonly C[],
): CctAutomatica<C> | null {
  const chave = chaveSindicato(posto.sindicato);
  if (!chave) return null;
  const candidatas = convencoes.filter((c) => c.tipo === "cct" && chaveSindicato(c.sindicato) === chave);
  if (!candidatas.length) return null;

  const data = posto.data_vigencia ? posto.data_vigencia.slice(0, 10) : null;
  const servico = chaveSindicato(posto.servico);
  const afinidade = (c: C) => (c.contrato_id && posto.contrato_id && c.contrato_id === posto.contrato_id ? 0 : !c.contrato_id ? 1 : 2);
  const categoriaBate = (c: C) => (servico && chaveSindicato(c.categoria_profissional) === servico ? 0 : 1);

  const ordenadas = [...candidatas].sort((a, b) =>
    distancia(a, data) - distancia(b, data)
    || afinidade(a) - afinidade(b)
    || categoriaBate(a) - categoriaBate(b)
    || String(b.vigencia_inicio ?? "").localeCompare(String(a.vigencia_inicio ?? ""))
    || (a.situacao === "completo" ? 0 : 1) - (b.situacao === "completo" ? 0 : 1)
    || String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));

  const escolhida = ordenadas[0];
  return { convencao: escolhida, foraDaVigencia: distancia(escolhida, data) > 0 };
}
