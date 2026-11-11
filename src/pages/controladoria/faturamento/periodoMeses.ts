/**
 * Período em meses da Lucratividade de Contratos (SIS-2026-0769, 11/11/2026).
 *
 * A tela nasceu com UM mês. A Controladoria pediu intervalo (mês inicial e mês
 * final) para olhar trimestre/semestre sem somar planilha na mão. Tudo que é
 * dinheiro na tela passou a somar os meses deste intervalo; o que é checagem
 * de um mês (auditoria, cobrança de justificativa) continua por mês, porque
 * validar "o trimestre" não existe no banco.
 *
 * Mês aqui é sempre "YYYY-MM" (o mesmo formato da competência cortada em 7).
 */

/** Todos os meses de `inicio` até `fim`, inclusive. Invertido, devolve na ordem certa. */
export function mesesNoIntervalo(inicio: string, fim: string): string[] {
  const [de, ate] = ordenarMeses(inicio, fim);
  const [anoDe, mesDe] = de.split("-").map(Number);
  const [anoAte, mesAte] = ate.split("-").map(Number);
  if (!anoDe || !mesDe || !anoAte || !mesAte) return [];
  const out: string[] = [];
  for (let ano = anoDe, mes = mesDe; ano < anoAte || (ano === anoAte && mes <= mesAte); ) {
    out.push(`${ano}-${String(mes).padStart(2, "0")}`);
    if (mes === 12) { ano += 1; mes = 1; } else { mes += 1; }
  }
  return out;
}

/** Devolve [menor, maior] — o usuário pode escolher "até" antes de "de". */
export function ordenarMeses(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

/** Está dentro do intervalo? `mes` é "YYYY-MM"; a competência vem cortada em 7. */
export function mesNoIntervalo(mes: string, inicio: string, fim: string): boolean {
  const [de, ate] = ordenarMeses(inicio, fim);
  return mes >= de && mes <= ate;
}

/**
 * "out/26" quando é um mês só, "ago/26 a out/26" quando é intervalo.
 *
 * `rotulo` é injetado (normalmente `rotuloMes` de useBaseFaturamento) para este
 * módulo não depender dos hooks — assim o teste roda sem subir o cliente do
 * Supabase.
 */
export function rotuloPeriodo(inicio: string, fim: string, rotulo: (mes: string) => string): string {
  const [de, ate] = ordenarMeses(inicio, fim);
  return de === ate ? rotulo(de) : `${rotulo(de)} a ${rotulo(ate)}`;
}

/** Sufixo de nome de arquivo: "2026-10" ou "2026-08_2026-10". */
export function sufixoArquivo(inicio: string, fim: string): string {
  const [de, ate] = ordenarMeses(inicio, fim);
  return de === ate ? de : `${de}_${ate}`;
}
