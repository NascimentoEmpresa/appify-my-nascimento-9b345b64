import { ehParcelaNumerada } from "./parcelas";

/**
 * Nome da despesa que o "Enviar ao Malote" leva pronto.
 *
 * Era "tipo — mês/ano" ("Luz — Novembro/2026"): a competência já tem campo
 * próprio no Malote, e o nome repetido não dizia QUAL luz — duas contas da
 * mesma categoria em imóveis diferentes chegavam lá com o mesmo nome. O
 * Jurídico pediu (03/11/2026) o identificador que a conta já tem, o mesmo que
 * a lista de "a vencer" mostra depois do tipo: "RGE - JOÃO PESSOA 172".
 *
 * Fonte: a `descricao` da obrigação. Não há coluna à parte de "nome no
 * Malote" de propósito — a descrição já é o nome da conta em todo lugar da
 * tela, e uma segunda coluna seria um segundo nome para divergir.
 *
 * Parcela de contrato: a descrição de cada linha termina em "· Parcela N/T"
 * (quem escreve é o banco, jur_parcelas_renumerar). Esse sufixo sai e o
 * número vira texto no padrão do Jurídico: "CASA SENILTON 91 DE 420 PARCELAS".
 * Se a descrição já trouxer o molde com "X" ("CASA SENILTON X DE 420
 * PARCELAS"), o X é trocado pelo número da parcela no lugar. O seguro não é
 * contrato parcelado: o número vem do campo Parcelas ("2/6").
 */
export interface ObrigacaoParaNome {
  categoria?: string | null;
  descricao?: string | null;
  parcela_numero?: number | null;
  parcela_total?: number | null;
  tipo_lancamento?: string | null;
  /** Seguro: "2/6" digitado à mão no campo Parcelas, fora do contrato parcelado. */
  parcelas?: string | null;
}

const SUFIXO_PARCELA = /\s*·\s*Parcela\s+(\d+)\s*\/\s*(\d+)\s*$/i;
// "X DE 420 PARCELAS", "X DE 6 PARCELAS" — o molde escrito pelo Jurídico.
const MOLDE_X = /\bX(\s+DE\s+\d+\s+PARC)/i;
// A descrição já diz o tamanho do contrato ("COND. GREEN 60 PARC."): não
// acrescenta outro "N DE T" por cima.
const JA_TEM_PARCELAS = /\b\d+\s+(DE\s+\d+\s+)?PARC(ELAS?|\.)?\s*$/i;

export function nomeDespesaMalote(o: ObrigacaoParaNome, patrimonio?: string | null): string {
  const desc = String(o.descricao ?? "").trim();
  const sufixo = desc.match(SUFIXO_PARCELA);
  let base = desc.replace(SUFIXO_PARCELA, "").trim();
  if (!base) base = [o.categoria, patrimonio].map(s => String(s ?? "").trim()).filter(Boolean).join(" - ") || "DESPESA";

  const avulsa = String(o.parcelas ?? "").match(/^\s*(\d+)\s*(?:\/|de)\s*(\d+)/i);
  const achada = sufixo ?? avulsa;
  const numero = o.parcela_numero ?? (achada ? Number(achada[1]) : null);
  const total = o.parcela_total ?? (achada ? Number(achada[2]) : null);
  if (ehParcelaNumerada(o.tipo_lancamento) && numero) {
    if (MOLDE_X.test(base)) base = base.replace(MOLDE_X, `${numero}$1`);
    else if (!JA_TEM_PARCELAS.test(base)) base = `${base} ${numero}${total ? ` DE ${total}` : ""} PARCELAS`;
  }
  // O campo do Malote é maiúsculo (InputMaiusculo), mas só converte o que é
  // digitado: o que chega pela URL ficava com a caixa misturada.
  return base.replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
}
