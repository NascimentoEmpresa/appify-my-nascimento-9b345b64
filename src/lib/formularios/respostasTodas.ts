import { supabase } from "@/integrations/supabase/client";

/**
 * Todas as respostas visíveis (pela RLS), em páginas de 1000.
 *
 * O PostgREST corta qualquer select em 1000 linhas (max-rows), e .limit()
 * maior NÃO passa disso. O Dashboard e o Painel Gerencial pediam
 * .limit(5000)/.limit(10000) achando que vinha tudo; com mais de 1000
 * respostas somando os formulários, os indicadores ficavam faltando as mais
 * antigas, sem nenhum aviso (set/2026).
 */
export async function lerTodasRespostas<T = any>(colunas: string): Promise<{ data: T[]; error: { message: string } | null }> {
  const PAGINA = 1000;
  const todas: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await (supabase as any).from("CS_FORM_RESPOSTAS")
      .select(colunas)
      // desempate por id: só enviado_em deixa páginas instáveis em empates
      .order("enviado_em", { ascending: false }).order("id", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) return { data: todas, error };
    todas.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGINA) return { data: todas, error: null };
  }
}
