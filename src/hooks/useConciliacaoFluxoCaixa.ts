import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PlanilhaRow } from "@/lib/conciliacaoBancariaEngine";
import type { FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";

// SIS-2026-0492: conciliação automática — o lado "Fluxo" vem direto do
// Fluxo de Caixa interno (useFluxoCaixaCombinado), não de planilha subida.
// Este adaptador é o único ponto de contato entre os dois mundos: reusa o
// motor de comparação (`reconciliar`) sem duplicar o algoritmo.
export function linhasFluxoParaPlanilhaRow(linhas: FluxoCaixaMaloteLinha[]): PlanilhaRow[] {
  return linhas.map((l) => ({
    dia: l.data_pagamento ?? "",
    valor: l.valor,
    tipo: l.tipo === "entrada" ? "ENTRADA" : "SAÍDA",
    banco: l.banco_nome ?? "—",
    despesaId: l.despesa_id,
    numeroParcela: l.numero_parcela,
    origemFluxo: l.origem,
    empresaNome: l.empresa_nome,
  }));
}

export interface ConciliacaoFluxoCaixaSalva {
  id: string;
  data_inicio: string;
  data_fim: string;
  observacoes: string | null;
  total_linhas: number;
  linhas_ajustadas: number;
  linhas_criadas: number;
  linhas_ignoradas: number;
  created_by: string | null;
  created_at: string;
}

export interface ConciliacaoFluxoCaixaArquivo {
  id: string;
  conciliacao_id: string;
  nome_arquivo: string;
  storage_path: string;
  created_at: string;
}

export interface ConciliacaoFluxoCaixaLinha {
  id: string;
  conciliacao_id: string;
  dia: string;
  origem: "fluxo" | "extrato";
  tipo: "entrada" | "saida";
  valor: number;
  descricao: string | null;
  banco: string | null;
  status: "ok" | "ajustado" | "ignorado" | "criado";
  observacao: string | null;
  despesa_id: string | null;
  numero_parcela: number | null;
}

const BUCKET = "conciliacao-fluxo-caixa";
const KEY = "conciliacao_fluxo_caixa";

export function useConciliacoesFluxoCaixaSalvas() {
  return useQuery({
    queryKey: [KEY, "lista"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("financeiro_conciliacao_fluxo_caixa")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConciliacaoFluxoCaixaSalva[];
    },
  });
}

export function useConciliacaoFluxoCaixaDetalhe(id: string | null) {
  return useQuery({
    queryKey: [KEY, "detalhe", id],
    enabled: !!id,
    queryFn: async () => {
      const [linhas, arquivos] = await Promise.all([
        (supabase as any)
          .from("financeiro_conciliacao_fluxo_caixa_linha")
          .select("*")
          .eq("conciliacao_id", id)
          .order("dia"),
        (supabase as any)
          .from("financeiro_conciliacao_fluxo_caixa_arquivo")
          .select("*")
          .eq("conciliacao_id", id),
      ]);
      if (linhas.error) throw linhas.error;
      if (arquivos.error) throw arquivos.error;

      const arquivosComUrl = await Promise.all(
        ((arquivos.data ?? []) as ConciliacaoFluxoCaixaArquivo[]).map(async (a) => {
          const { data } = await supabase.storage.from(BUCKET).createSignedUrl(a.storage_path, 3600);
          return { ...a, url: data?.signedUrl ?? null };
        })
      );

      return {
        linhas: (linhas.data ?? []) as ConciliacaoFluxoCaixaLinha[],
        arquivos: arquivosComUrl,
      };
    },
  });
}

export interface SalvarConciliacaoInput {
  dataInicio: string;
  dataFim: string;
  observacoes: string | null;
  arquivosOfx: File[];
  linhas: Omit<ConciliacaoFluxoCaixaLinha, "id" | "conciliacao_id">[];
}

// Só é chamada quando 100% das linhas já estão ok/ajustado/ignorado/criado
// (decisão do usuário — a tela não deixa salvar com pendência em aberto).
export function useSalvarConciliacaoFluxoCaixa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarConciliacaoInput) => {
      const contagem = { ajustado: 0, criado: 0, ignorado: 0 };
      for (const l of input.linhas) {
        if (l.status === "ajustado") contagem.ajustado++;
        else if (l.status === "criado") contagem.criado++;
        else if (l.status === "ignorado") contagem.ignorado++;
      }

      const { data: conciliacao, error: errHeader } = await (supabase as any)
        .from("financeiro_conciliacao_fluxo_caixa")
        .insert({
          data_inicio: input.dataInicio,
          data_fim: input.dataFim,
          observacoes: input.observacoes,
          total_linhas: input.linhas.length,
          linhas_ajustadas: contagem.ajustado,
          linhas_criadas: contagem.criado,
          linhas_ignoradas: contagem.ignorado,
        })
        .select("id")
        .single();
      if (errHeader) throw errHeader;
      const conciliacaoId = conciliacao.id as string;

      if (input.linhas.length) {
        const { error: errLinhas } = await (supabase as any)
          .from("financeiro_conciliacao_fluxo_caixa_linha")
          .insert(input.linhas.map((l) => ({ ...l, conciliacao_id: conciliacaoId })));
        if (errLinhas) throw errLinhas;
      }

      for (const arquivo of input.arquivosOfx) {
        const path = `${conciliacaoId}/${Date.now()}_${arquivo.name}`;
        const { error: errUpload } = await supabase.storage.from(BUCKET).upload(path, arquivo);
        if (errUpload) throw new Error(`Arquivo ${arquivo.name}: ${errUpload.message}`);
        const { error: errArquivo } = await (supabase as any)
          .from("financeiro_conciliacao_fluxo_caixa_arquivo")
          .insert({ conciliacao_id: conciliacaoId, nome_arquivo: arquivo.name, storage_path: path });
        if (errArquivo) throw errArquivo;
      }

      return conciliacaoId;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
