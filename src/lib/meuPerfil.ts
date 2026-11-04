import { supabase } from "@/integrations/supabase/client";
import { compartilhar } from "@/lib/leituraCompartilhada";

// =====================================================================
// A LINHA DE `profiles` DE QUEM ESTÁ LOGADO — uma leitura por boot
//
// Topbar (select=*), EmpresaAtivaContext (empresa_atual_id, empresa_id,
// acessa_todas_empresas), PermissoesContext (empresa_id, empresa_atual_id),
// useMustChangePassword (must_change_password) e useMeuNome (display_name)
// liam a MESMA linha, cada um a sua coluna, na mesma hora: ~7 requisições
// por recarga de página (ver src/lib/leituraCompartilhada.ts). Agora todos
// leem daqui: select=* uma vez, compartilhado por 5 s.
//
// 5 s e não mais: quem GRAVA no próprio perfil (trocar empresa ativa,
// trocar senha, editar Meu Perfil) chama `esquecerMeuPerfil()` antes de ler
// de novo — mas se alguém esquecer, o pior caso é 5 s de dado velho.
// =====================================================================

export type MeuPerfil = Record<string, any> | null;

const cache = compartilhar<MeuPerfil>(5_000);

export function lerMeuPerfil(userId: string): Promise<MeuPerfil> {
  return cache.ler(userId, async () => {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) throw error;
    return (data ?? null) as MeuPerfil;
  });
}

export function esquecerMeuPerfil(userId?: string) {
  cache.esquecer(userId);
}
