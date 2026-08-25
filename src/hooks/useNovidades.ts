import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMeuNome } from "@/hooks/useMeuNome";
import { usePermissoes } from "@/context/PermissoesContext";
import {
  MENU_PUBLICAR, TABELA, TABELA_LIDAS, naoLidas,
  type FormNovidade, type Novidade, paraBanco,
} from "@/lib/novidades";

const sb = supabase as any;

/**
 * Dados das Novidades do Sistema — uma fonte só para as três superfícies
 * (megafone do topo, painel do Início e página /app/novidades).
 *
 * Quem pode publicar sai do MESMO gerenciamento de acesso do resto do ERP:
 * `can("incluir", undefined, "novidades_publicar")`, o flag "Pode criar
 * novidades do sistema" em Administração › Acesso por Usuário. Isto aqui é
 * heurística de UI (esconder botão); quem recusa de verdade é a RLS.
 *
 * A marca de lida é por linha, gravada quando a pessoa ABRE a lista — não no
 * hover nem no render, senão a bolinha some sem ninguém ter lido nada.
 */
export function useNovidades() {
  const { user } = useAuth();
  const meuNome = useMeuNome();  // vai gravado em criado_por_nome — ver o hook
  const { can } = usePermissoes();
  const qc = useQueryClient();

  const podePublicar = can("incluir", undefined, MENU_PUBLICAR);

  const listaQ = useQuery({
    queryKey: ["novidades"],
    staleTime: 60_000,
    queryFn: async (): Promise<Novidade[]> => {
      // Sem filtro por `publicado`: a RLS já devolve rascunho só p/ quem
      // publica, e filtrar aqui esconderia o rascunho de quem o criou.
      const { data, error } = await sb.from(TABELA)
        .select("id, titulo, descricao, tipo, rota, publicado, publicado_em, criado_por, criado_por_nome")
        .order("publicado_em", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Novidade[];
    },
  });

  const lidasQ = useQuery({
    queryKey: ["novidades-lidas", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<number[]> => {
      const { data, error } = await sb.from(TABELA_LIDAS)
        .select("novidade_id").eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r: any) => Number(r.novidade_id));
    },
  });

  const novidades = useMemo(() => listaQ.data ?? [], [listaQ.data]);
  const pendentes = useMemo(
    () => naoLidas(novidades, lidasQ.data ?? []),
    [novidades, lidasQ.data]);

  const invalidar = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["novidades"] });
    qc.invalidateQueries({ queryKey: ["novidades-lidas"] });
  }, [qc]);

  /** Marca tudo o que está pendente como lido. Chamada ao ABRIR a lista. */
  const marcarLidas = useCallback(async () => {
    if (!user?.id || !pendentes.length) return;
    const linhas = pendentes.map(n => ({ novidade_id: n.id, user_id: user.id }));
    // upsert: duas abas abertas marcam a mesma novidade e a segunda bateria
    // na PK sem isto.
    await sb.from(TABELA_LIDAS).upsert(linhas, { onConflict: "novidade_id,user_id" });
    qc.invalidateQueries({ queryKey: ["novidades-lidas", user.id] });
  }, [user?.id, pendentes, qc]);

  const salvar = useMutation({
    mutationFn: async ({ id, form }: { id?: number; form: FormNovidade }) => {
      const nome = meuNome || null;
      const linha = paraBanco(form, nome);
      if (id) {
        const { error } = await sb.from(TABELA).update(linha).eq("id", id);
        if (error) throw error;
        return id;
      }
      const { data, error } = await sb.from(TABELA)
        .insert({ ...linha, criado_por: user?.id ?? null }).select("id").single();
      if (error) throw error;
      return Number(data?.id);
    },
    onSuccess: invalidar,
  });

  const excluir = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await sb.from(TABELA).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidar,
  });

  return {
    novidades,
    pendentes,
    naoLidasCount: pendentes.length,
    carregando: listaQ.isLoading,
    erro: listaQ.error as Error | null,
    podePublicar,
    marcarLidas,
    salvar,
    excluir,
    recarregar: invalidar,
  };
}
