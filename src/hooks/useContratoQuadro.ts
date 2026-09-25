import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

// `CONTRATO_QUADRO_POSTO` e as RPCs do quadro não estão no types.ts gerado
// pelo Lovable — mesmo escape de useContratosERP.ts e useSupCatalogo.ts.
const sb = supabase as any;

/** Uma linha do quadro como a RPC `contrato_quadro_listar` devolve. */
export interface LinhaQuadro {
  id: string;
  contrato_id: string;
  posto_nome: string;
  sup_posto_id: string | null;
  cargo: string;
  quantidade: number;
  escala: string;
  horario: string | null;
  salario: number;
  insalubridade_pct: number;
  periculosidade_pct: number;
  beneficios: string | null;
  estado: string;
  cidade: string;
  local_exato: string;
  data_inicio_prevista: string;
  motivo_vaga: string;
  req_obrigatorios: string | null;
  req_desejaveis: string | null;
  exp_minima: string;
  exp_minima_qual: string | null;
  observacao: string | null;
  gerar_vagas: boolean;
  ordem: number;
  /** Quantas vagas já nasceram desta linha — inclusive as reprovadas. */
  vagas_geradas: number;
  /** As que ainda contam como reposição (fora Reprovada/Cancelada). */
  vagas_vivas: number;
  /** O posto existe na Planilha de Custo vigente do contrato? */
  na_planilha: boolean;
}

/** O que a geração de vagas devolve, por posto. */
export interface ResultadoGeracao {
  posto_nome: string;
  criadas: number;
  ja_existiam: number;
  primeira_vaga: number | null;
}

export function useContratoQuadro(contratoId: string | null) {
  return useQuery({
    queryKey: ["contrato_quadro", contratoId],
    enabled: !!contratoId,
    // staleTime 0: quem acabou de gerar as vagas volta pra cá esperando ver
    // a contagem nova ("10 de 10 geradas"), não a de antes de clicar.
    staleTime: 0,
    queryFn: async (): Promise<LinhaQuadro[]> => {
      const { data, error } = await sb.rpc("contrato_quadro_listar", {
        p_contrato_id: contratoId,
      });
      if (error) throw error;
      return (data ?? []) as LinhaQuadro[];
    },
  });
}

export function useContratoQuadroSalvar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contratoId, linhas }: { contratoId: string; linhas: unknown[] }) => {
      const { data, error } = await sb.rpc("contrato_quadro_salvar", {
        p_contrato_id: contratoId,
        p_linhas: linhas,
      });
      if (error) throw error;
      return (data ?? 0) as number;
    },
    onSuccess: (_n, v) => {
      qc.invalidateQueries({ queryKey: ["contrato_quadro", v.contratoId] });
      // O quadro escreve em sup_posto (o espelho do posto). A cascata do
      // Catálogo de Materiais e o vínculo da vaga leem de lá — sem isto o
      // posto novo só apareceria depois de recarregar a página.
      qc.invalidateQueries({ queryKey: ["sup_posto"] });
    },
    onError: (e: Error) =>
      toast({ title: "Erro ao salvar o quadro de postos", description: e.message, variant: "destructive" }),
  });
}

/**
 * Abre as vagas do quadro.
 *
 * `simular: true` não grava nada — devolve quantas vagas sairiam por posto.
 * É o que a tela usa para perguntar "vão ser criadas 30 solicitações,
 * confirma?" antes de criar, em vez de criar e avisar depois.
 */
export function useContratoQuadroGerarVagas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contratoId, simular = false }: { contratoId: string; simular?: boolean }) => {
      const { data, error } = await sb.rpc("contrato_quadro_gerar_vagas", {
        p_contrato_id: contratoId,
        p_simular: simular,
      });
      if (error) throw error;
      return (data ?? []) as ResultadoGeracao[];
    },
    onSuccess: (_r, v) => {
      if (v.simular) return;
      qc.invalidateQueries({ queryKey: ["contrato_quadro", v.contratoId] });
      // As telas do Recrutamento (gestão, analistas, minhas solicitações)
      // leem SISTEMA_RECRUTAMENTO por chaves próprias; invalidar por prefixo
      // pega todas sem este arquivo precisar conhecer cada uma.
      qc.invalidateQueries({ queryKey: ["recrutamento"] });
      qc.invalidateQueries({ queryKey: ["vagas"] });
    },
    onError: (e: Error) =>
      toast({ title: "Erro ao abrir as vagas", description: e.message, variant: "destructive" }),
  });
}

/** Total de vagas criadas num resultado de geração. */
export const somarCriadas = (r: ResultadoGeracao[]): number =>
  r.reduce((s, x) => s + (Number(x.criadas) || 0), 0);
