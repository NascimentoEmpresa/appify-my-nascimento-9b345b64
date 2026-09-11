import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// SIS-2026-0374 (Iury): terceiro par de Ligação — Classificação Malote SEM
// orçamento próprio (ex. Pensão) → Classificação Malote COM orçamento
// próprio (ex. Salário). Mesmo padrão de useMaloteLicitacaoClassificacaoLink
// / useMaloteAdministrativoClassificacaoLink, só que os dois lados são a
// mesma entidade — daí o trigger de integridade no banco (sem corrente,
// sem origem que já tenha orçamento próprio).
export interface LigacaoClassificacaoMalote {
  id: string;
  classificacao_malote_id: string;
  classificacao_malote_vinculada_id: string;
  classificacao_malote: { id: string; nome: string } | null;
  classificacao_malote_vinculada: { id: string; nome: string } | null;
}

const LIGACOES_KEY = "malote_classificacao_malote_link";

export function useLigacoesClassificacaoMalote() {
  return useQuery({
    queryKey: [LIGACOES_KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_classificacao_malote_link")
        .select(
          "id, classificacao_malote_id, classificacao_malote_vinculada_id, " +
            "classificacao_malote:classificacao_malote_id(id, nome), " +
            "classificacao_malote_vinculada:classificacao_malote_vinculada_id(id, nome)"
        );
      if (error) throw error;
      return (data ?? []) as LigacaoClassificacaoMalote[];
    },
  });
}

interface SalvarLigacaoInput {
  id?: string;
  classificacao_malote_id: string;
  classificacao_malote_vinculada_id: string;
}

export function useSalvarLigacaoClassificacaoMalote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarLigacaoInput) => {
      const { error } = await (supabase as any)
        .from("malote_classificacao_malote_link")
        .upsert(input, { onConflict: input.id ? "id" : "classificacao_malote_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [LIGACOES_KEY] }),
  });
}

export function useExcluirLigacaoClassificacaoMalote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("malote_classificacao_malote_link").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [LIGACOES_KEY] }),
  });
}

// ── Resolução (pura, testável) ──────────────────────────────────────────
// Toda conta de Orçado/Utilizado por Classificação Malote passa a resolver
// a ORIGEM (sem orçamento próprio) pelo DESTINO (com orçamento) antes de
// calcular — a origem em si nunca tem linha de orçamento/planejamento.
// Isto NÃO afeta quem aprova (aprovador1/2/3, setor_responsavel) nem o
// registro da despesa (classificacao_id continua sendo o da origem, ex.
// Pensão) — só o cálculo de dinheiro é redirecionado.
export function mapaClassificacaoVinculada(
  ligacoes: { classificacao_malote_id: string; classificacao_malote_vinculada_id: string }[]
): Map<string, string> {
  return new Map(ligacoes.map((l) => [l.classificacao_malote_id, l.classificacao_malote_vinculada_id]));
}

export function classificacaoCanonica(
  mapa: Map<string, string>,
  id: string | null | undefined
): string | null {
  if (!id) return null;
  return mapa.get(id) ?? id;
}
