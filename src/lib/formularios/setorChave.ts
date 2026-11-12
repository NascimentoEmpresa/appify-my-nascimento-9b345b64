// =====================================================================
// SETOR DE FORMULÁRIO — UMA RÉGUA SÓ (12/11/2026)
//
// O setor carimbado na resposta vem do Setor_ERP de quem respondeu, e o
// cadastro tem as duas grafias: JURIDICO/JURÍDICO, LICITACAO/LICITAÇÃO. A
// tela de Respostas listava as duas no filtro, e a leitura "Por setor" com
// JURIDICO não abria as respostas JURÍDICO (só quem via TUDO enxergava o
// Jurídico inteiro — FEEDBACK GUIADO | LIDERANÇA).
//
// Espelha public.cs_form_chave_setor (migration 20261113003000): sem
// acento, maiúscula, espaços colapsados. A autoridade é o banco; isto aqui
// é o mesmo critério para o recorte da tela e para os chips.
// =====================================================================

/** Chave de comparação: "  Jurídico " → "JURIDICO". Vazio → "". */
export const chaveSetor = (s: string | null | undefined): string =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();

const temAcento = (s: string) => s.normalize("NFD") !== s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Grafia de exibição: maiúscula, espaços colapsados, acento preservado. */
const rotuloSetor = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();

/**
 * Uma grafia por setor. Entre as variantes de uma mesma chave, fica a
 * ACENTUADA (é a que se lê melhor). Fora o placeholder PADRAO ("sem setor").
 * Devolve em ordem alfabética pt-BR.
 */
export function setoresUnicos(lista: Iterable<string | null | undefined>): string[] {
  const porChave = new Map<string, string>();
  for (const bruto of lista) {
    const k = chaveSetor(bruto);
    if (!k || k === "PADRAO") continue;
    const rotulo = rotuloSetor(String(bruto));
    const atual = porChave.get(k);
    if (!atual || (!temAcento(atual) && temAcento(rotulo))) porChave.set(k, rotulo);
  }
  return [...porChave.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Os dois setores são o mesmo, ignorando acento/caixa/espaço? */
export const mesmoSetor = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const ka = chaveSetor(a);
  return !!ka && ka === chaveSetor(b);
};
