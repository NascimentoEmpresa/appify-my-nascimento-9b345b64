/**
 * Telefone de `profiles.telefone`: exibição.
 *
 * O banco guarda dígitos puros com o DDI 55 na frente (12 ou 13 dígitos,
 * ex.: "5551996594681"). Quem grava nesse formato é
 * `normalizeTelefone()` em supabase/functions/admin-create-user/index.ts e o
 * `55${digits}` de UsuariosReal.tsx — estas funções são a contraparte de
 * leitura. Mascarar sem tirar o DDI antes corta os 2 últimos dígitos e
 * desloca o DDD.
 */

/**
 * Dígitos sem o DDI. Inverso exato da regra de gravação: só tira o "55"
 * inicial quando o total tem 12 ou 13 dígitos. Sem essa checagem de tamanho,
 * um número de DDD 55 (Santa Maria/RS) gravado sem DDI viraria "999998888".
 */
export function semDdi(v: string): string {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d.slice(2);
  return d;
}

/** Máscara BR de exibição/digitação: (51) 99659-4681 ou (51) 3333-4444. */
export function maskFone(v: string): string {
  const d = semDdi(v).slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}
