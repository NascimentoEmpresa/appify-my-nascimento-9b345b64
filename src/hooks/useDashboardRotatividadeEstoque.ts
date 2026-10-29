import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  FiltroRotatividade,
  FornecimentoUniformeColaborador,
  HistoricoUniformeLinha,
  RotatividadeEstoqueDados,
  RotatividadeEstoqueDetalhe,
} from "@/lib/suprimentos/rotatividadeEstoque";
import { combinarRotatividadeEstoque } from "@/lib/suprimentos/rotatividadeEstoque";

/**
 * Aba "Rotatividade do Estoque" do dashboard de Suprimentos.
 *
 * A visão executiva e o detalhe conferível são agregados no banco, em duas
 * RPCs paralelas. São ~8.800 itens de pedido e ~6.400 movimentos de estoque:
 * a RPC detalhada antiga calculava os dois blocos em série, sob o mesmo
 * `statement_timeout`, e falhava em janelas maiores. As duas respostas são
 * pequenas e voltam a formar o mesmo contrato de dados no navegador.
 *
 * O cast do client existe porque a RPC é nova e `types.ts` é gerado à mão
 * (`supabase gen types`), fora do CI: enquanto não for regerado, o nome da
 * função não está no tipo `Database`.
 */
export function useDashboardRotatividadeEstoque(
  empresaId: string | null | undefined,
  filtros: FiltroRotatividade,
) {
  return useQuery({
    queryKey: ["sup_dashboard_rotatividade_estoque_v2", empresaId, filtros],
    enabled: !!empresaId && !!filtros.inicio && !!filtros.fim,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<RotatividadeEstoqueDados> => {
      const cliente = supabase as unknown as {
        rpc: (
          nome: string,
          parametros: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      };
      const parametros = {
        p_empresa_id: empresaId,
        p_inicio: filtros.inicio,
        p_fim: filtros.fim,
        p_contrato_id: filtros.contratoId,
        p_categoria: filtros.categoria || null,
      };
      const [respostaBase, respostaDetalhe] = await Promise.all([
        cliente.rpc("sup_dashboard_rotatividade_estoque", parametros),
        cliente.rpc("sup_dashboard_rotatividade_itens_detalhe", parametros),
      ]);

      if (respostaBase.error) throw respostaBase.error;
      if (respostaDetalhe.error) throw respostaDetalhe.error;

      return combinarRotatividadeEstoque(
        respostaBase.data as RotatividadeEstoqueDados,
        respostaDetalhe.data as RotatividadeEstoqueDetalhe,
      );
    },
  });
}

/**
 * Histórico mensal de uniformes por peça e tamanho (SIS-2026-0636).
 *
 * Mantém "solicitado" separado de "utilizado": um pedido aberto revela
 * demanda, enquanto só a saída física confirma uso. Os dois números são
 * necessários para calibrar estoque mínimo sem tratar intenção como consumo.
 */
export function useHistoricoUniformes(
  empresaId: string | null | undefined,
  filtros: Omit<FiltroRotatividade, "categoria">,
) {
  return useQuery({
    queryKey: ["sup_historico_uniformes", empresaId, filtros],
    enabled: !!empresaId && !!filtros.inicio && !!filtros.fim,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<HistoricoUniformeLinha[]> => {
      const cliente = supabase as unknown as {
        rpc: (
          nome: string,
          parametros: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      };
      const { data, error } = await cliente.rpc("sup_historico_uniformes", {
        p_empresa_id: empresaId,
        p_inicio: filtros.inicio,
        p_fim: filtros.fim,
        p_contrato_id: filtros.contratoId,
      });
      if (error) throw error;
      return (data ?? []) as HistoricoUniformeLinha[];
    },
  });
}

/**
 * Fornecimentos efetivos por pessoa. A data vem da saída do almoxarifado,
 * não do pedido: assim uma solicitação pendente nunca aparece como consumo.
 */
export function useFornecimentosUniformesColaborador(
  empresaId: string | null | undefined,
  filtros: Omit<FiltroRotatividade, "categoria">,
) {
  return useQuery({
    queryKey: ["sup_fornecimentos_uniformes_colaborador", empresaId, filtros],
    enabled: !!empresaId && !!filtros.inicio && !!filtros.fim,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<FornecimentoUniformeColaborador[]> => {
      const cliente = supabase as unknown as {
        rpc: (
          nome: string,
          parametros: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      };
      const { data, error } = await cliente.rpc("sup_fornecimentos_uniformes_colaborador", {
        p_empresa_id: empresaId,
        p_inicio: filtros.inicio,
        p_fim: filtros.fim,
        p_contrato_id: filtros.contratoId,
      });
      if (error) throw error;
      return (data ?? []) as FornecimentoUniformeColaborador[];
    },
  });
}
