import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ForcaDiagnostico = "Alta" | "Média" | "Baixa";

export interface DiagnosticoFeedback {
  setor: string;
  qtd_respostas: number;
  liderados_para_lider: { tema: string; evidencia: string; forca: ForcaDiagnostico }[];
  lider_para_liderados: { tema: string; evidencia: string; forca: ForcaDiagnostico }[];
  convergencias: { tema: string; leitura: string }[];
  plano_de_acao: {
    acao: string;
    porque: string;
    prazo_sugerido_dias: number;
    prioridade: ForcaDiagnostico;
  }[];
}

export interface DiagnosticoFeedbackSalvo extends DiagnosticoFeedback {
  id?: string;
  formulario_id?: string;
  setor_norm?: string;
  gerado_em?: string;
  gerado_por_nome?: string | null;
  modelo?: string | null;
}

interface ErroComResposta { context?: Response; message?: string }

const mensagemDeErro = (erro: unknown, padrao: string): string =>
  erro instanceof Error ? erro.message : (erro as { message?: string } | null)?.message || padrao;

const mensagemErroFuncao = async (erro: unknown, padrao: string): Promise<string> => {
  const detalhe = erro as ErroComResposta | null;
  try {
    const resposta = detalhe?.context;
    if (resposta && typeof resposta.clone === "function") {
      const corpo = await resposta.clone().json() as { error?: unknown };
      if (corpo?.error) return String(corpo.error);
    }
  } catch { /* a mensagem padrão abaixo ainda é útil */ }
  return detalhe?.message || padrao;
};

interface LinhaDiagnostico {
  id?: string;
  formulario_id?: string;
  setor?: string;
  setor_norm?: string;
  gerado_em?: string;
  gerado_por_nome?: string | null;
  qtd_respostas?: number;
  modelo?: string | null;
  conteudo?: DiagnosticoFeedback;
}

interface ConsultaDiagnostico {
  select(colunas: string): ConsultaDiagnostico;
  eq(coluna: string, valor: string): ConsultaDiagnostico;
  order(coluna: string, opcoes: { ascending: boolean }): ConsultaDiagnostico;
  limit(qtd: number): ConsultaDiagnostico;
  maybeSingle(): Promise<{ data: LinhaDiagnostico | null; error: unknown }>;
}

const daLinha = (linha: LinhaDiagnostico): DiagnosticoFeedbackSalvo => ({
  ...(linha.conteudo as DiagnosticoFeedback),
  id: linha.id,
  formulario_id: linha.formulario_id,
  setor: linha.setor ?? linha.conteudo?.setor ?? "",
  setor_norm: linha.setor_norm,
  gerado_em: linha.gerado_em,
  gerado_por_nome: linha.gerado_por_nome,
  qtd_respostas: Number(linha.qtd_respostas ?? linha.conteudo?.qtd_respostas ?? 0),
  modelo: linha.modelo,
});

export function useDiagnosticoFeedback() {
  const [data, setData] = useState<DiagnosticoFeedbackSalvo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requisicaoAtual = useRef(0);

  const run = useCallback(async (formularioId: string, setor: string) => {
    const requisicao = ++requisicaoAtual.current;
    setLoading(true);
    setError(null);
    try {
      const { data: resposta, error: erro } = await supabase.functions.invoke("diagnostico-feedback-ia", {
        body: { formulario_id: formularioId, setor },
      });
      if (erro) throw new Error(await mensagemErroFuncao(erro, "Falha ao gerar diagnóstico."));
      const erroResposta = (resposta as { error?: unknown } | null)?.error;
      if (erroResposta) throw new Error(String(erroResposta));
      const diagnostico = resposta as DiagnosticoFeedbackSalvo;
      if (requisicao === requisicaoAtual.current) setData(diagnostico);
      return diagnostico;
    } catch (e: unknown) {
      const msg = mensagemDeErro(e, "Não foi possível gerar o diagnóstico agora. Tente novamente.");
      if (requisicao === requisicaoAtual.current) setError(msg);
      return null;
    } finally {
      if (requisicao === requisicaoAtual.current) setLoading(false);
    }
  }, []);

  const carregarUltimo = useCallback(async (formularioId: string, setorNorm: string) => {
    const requisicao = ++requisicaoAtual.current;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const banco = supabase as unknown as { from(tabela: string): ConsultaDiagnostico };
      const { data: linha, error: erro } = await banco
        .from("CS_FORM_DIAGNOSTICOS")
        .select("id, formulario_id, setor, setor_norm, gerado_em, gerado_por_nome, qtd_respostas, modelo, conteudo")
        .eq("formulario_id", formularioId)
        .eq("setor_norm", setorNorm)
        .order("gerado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (erro) throw erro;
      const diagnostico = linha ? daLinha(linha) : null;
      if (requisicao === requisicaoAtual.current) setData(diagnostico);
      return diagnostico;
    } catch (e: unknown) {
      const msg = mensagemDeErro(e, "Não foi possível carregar o último diagnóstico.");
      if (requisicao === requisicaoAtual.current) setError(msg);
      return null;
    } finally {
      if (requisicao === requisicaoAtual.current) setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    requisicaoAtual.current += 1;
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { data, loading, error, run, reset, carregarUltimo };
}
