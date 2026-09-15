// Diagnóstico por IA de QUALQUER formulário (15/09/2026) — irmão do
// useDiagnosticoFeedback. Mesma Edge Function de arquitetura (agregado anônimo
// no servidor, RLS do usuário), mesma tabela CS_FORM_DIAGNOSTICOS com
// tipo = 'formulario'. Setor é opcional: vazio = todas as respostas visíveis.
import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ForcaDiagnostico } from "@/hooks/useDiagnosticoFeedback";

export interface DiagnosticoFormulario {
  titulo: string;
  setor: string;
  qtd_respostas: number;
  resumo: string;
  pontos_fortes: { tema: string; evidencia: string; forca: ForcaDiagnostico }[];
  pontos_de_atencao: { tema: string; evidencia: string; forca: ForcaDiagnostico }[];
  leitura_por_pergunta: { pergunta: string; leitura: string }[];
  plano_de_acao: { acao: string; porque: string; prazo_sugerido_dias: number; prioridade: ForcaDiagnostico }[];
}

export interface DiagnosticoFormularioSalvo extends DiagnosticoFormulario {
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
  conteudo?: DiagnosticoFormulario;
}

const daLinha = (linha: LinhaDiagnostico): DiagnosticoFormularioSalvo => ({
  ...(linha.conteudo as DiagnosticoFormulario),
  id: linha.id,
  formulario_id: linha.formulario_id,
  setor: linha.setor ?? linha.conteudo?.setor ?? "",
  setor_norm: linha.setor_norm,
  gerado_em: linha.gerado_em,
  gerado_por_nome: linha.gerado_por_nome,
  qtd_respostas: Number(linha.qtd_respostas ?? linha.conteudo?.qtd_respostas ?? 0),
  modelo: linha.modelo,
});

export function useDiagnosticoFormulario() {
  const [data, setData] = useState<DiagnosticoFormularioSalvo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requisicaoAtual = useRef(0);

  const run = useCallback(async (formularioId: string, setor: string) => {
    const requisicao = ++requisicaoAtual.current;
    setLoading(true);
    setError(null);
    try {
      const { data: resposta, error: erro } = await supabase.functions.invoke("diagnostico-formulario-ia", {
        body: { formulario_id: formularioId, setor },
      });
      if (erro) throw new Error(await mensagemErroFuncao(erro, "Falha ao gerar diagnóstico."));
      const erroResposta = (resposta as { error?: unknown } | null)?.error;
      if (erroResposta) throw new Error(String(erroResposta));
      const diagnostico = resposta as DiagnosticoFormularioSalvo;
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
      const { data: linha, error: erro } = await (supabase as any)
        .from("CS_FORM_DIAGNOSTICOS")
        .select("id, formulario_id, setor, setor_norm, gerado_em, gerado_por_nome, qtd_respostas, modelo, conteudo")
        .eq("formulario_id", formularioId)
        .eq("tipo", "formulario")
        .eq("setor_norm", setorNorm)
        .order("gerado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (erro) throw erro;
      const diagnostico = linha ? daLinha(linha as LinhaDiagnostico) : null;
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
