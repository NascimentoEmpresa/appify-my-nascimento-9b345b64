// Chave de comparação dos textos livres do Plano de Ações (Comitê, Setor/Área,
// nome legado de responsável). Esses campos são texto gravado na própria
// ação — vieram da importação do Excel, do formulário manual e da reunião,
// cada um com a grafia da sua fonte — e os filtros da Lista agrupavam por
// igualdade exata. Resultado visto em 14/09/2026 (SIS-2026-0392): "dois
// jurídicos, duas licitações, diretoria adm, diretor adm" no filtro de Setor.
//
// A chave ignora caixa, acento, pontuação e espaços repetidos, e resolve os
// sinônimos que a normalização sozinha não junta — são os mesmos pares já
// documentados em supabase/aplicar_no_banco_do_app.sql (cabeçalho do fix do
// reembolso de 02/09/2026): plural x singular e abreviação x nome completo.
const SINONIMOS: Record<string, string> = {
  "licitacoes": "licitacao",
  "diretor adm": "diretor administrativo",
  "diretoria adm": "diretor administrativo",
  "diretoria administrativa": "diretor administrativo",
  "diretoria operacional": "diretor operacional",
};

export function chaveTextoPlanoAcao(s: string | null | undefined): string {
  const base = String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return SINONIMOS[base] ?? base;
}
