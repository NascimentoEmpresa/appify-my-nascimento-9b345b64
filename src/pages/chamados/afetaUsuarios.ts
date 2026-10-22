// "Afeta quantos usuários?" (Abrir chamado) grava em CHAMADO_SISTEMA.afeta_usuarios,
// que é INTEGER. O campo era <input type="number"> e aceitava decimal: em 22/10/2026
// o Ismael (Operacional) digitou "2,3" (o navegador pt-BR entrega "2.3"), o front
// mandou o número 2.3 e o Postgres recusou o chamado inteiro com
// `invalid input syntax for type integer: "2.3"` — por causa de um campo opcional.
// Bug desde a criação do módulo (27/07/2026).
//
// Agora o campo só aceita dígitos enquanto se digita (o que aparece é o que grava),
// e a conversão no envio nunca devolve fração nem negativo.

/** Filtro do onChange: deixa só os dígitos. */
export const somenteDigitos = (texto: string): string => texto.replace(/\D/g, "");

/** Valor para a coluna integer: inteiro >= 0, ou null quando vazio/inválido. */
export function afetaUsuariosParaBanco(texto: string): number | null {
  const n = Number(texto.trim().replace(",", "."));
  if (!texto.trim() || !Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}
