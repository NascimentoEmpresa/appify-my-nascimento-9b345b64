import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  EstoqueSaudavelDados,
  FiltroEstoqueSaudavel,
} from "@/lib/suprimentos/estoqueSaudavel";

/**
 * Aba "Estoque Saudável" do dashboard de Suprimentos
 * (migs 20261020000020/21/22).
 *
 * Mesmo desenho do useDashboardRotatividadeEstoque: uma RPC só, que agrega no
 * banco e devolve o painel inteiro em jsonb. São ~8.800 itens de pedido e
 * centenas de combinações item+tamanho — agregar no navegador seria baixar
 * tudo isso a cada troca de filtro.
 *
 * O cast do client existe porque as RPCs são novas e `types.ts` é gerado à
 * mão (`supabase gen types`), fora do CI: enquanto não for regerado, o nome
 * das funções não está no tipo `Database`.
 */
type ClienteRpc = {
  rpc: (
    nome: string,
    parametros: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

const CHAVE = "sup_estoque_saudavel";

export function useEstoqueSaudavel(
  empresaId: string | null | undefined,
  filtros: FiltroEstoqueSaudavel,
) {
  return useQuery({
    queryKey: [CHAVE, empresaId, filtros],
    enabled: !!empresaId,
    staleTime: 2 * 60 * 1000,
    // Mantém a tela anterior enquanto o novo filtro carrega. A consulta varre
    // o histórico de pedidos inteiro e demora alguns segundos; sem isto a aba
    // pisca para esqueleto a cada troca de categoria.
    placeholderData: (anterior) => anterior,
    queryFn: async (): Promise<EstoqueSaudavelDados> => {
      const cliente = supabase as unknown as ClienteRpc;
      const { data, error } = await cliente.rpc("sup_estoque_saudavel", {
        p_empresa_id: empresaId,
        p_janela_meses: filtros.janelaMeses,
        p_contrato_id: filtros.contratoId,
        p_categoria: filtros.categoria,
        p_almoxarifado_id: filtros.almoxarifadoId,
        // A tabela tem busca local. Com o teto antigo de 500, uma combinação
        // existente (como MOLETOM CINZA EGG) podia ficar fora do payload e a
        // busca afirmava que não existia. O cálculo já percorre o catálogo
        // inteiro; aqui apenas pedimos todas as linhas calculadas.
        p_limite_itens: 5000,
      });
      if (error) throw error;
      return data as EstoqueSaudavelDados;
    },
  });
}

export interface LinhaPolitica {
  base_id: string;
  tamanho: string | null;
  /** Campo ausente = "não mexe neste". Ver o cabeçalho da mig 20261020000022. */
  alvo_aprovado?: number | null;
  minimo_aprovado?: number | null;
  lead_time_dias?: number | null;
  liquidar?: boolean;
  liquidar_motivo?: string | null;
  fora_do_plano?: boolean;
  observacao?: string | null;
  /** O que a conta sugeria na hora — vai para o histórico. */
  alvo_sugerido?: number | null;
}

/**
 * Aprova alvo/mínimo, marca liquidação ou tira item do plano.
 *
 * `aplicarMinimoNoEstoque` leva o mínimo aprovado para
 * `sup_estoque_item.estoque_minimo`, que é o número que dispara aviso de
 * reposição na operação do almoxarifado. Fica em falso por padrão de
 * propósito: é a única coisa aqui que muda o comportamento de OUTRA tela, e
 * tem de ser escolha consciente de quem clica.
 */
export function useSalvarPoliticaEstoque(empresaId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (p: { linhas: LinhaPolitica[]; aplicarMinimoNoEstoque?: boolean }) => {
      const cliente = supabase as unknown as ClienteRpc;
      const { data, error } = await cliente.rpc("sup_estoque_politica_salvar", {
        p_empresa_id: empresaId,
        p_linhas: p.linhas,
        p_aplicar_minimo_no_estoque: p.aplicarMinimoNoEstoque ?? false,
      });
      if (error) throw error;
      return data as { gravadas: number; minimos_aplicados: number; por: string; em: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CHAVE] });
      // O mínimo aplicado muda a tela de Estoque, que tem cache próprio.
      queryClient.invalidateQueries({ queryKey: ["sup_estoque"] });
    },
  });
}

/** Muda as premissas da conta (prazo, nível de serviço, ciclo, janela). */
export function useSalvarPremissasEstoque(empresaId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      payload: Record<string, number>;
      tipoItem?: string | null;
    }) => {
      const cliente = supabase as unknown as ClienteRpc;
      const { data, error } = await cliente.rpc("sup_estoque_parametro_salvar", {
        p_empresa_id: empresaId,
        p_payload: p.payload,
        p_tipo_item: p.tipoItem ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [CHAVE] }),
  });
}

/**
 * Fecha o mês à mão. O normal é o pg_cron rodar no dia 1º
 * (`sup_estoque_fechamento_mensal`); este botão existe para começar o
 * histórico sem esperar a virada, e para refazer um mês depois de acerto de
 * inventário.
 */
export function useFecharMesEstoque(empresaId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (competencia?: string | null) => {
      const cliente = supabase as unknown as ClienteRpc;
      const { data, error } = await cliente.rpc("sup_estoque_snapshot_gravar", {
        p_empresa_id: empresaId,
        p_competencia: competencia ?? null,
      });
      if (error) throw error;
      return data as { competencia: string; empresas: number; linhas: number };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [CHAVE] }),
  });
}

export type MsgIaEstoque = { role: "user" | "assistant"; content: string };

/**
 * Análise ("analise") ou pergunta livre ("pergunta") sobre o painel.
 *
 * Os números NÃO vão no corpo: a Edge Function relê o painel pela mesma RPC,
 * com o JWT de quem pediu. Então a IA enxerga exatamente o que a pessoa
 * enxerga, e ninguém planta dado na análise.
 */
export function useAnaliseEstoqueIA() {
  return useMutation({
    mutationFn: async (p: {
      empresaId: string;
      janelaMeses?: number | null;
      contratoId?: string | null;
      categoria?: string | null;
      almoxarifadoId?: string | null;
      modo: "analise" | "pergunta";
      pergunta?: string;
      historico?: MsgIaEstoque[];
    }) => {
      const { data, error } = await supabase.functions.invoke("sup-estoque-ia", { body: p });
      if (error) {
        // A Edge devolve { error } com status != 2xx — tira a mensagem dela.
        let msg = error.message;
        try {
          const corpo = await (error as { context?: Response }).context?.json();
          if (corpo?.error) msg = corpo.error;
        } catch {
          /* sem corpo */
        }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      return String(data?.texto ?? "");
    },
  });
}
