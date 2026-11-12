import { supabase } from "@/integrations/supabase/client";
import { mesmoSetor } from "@/lib/formularios/setorChave";

// =====================================================================
// Apagar um grant por SETOR (ver_setor / criar_setor) em CS_FORM_ACESSOS.
//
// Não dá para apagar com `.eq("setor", setor)`: o chip mostra UMA grafia
// (JURÍDICO) e a linha pode ter sido gravada com a outra (JURIDICO) — o
// DELETE não pegava nada, o chip desmarcava na tela e o banco continuava
// concedendo (12/11/2026). Lê as linhas da pessoa e apaga pelos ids das que
// casam sem acento/caixa.
//
// `formularioId` null = grant GERAL (formulario_id IS NULL). Sem esse
// filtro o DELETE geral também apagava a regra própria de formulários.
// =====================================================================
export async function apagarGrantSetor(
  userId: string, papel: "ver_setor" | "criar_setor", formularioId: string | null, setor: string | null,
): Promise<{ error: { message: string } | null }> {
  let q = (supabase as any).from("CS_FORM_ACESSOS").select("id,setor").eq("user_id", userId).eq("papel", papel);
  q = formularioId ? q.eq("formulario_id", formularioId) : q.is("formulario_id", null);
  const { data, error } = await q;
  if (error) return { error };
  const ids = (data ?? [])
    .filter((r: any) => setor == null || mesmoSetor(r.setor, setor))
    .map((r: any) => r.id);
  if (!ids.length) return { error: null };
  const { error: e2 } = await (supabase as any).from("CS_FORM_ACESSOS").delete().in("id", ids);
  return { error: e2 ?? null };
}
