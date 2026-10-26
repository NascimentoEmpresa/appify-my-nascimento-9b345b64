import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { soDigitos, type EventoRestricao, type OrigemRestricao, type Restricao } from "@/lib/recrutamento/cadastroRestritivo";

// =====================================================================
// Cadastro Restritivo (mig 20261025000020) — a lista RECRUTAMENTO_CPF_BLACKLIST
// (nome, CPF, motivo, origem) e o histórico de quem incluiu/alterou/tirou.
// RLS: Recrutamento e Jurídico leem e gravam; o banco normaliza o CPF.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = "cadastro-restritivo";
const erro = (e: { message?: string } | null) => { if (e) throw new Error(e.message ?? "Erro"); };

export const useRestricoes = () => useQuery({
  queryKey: [K, "lista"], staleTime: 60_000,
  queryFn: async (): Promise<Restricao[]> => {
    const { data, error } = await sb.from("RECRUTAMENTO_CPF_BLACKLIST")
      .select("cpf_digits,cpf_fmt,nome,motivo,origem,criado_por,criado_em,atualizado_por,atualizado_em")
      .order("criado_em", { ascending: false }).limit(5000);
    erro(error);
    return data ?? [];
  },
});

export const useHistoricoRestricao = (cpf: string | null) => useQuery({
  queryKey: [K, "historico", cpf], enabled: !!cpf,
  queryFn: async (): Promise<EventoRestricao[]> => {
    const { data, error } = await sb.from("RECRUTAMENTO_CPF_RESTRICAO_HIST").select("*").eq("cpf_digits", cpf).order("em", { ascending: false });
    erro(error);
    return data ?? [];
  },
});

export async function nomeDoCpf(cpf: string): Promise<string | null> {
  if (soDigitos(cpf).length !== 11) return null;
  const { data, error } = await sb.rpc("rec_restritivo_nome_do_cpf", { p_cpf: cpf });
  if (error) return null;
  return (data as string | null) ?? null;
}

export function useGravarRestricao() {
  const qc = useQueryClient();
  const invalidar = () => qc.invalidateQueries({ queryKey: [K] });
  const salvar = useMutation({
    mutationFn: async (p: { cpf: string; nome: string; motivo: string; origem: OrigemRestricao; autor: string | null; novo: boolean }) => {
      const d = soDigitos(p.cpf);
      if (p.novo) {
        const { data: existe } = await sb.from("RECRUTAMENTO_CPF_BLACKLIST").select("cpf_digits,nome").eq("cpf_digits", d).maybeSingle();
        if (existe) throw new Error(`Esse CPF já está no Cadastro Restritivo${existe.nome ? ` (${existe.nome})` : ""}. Abra o registro para alterar.`);
        const { error } = await sb.from("RECRUTAMENTO_CPF_BLACKLIST").insert({
          cpf_digits: d, cpf_fmt: d, nome: p.nome, motivo: p.motivo, origem: p.origem, criado_por: p.autor,
        });
        erro(error);
      } else {
        const { error } = await sb.from("RECRUTAMENTO_CPF_BLACKLIST").update({ nome: p.nome, motivo: p.motivo }).eq("cpf_digits", d);
        erro(error);
      }
    },
    onSuccess: invalidar,
  });
  const remover = useMutation({
    mutationFn: async (p: { cpf: string; motivo: string }) => {
      const { error } = await sb.rpc("rec_restritivo_remover", { p_cpf: soDigitos(p.cpf), p_motivo: p.motivo });
      erro(error);
    },
    onSuccess: invalidar,
  });
  return { salvar, remover };
}
