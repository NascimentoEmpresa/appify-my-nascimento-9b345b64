export type SituacaoCa = "sem_ca" | "vencido" | "vencendo" | "valido";

type DataCa = string | Date | null | undefined;

/** Converte uma data civil em um número estável, sem deslocamento por fuso. */
function diaCivil(valor: DataCa): number | null {
  if (!valor) return null;

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return Date.UTC(valor.getFullYear(), valor.getMonth(), valor.getDate());
  }

  const partes = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!partes) return null;
  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  const instante = Date.UTC(ano, mes - 1, dia);
  const conferida = new Date(instante);
  if (
    conferida.getUTCFullYear() !== ano
    || conferida.getUTCMonth() !== mes - 1
    || conferida.getUTCDate() !== dia
  ) return null;
  return instante;
}

/**
 * Espelha `sst_situacao_ca`: vencido é somente antes de hoje; o próprio dia
 * da validade ainda vale e a faixa de antecedência começa no dia seguinte.
 */
export function situacaoCa(validade: DataCa, diasAlerta: number): SituacaoCa {
  const diaValidade = diaCivil(validade);
  if (diaValidade === null) return "sem_ca";

  const agora = new Date();
  const hoje = Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate());
  if (diaValidade < hoje) return "vencido";
  if (diaValidade === hoje) return "valido";

  const limite = hoje + Math.max(diasAlerta, 0) * 86_400_000;
  return diaValidade <= limite ? "vencendo" : "valido";
}
