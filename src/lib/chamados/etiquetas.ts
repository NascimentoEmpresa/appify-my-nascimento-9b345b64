// Etiquetas pessoais do dev nos chamados (16/11/2026, mig 20261117170000):
// cada dev cria as dele (nome + cor) e cola nos chamados que quiser. Aqui fica
// só a regra pura — validação, contraste do texto e agrupamento por chamado.

export interface Etiqueta { id: string; nome: string; cor: string }
export interface VinculoEtiqueta { etiqueta_id: string; chamado_id: string }

export const MAX_NOME_ETIQUETA = 30;

/** Paleta sugerida no seletor; qualquer #RRGGBB também é aceito. */
export const CORES_ETIQUETA = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#64748b",
] as const;

const HEX = /^#[0-9a-f]{6}$/i;

export const normalizarNome = (nome: string) => nome.trim().replace(/\s+/g, " ");

/**
 * Erro de validação ou null. Espelha o banco: 1 a 30 caracteres, cor #RRGGBB
 * e nome único por dono sem diferenciar maiúscula (`ignorarId` = a própria
 * etiqueta, ao renomear).
 */
export function validarEtiqueta(
  nome: string, cor: string, existentes: Etiqueta[], ignorarId?: string,
): string | null {
  const n = normalizarNome(nome);
  if (!n) return "Dê um nome à etiqueta.";
  if (n.length > MAX_NOME_ETIQUETA) return `Use até ${MAX_NOME_ETIQUETA} caracteres.`;
  if (!HEX.test(cor)) return "Escolha uma cor.";
  const chave = n.toLowerCase();
  if (existentes.some((e) => e.id !== ignorarId && normalizarNome(e.nome).toLowerCase() === chave)) {
    return "Você já tem uma etiqueta com esse nome.";
  }
  return null;
}

/** Texto preto ou branco, o que contrasta mais com o fundo (luminância YIQ). */
export function corTextoSobre(fundo: string): "#000000" | "#ffffff" {
  if (!HEX.test(fundo)) return "#000000";
  const r = parseInt(fundo.slice(1, 3), 16), g = parseInt(fundo.slice(3, 5), 16), b = parseInt(fundo.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? "#000000" : "#ffffff";
}

/** chamado_id → etiquetas coladas nele, em ordem alfabética. */
export function etiquetasPorChamado(etiquetas: Etiqueta[], vinculos: VinculoEtiqueta[]): Record<string, Etiqueta[]> {
  const porId = new Map(etiquetas.map((e) => [e.id, e]));
  const m: Record<string, Etiqueta[]> = {};
  for (const v of vinculos) {
    const e = porId.get(v.etiqueta_id);
    if (e) (m[v.chamado_id] ??= []).push(e);
  }
  for (const k of Object.keys(m)) m[k].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return m;
}
