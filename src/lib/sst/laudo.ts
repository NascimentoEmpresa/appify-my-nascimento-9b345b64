type DataLaudo = string | Date | null | undefined;

function componentes(valor: DataLaudo): { ano: number; mes: number; dia: number } | null {
  if (!valor) return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return { ano: valor.getFullYear(), mes: valor.getMonth(), dia: valor.getDate() };
  }

  const partes = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!partes) return null;
  const resultado = { ano: Number(partes[1]), mes: Number(partes[2]) - 1, dia: Number(partes[3]) };
  const conferida = new Date(Date.UTC(resultado.ano, resultado.mes, resultado.dia));
  if (
    conferida.getUTCFullYear() !== resultado.ano
    || conferida.getUTCMonth() !== resultado.mes
    || conferida.getUTCDate() !== resultado.dia
  ) return null;
  return resultado;
}

function instanteCivil(valor: DataLaudo): number | null {
  const data = componentes(valor);
  return data ? Date.UTC(data.ano, data.mes, data.dia) : null;
}

/** Soma meses como o Postgres: preserva o dia e limita ao fim do mês. */
function somarMeses(valor: DataLaudo, meses: number): number | null {
  const data = componentes(valor);
  if (!data) return null;

  const primeiroDoMes = new Date(Date.UTC(data.ano, data.mes + meses, 1));
  const ultimoDia = new Date(Date.UTC(
    primeiroDoMes.getUTCFullYear(), primeiroDoMes.getUTCMonth() + 1, 0,
  )).getUTCDate();
  return Date.UTC(
    primeiroDoMes.getUTCFullYear(),
    primeiroDoMes.getUTCMonth(),
    Math.min(data.dia, ultimoDia),
  );
}

/** Regra de aceite usada como cortesia na entrada; a RPC repete a garantia. */
export function caAtendeLaudo(
  validadeCa: DataLaudo,
  validadeMinimaMeses: number | null | undefined,
  hoje: DataLaudo,
): boolean {
  if (validadeMinimaMeses === null || validadeMinimaMeses === undefined) return true;

  const validade = instanteCivil(validadeCa);
  const minimo = somarMeses(hoje, validadeMinimaMeses);
  if (validade === null || minimo === null) return false;
  return validade >= minimo;
}
