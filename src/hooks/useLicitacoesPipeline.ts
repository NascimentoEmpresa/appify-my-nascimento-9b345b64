// Hook de leitura real do Pipeline a partir de public.licitacao.
// Somente SELECT. Sem service_role. Filtrado por empresa_id.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  mapManyDbLicitacaoToPipeline,
  type DbLicitacaoRow,
  type LicitacaoPipeline,
  type ResponsavelMap,
} from "@/utils/licitacoes/mapDbLicitacaoToPipeline";


export type UseLicitacoesPipelineInput = {
  empresaId: string | null;
  // SIS-2026-0309: lê todas as empresas do grupo — o filtro por empresa
  // ativa só limitava a visão, sem proteger nada.
  todasEmpresas?: boolean;
};

const SELECT_COLUMNS =
  "id, empresa_id, numero, objeto, orgao, modalidade, valor_estimado, status, abertura, observacoes, local_prestacao, origem_carga, batch_id, responsavel_user_id, assumido_em, assumido_por, updated_at";

const HARD_LIMIT = 2000;

async function fetchLicitacoes(empresaId: string | null, todasEmpresas: boolean): Promise<LicitacaoPipeline[]> {
  let q = supabase
    .from("licitacao")
    .select(SELECT_COLUMNS)
    .order("abertura", { ascending: true, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(HARD_LIMIT);
  if (!todasEmpresas) q = q.eq("empresa_id", empresaId!);
  const { data, error } = await q;

  if (error) throw error;
  const rows = (data ?? []) as DbLicitacaoRow[];

  // Resolver nomes dos responsáveis em 1 query.
  // IMPORTANTE: falha aqui NÃO deve derrubar o dataReal das licitações.
  // Se profiles falhar (RLS, etc.), seguimos com map vazio — o id UUID das licitações é preservado.
  const ids = Array.from(
    new Set(
      rows
        .map((r) => r.responsavel_user_id)
        .filter((x): x is string => !!x),
    ),
  );
  let responsaveis: ResponsavelMap = {};
  if (ids.length > 0) {
    try {
      const { data: profs, error: errProf } = await supabase
        .from("profiles")
        .select("id, display_name, email")
        .in("id", ids);
      if (errProf) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn("[useLicitacoesPipeline] profiles lookup falhou (ignorado):", errProf.message);
        }
      } else {
        responsaveis = Object.fromEntries(
          (profs ?? []).map((p) => [
            p.id as string,
            {
              nome: (p.display_name as string | null) ?? null,
              email: (p.email as string | null) ?? null,
            },
          ]),
        );
      }
    } catch (e) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn("[useLicitacoesPipeline] profiles lookup throw (ignorado):", e);
      }
    }
  }


  return mapManyDbLicitacaoToPipeline(rows, responsaveis);
}

export function useLicitacoesPipeline({
  empresaId,
  todasEmpresas = false,
}: UseLicitacoesPipelineInput) {
  const q = useQuery({
    queryKey: todasEmpresas ? ["licitacoes-pipeline", "todas"] : ["licitacoes-pipeline", empresaId],
    enabled: todasEmpresas || !!empresaId,
    staleTime: 30_000,
    queryFn: () => fetchLicitacoes(empresaId, todasEmpresas),
  });
  return {
    data: q.data ?? [],
    isLoading: q.isLoading,
    error: (q.error as Error | null) ?? null,
    refetch: q.refetch,
    isFetching: q.isFetching,
  };
}
