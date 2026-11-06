import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  montarMenu, validarEstrutura,
  type EstruturaMenu, type ItemCatalogo, type ModuloCatalogo,
} from "@/lib/menuLateral/estrutura";

export interface MenuSalvo {
  versao: number;
  estrutura: EstruturaMenu;
}

export const CHAVE_MENU_LATERAL = ["menu-lateral"] as const;

/**
 * SIS-2026-0772: a organização do menu lateral salva em
 * Sistemas › Organizar Menu Lateral (RPC menu_lateral_atual, mig 20261105030000).
 *
 * Devolve null — e o menu cai no padrão do código — quando não há versão
 * salva, quando a RPC ainda não existe (migration pendente) ou falha, e
 * quando a estrutura chega fora do formato. Em nenhum desses casos o menu
 * fica em branco: o pior que acontece é mostrar o menu de antes.
 */
export function useMenuLateralSalvo() {
  return useQuery({
    queryKey: CHAVE_MENU_LATERAL,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<MenuSalvo | null> => {
      // A função não está nos tipos gerados (types.ts) — mesmo caso de outras
      // RPCs novas do projeto.
      const { data, error } = await (supabase as unknown as { rpc: (f: string) => Promise<{ data: unknown; error: unknown }> })
        .rpc("menu_lateral_atual");
      if (error) {
        console.warn("menu_lateral_atual: usando o menu padrão", error);
        return null;
      }
      const d = data as { versao?: number; estrutura?: EstruturaMenu } | null;
      if (!d?.estrutura || typeof d.versao !== "number") return null;
      const erros = validarEstrutura(d.estrutura);
      if (erros.length) {
        console.warn("menu_lateral_atual: estrutura inválida, usando o menu padrão", erros);
        return null;
      }
      return { versao: d.versao, estrutura: d.estrutura };
    },
  });
}

/** Os módulos do menu prontos para desenhar: a organização salva, ou o padrão. */
export function useMenuLateral<I extends ItemCatalogo, M extends ModuloCatalogo<I>>(catalogo: M[]): M[] {
  const { data } = useMenuLateralSalvo();
  return useMemo(() => montarMenu<I, M>(catalogo, data?.estrutura ?? null), [catalogo, data]);
}
