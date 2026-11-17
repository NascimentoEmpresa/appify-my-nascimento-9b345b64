// Etiquetas pessoais do dev nos chamados (mig 20261117170000). O RLS só
// devolve as do próprio usuário, então as consultas não filtram por dono.
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  etiquetasPorChamado, normalizarNome, type Etiqueta, type VinculoEtiqueta,
} from "@/lib/chamados/etiquetas";

const CHAVE = "chamado-etiquetas";

export function useChamadoEtiquetas(habilitado = true) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id;
  const ativo = habilitado && !!uid;

  const { data: etiquetas = [] } = useQuery({
    queryKey: [CHAVE, uid],
    enabled: ativo,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("CHAMADO_ETIQUETA").select("id, nome, cor").order("nome");
      if (error) throw error;
      return (data ?? []) as Etiqueta[];
    },
  });

  const { data: vinculos = [] } = useQuery({
    queryKey: [CHAVE, "vinculos", uid],
    enabled: ativo,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("CHAMADO_ETIQUETA_CHAMADO").select("etiqueta_id, chamado_id");
      if (error) throw error;
      return (data ?? []) as VinculoEtiqueta[];
    },
  });

  const porChamado = useMemo(() => etiquetasPorChamado(etiquetas, vinculos), [etiquetas, vinculos]);
  const recarregar = () => qc.invalidateQueries({ queryKey: [CHAVE] });

  const salvar = useMutation({
    mutationFn: async (e: { id?: string; nome: string; cor: string }) => {
      const linha = { nome: normalizarNome(e.nome), cor: e.cor };
      const { error } = e.id
        ? await (supabase as any).from("CHAMADO_ETIQUETA").update(linha).eq("id", e.id)
        : await (supabase as any).from("CHAMADO_ETIQUETA").insert(linha);
      if (error) throw error;
    },
    onSuccess: recarregar,
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("CHAMADO_ETIQUETA").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: recarregar,
  });

  /** Cola (marcar = true) ou descola a etiqueta do chamado. */
  const alternar = useMutation({
    mutationFn: async (v: VinculoEtiqueta & { marcar: boolean }) => {
      const tabela = (supabase as any).from("CHAMADO_ETIQUETA_CHAMADO");
      const { error } = v.marcar
        ? await tabela.insert({ etiqueta_id: v.etiqueta_id, chamado_id: v.chamado_id })
        : await tabela.delete().eq("etiqueta_id", v.etiqueta_id).eq("chamado_id", v.chamado_id);
      if (error) throw error;
    },
    onSuccess: recarregar,
  });

  return { etiquetas, porChamado, salvar, excluir, alternar };
}
