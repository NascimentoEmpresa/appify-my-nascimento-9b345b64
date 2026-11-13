import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useChecklistItems, useImplantacaoContratos, useRespostas } from "@/hooks/useImplantacao";
import { resumoResposta } from "@/lib/implantacao/camposResposta";
import { CHAVE_CONFIRMACAO_NOTIF } from "@/hooks/useImplantacaoConfirmacaoNotif";
import {
  montarPainel,
  valorLegivel,
  type ConfirmacaoPainel,
} from "@/lib/implantacao/painelSetores";

// =====================================================================
// Painel da Implantação por setor. Lê o MESMO cache do formulário
// (["checklist-items"] e ["respostas", contratoId]): salvar uma resposta na
// tela de Implantação invalida essa chave e o painel se recalcula sozinho,
// sem lançamento novo. Sem polling — regra de 03/11/2026
// (src/lib/atualizarTela.ts): dado de outra pessoa chega ao abrir a tela ou
// no botão "Atualizar" do topo.
// =====================================================================

export interface ConfirmacaoSetor extends ConfirmacaoPainel {
  id: string;
  contrato_id: string;
}

// Tabela fora dos tipos gerados (types.ts não é regenerado no CI): cliente
// mínimo tipado só com o que esta tela usa, em vez de `as any`.
type Erro = { message: string } | null;
type ClienteConfirmacao = {
  from: (tabela: "IMPLANTACAO_SETOR_CONFIRMACAO") => {
    select: (colunas: string) => {
      eq: (coluna: "contrato_id", valor: string) => Promise<{ data: ConfirmacaoSetor[] | null; error: Erro }>;
    };
    upsert: (
      linha: { contrato_id: string; setor: string; assinatura: string },
      opts: { onConflict: string },
    ) => Promise<{ error: Erro }>;
    delete: () => {
      eq: (coluna: "contrato_id", valor: string) => {
        eq: (coluna: "setor", valor: string) => Promise<{ error: Erro }>;
      };
    };
  };
};
const cliente = supabase as unknown as ClienteConfirmacao;

const CHAVE_CONFIRMACOES = "implantacao-setor-confirmacao";

export function useConfirmacoesSetor(contratoId: string | null) {
  return useQuery({
    queryKey: [CHAVE_CONFIRMACOES, contratoId],
    enabled: !!contratoId,
    queryFn: async () => {
      const { data, error } = await cliente
        .from("IMPLANTACAO_SETOR_CONFIRMACAO")
        .select("id, contrato_id, setor, assinatura, confirmado_por, confirmado_em")
        .eq("contrato_id", contratoId!);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useConfirmarSetor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { contratoId: string; setor: string; assinatura: string }) => {
      // confirmado_por/confirmado_em são carimbados pelo gatilho no banco.
      const { error } = await cliente
        .from("IMPLANTACAO_SETOR_CONFIRMACAO")
        .upsert(
          { contrato_id: v.contratoId, setor: v.setor, assinatura: v.assinatura },
          { onConflict: "contrato_id,setor" },
        );
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: [CHAVE_CONFIRMACOES, v.contratoId] });
      // Apaga a bolinha do menu na hora (useImplantacaoConfirmacaoNotif).
      qc.invalidateQueries({ queryKey: [CHAVE_CONFIRMACAO_NOTIF] });
      toast({ title: `Recebimento confirmado — ${v.setor}` });
    },
    onError: (e: Error) => toast({ title: "Erro ao confirmar", description: e.message, variant: "destructive" }),
  });
}

export function useDesfazerConfirmacaoSetor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { contratoId: string; setor: string }) => {
      const { error } = await cliente
        .from("IMPLANTACAO_SETOR_CONFIRMACAO")
        .delete()
        .eq("contrato_id", v.contratoId)
        .eq("setor", v.setor);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: [CHAVE_CONFIRMACOES, v.contratoId] });
      qc.invalidateQueries({ queryKey: [CHAVE_CONFIRMACAO_NOTIF] });
    },
    onError: (e: Error) => toast({ title: "Erro ao desfazer", description: e.message, variant: "destructive" }),
  });
}

/** Resumo de resposta igual ao da linha fechada do formulário. */
function resumir(rowIndex: number, valor: string): string {
  return valorLegivel(resumoResposta(rowIndex, valor));
}

/** Tudo que o resumo geral e a página do setor precisam, para um contrato. */
export function usePainelImplantacao(contratoIdEscolhido: string | null) {
  const contratosQ = useImplantacaoContratos(null, { todasEmpresas: true });
  const itensQ = useChecklistItems();
  const contratos = contratosQ.data ?? [];
  const contrato = contratos.find((c) => c.id === contratoIdEscolhido) ?? contratos[0] ?? null;
  const respostasQ = useRespostas(contrato?.id ?? null, contrato?.empresa_id ?? null);
  const confirmacoesQ = useConfirmacoesSetor(contrato?.id ?? null);

  const itens = itensQ.data;
  const respostas = respostasQ.data;
  const confirmacoes = confirmacoesQ.data;
  const painel = useMemo(
    () => montarPainel(itens ?? [], respostas ?? [], confirmacoes ?? [], resumir),
    [itens, respostas, confirmacoes],
  );

  return {
    contratos,
    contrato,
    itens: itens ?? [],
    painel,
    carregando: contratosQ.isLoading || itensQ.isLoading || respostasQ.isLoading || confirmacoesQ.isLoading,
    erro: (contratosQ.error ?? itensQ.error ?? respostasQ.error ?? confirmacoesQ.error) as Error | null,
  };
}
