import { useMemo } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCargoCatalogo } from "@/components/admin/CargoCampo";
import type { PessoaAcesso } from "@/lib/acessoPorSetorCargo";
import type { LinhaPermissao } from "@/lib/acessoPorSetorCargo";
import type { AcessosGravados, NovoModulo } from "@/lib/novosModulos";

// RPCs e tabela de 17/11/2026 (SIS-2026-0931, mig 20261118093100) — fora do types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/** Tabela da aba: pendentes + nascidas desde 08/10/2026. Uma RPC só (guardião D7). */
export function useNovosModulos() {
  const q = useQuery({
    queryKey: ["novos-modulos"],
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc("novos_modulos_listar");
      if (error) throw error;
      return (data ?? []) as NovoModulo[];
    },
  });
  return { lista: q.data ?? [], disponivel: !q.isError, carregando: q.isLoading };
}

/** O que está gravado para a tela, valendo ou não — a base do pré-marcado. */
export function useAcessosNovoModulo(codigo: string | null) {
  return useQuery({
    queryKey: ["novo-modulo-acessos", codigo],
    enabled: !!codigo,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await sb.rpc("novo_modulo_acessos", { _menu: codigo });
      if (error) throw error;
      const r = (data ?? {}) as Partial<AcessosGravados>;
      return {
        pendente: !!r.pendente,
        individuais: r.individuais ?? [],
        perfis: r.perfis ?? [],
      } as AcessosGravados;
    },
  });
}

export interface EventoLiberacao {
  id: number;
  menu_codigo: string;
  menu_nome: string | null;
  evento: "liberado" | "acessos_alterados" | "bloqueado";
  adicionados: string[];
  removidos: string[];
  perfis_removidos: { id: string; nome: string }[];
  setores: string[];
  cargos: string[];
  pessoas_com_acesso: number;
  feito_por: string | null;
  feito_em: string;
}

export function useHistoricoNovosModulos(ativo: boolean) {
  return useQuery({
    queryKey: ["novos-modulos-historico"],
    enabled: ativo,
    queryFn: async () => {
      // Sem a coluna `antes` (estado anterior, pode ser grande).
      const { data, error } = await sb.from("MENU_LIBERACAO_HISTORICO")
        .select("id,menu_codigo,menu_nome,evento,adicionados,removidos,perfis_removidos,setores,cargos,pessoas_com_acesso,feito_por,feito_em")
        .order("feito_em", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as EventoLiberacao[];
    },
  });
}

/**
 * Pessoas com setor e cargo — mesmas chaves de query do painel "Por Setor /
 * Cargo", para não buscar duas vezes.
 */
export function usePessoasParaAcesso() {
  const { cargos } = useCargoCatalogo();
  const perfisQ = useQuery({
    queryKey: ["acesso-massa-pessoas"],
    queryFn: async () => {
      const { data, error } = await sb.from("profiles").select("id,display_name,email,cargo,ativo").order("display_name");
      if (error) throw error;
      return (data ?? []) as { id: string; display_name: string | null; email: string | null; cargo: string | null; ativo: boolean }[];
    },
  });
  const userSetoresQ = useQuery({
    queryKey: ["all-user-setores"],
    queryFn: async () => {
      const { data, error } = await sb.from("user_setor").select("user_id,setor");
      if (error) throw error;
      return (data ?? []) as { user_id: string; setor: string }[];
    },
  });
  const setoresQ = useQuery({
    queryKey: ["setores_catalogo"],
    queryFn: async () => {
      const { data, error } = await sb.from("setor_catalogo").select("nome").order("nome");
      if (error) throw error;
      return ((data ?? []) as { nome: string }[]).map((r) => r.nome);
    },
  });

  const pessoas = useMemo<PessoaAcesso[]>(() => {
    const nivelPorCargo = new Map(cargos.map((c) => [c.nome, c.nivel] as const));
    const setores = new Map<string, string[]>();
    for (const r of userSetoresQ.data ?? []) setores.set(r.user_id, [...(setores.get(r.user_id) ?? []), r.setor]);
    return (perfisQ.data ?? []).map((p) => ({
      id: p.id,
      nome: p.display_name || p.email || p.id,
      cargo: p.cargo,
      nivel: p.cargo ? nivelPorCargo.get(p.cargo) ?? null : null,
      setores: setores.get(p.id) ?? [],
      ativo: p.ativo,
    }));
  }, [perfisQ.data, userSetoresQ.data, cargos]);

  return {
    pessoas,
    setores: setoresQ.data ?? [],
    cargos: cargos.map((c) => c.nome),
    carregando: perfisQ.isLoading || userSetoresQ.isLoading,
  };
}

export async function salvarNovoModulo(p: {
  codigo: string;
  linhas: LinhaPermissao[];
  perfisRemover: string[];
  setores: string[];
  cargos: string[];
}) {
  const { data, error } = await sb.rpc("novo_modulo_salvar", {
    _menu: p.codigo, _linhas: p.linhas, _perfis_remover: p.perfisRemover, _setores: p.setores, _cargos: p.cargos,
  });
  if (error) throw error;
  return data as { id: number; situacao: "pendente" | "liberado"; pessoas: number; evento: string };
}

export async function bloquearNovoModulo(codigo: string) {
  const { data, error } = await sb.rpc("novo_modulo_bloquear", { _menu: codigo });
  if (error) throw error;
  return data as { id: number | null; situacao: "pendente" };
}

/** Tudo que mostra acesso — a tela liberada/bloqueada muda menu lateral, painéis e contagens. */
export function invalidarNovosModulos(qc: QueryClient) {
  for (const k of [
    "novos-modulos", "novo-modulo-acessos", "novos-modulos-historico", "app_menu", "accessible-menus",
    "effective-menus-for-user", "effective-menus-acoes-for-user", "users-with-menu-access", "acesso-efetivo-grupo",
  ]) {
    qc.invalidateQueries({ queryKey: [k] });
  }
}
