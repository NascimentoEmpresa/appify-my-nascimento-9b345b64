import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppAcao = "visualizar" | "incluir" | "alterar" | "excluir" | "aprovar" | "enviar_malote" | "exportar" | "executar_ia" | "alterar_dre" | "responder" | "editar_concluida" | "ajuste_administrativo";

export function useScreenAccess(menuCodigo: string | null | undefined, acao: AppAcao, empresaId?: string | null) {
  return useQuery({
    queryKey: ["screen-access", menuCodigo, acao, empresaId ?? null],
    enabled: !!menuCodigo,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return false;
      const { data, error } = await supabase.rpc("has_screen_access", {
        _user: userData.user.id,
        _menu: menuCodigo!,
        _acao: acao,
        _empresa: empresaId ?? null,
      });
      if (error) {
        console.warn("has_screen_access error", error);
        return false;
      }
      return !!data;
    },
  });
}
