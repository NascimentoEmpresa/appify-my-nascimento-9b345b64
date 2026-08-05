import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Resolve o empresa_id do usuário autenticado a partir da tabela profiles.
 * Em modo demo (sem usuário), retorna null e o consumidor deve tratar.
 *
 * O user.id FAZ PARTE da queryKey de propósito. Sem ele, trocar de usuário no
 * mesmo navegador reaproveitava o valor cacheado do usuário anterior durante
 * os 5 minutos de staleTime — e como quase toda tela faz `enabled: !!empresaId`,
 * o sintoma era uma lista vazia indistinguível de "não há dados". Aparece na
 * hora de testar o login Externo (sessão anônima, empresa nula) e voltar como
 * colaborador interno.
 */
export function useEmpresaId() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["empresa_id_atual", user?.id ?? null],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("empresa_id")
        .eq("id", u.user.id)
        .maybeSingle();
      if (error) throw error;
      return (data?.empresa_id as string | null) ?? null;
    },
  });
}
