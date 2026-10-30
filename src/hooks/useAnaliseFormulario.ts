import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  linhasDoFormulario, type Filtro, type LinhaResposta, type LinhaTurnover,
} from "../../supabase/functions/_shared/pesquisa-permanencia";

// Formulários › Rotatividade, Plano de ação e Assistente de I.A
// (mig 20261030001000). Era o hook do módulo RH › Pesquisa de Permanência
// (mig 20261028001200), que virou um formulário. As respostas vêm direto de
// CS_FORM_RESPOSTAS — a RLS do Formulários decide o que a pessoa vê, como na
// tela de Respostas; rotatividade e plano de ação passam pelas RPCs, que
// cobram a capacidade "rotatividade". As contas ficam no _shared, iguais às da
// Edge Function formulario-assistente-ia.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export interface FormularioAnalise {
  id: string; titulo: string; slug: string;
  perguntas: { id: string; tipo: string; titulo: string; config?: Record<string, unknown> | null }[];
}
export interface PlanoFormulario {
  id: string; titulo: string | null; status: string; prioridade: string | null; prazo: string | null;
  responsavel: string | null; created_at: string; formulario_id: string | null;
  empresa: number | null; filial: number | null; contrato: string | null;
  posto: string | null; posto_nome: string | null; funcao: string | null; motivo: string | null;
}

const K = ["formulario-analise"];

export const useFormularioAnalise = (id: string | undefined) => useQuery({
  queryKey: [...K, "form", id], enabled: !!id, staleTime: 5 * 60_000,
  queryFn: async (): Promise<FormularioAnalise | null> => {
    const { data, error } = await sb.from("CS_FORMULARIOS").select("id, titulo, slug, perguntas").eq("id", id).is("deleted_at", null).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { ...data, perguntas: Array.isArray(data.perguntas) ? data.perguntas : [] } : null;
  },
});

/** As respostas visíveis, já na forma dos relatórios (só o mês, nada de quem respondeu). */
export const useRespostasAnalise = (form: FormularioAnalise | null | undefined) => useQuery({
  queryKey: [...K, "respostas", form?.id], enabled: !!form, staleTime: 2 * 60_000,
  queryFn: async (): Promise<LinhaResposta[]> => {
    const linhas: { formulario_id: string; enviado_em: string; itens: Record<string, unknown> | null }[] = [];
    // Paginado: o PostgREST corta em 1000 linhas.
    for (let ini = 0; ; ini += 1000) {
      const { data, error } = await sb.from("CS_FORM_RESPOSTAS").select("id, formulario_id, enviado_em, itens")
        .eq("formulario_id", form!.id).order("id", { ascending: true }).range(ini, ini + 999);
      if (error) throw new Error(error.message);
      linhas.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    return linhasDoFormulario(form!.perguntas, linhas);
  },
});

export const useRotatividade = (meses = 12, enabled = true) => useQuery({
  queryKey: [...K, "rotatividade", meses], enabled, staleTime: 10 * 60_000,
  queryFn: async (): Promise<{ meses: string[]; linhas: LinhaTurnover[] }> => {
    const { data, error } = await sb.rpc("cs_form_rotatividade", { p_meses: meses });
    if (error) throw new Error(error.message);
    return { meses: data?.meses ?? [], linhas: data?.linhas ?? [] };
  },
});

export const usePlanosFormulario = (formularioId: string | undefined, enabled = true) => useQuery({
  queryKey: [...K, "planos", formularioId], enabled: enabled && !!formularioId, staleTime: 60_000,
  queryFn: async (): Promise<PlanoFormulario[]> => {
    const { data, error } = await sb.rpc("cs_form_planos", { p_formulario: formularioId });
    if (error) throw new Error(error.message);
    return (data ?? []) as PlanoFormulario[];
  },
});

/** Recorte de onde a ação nasceu (contrato/posto/função das respostas). */
export interface OrigemPlano {
  formulario_id: string; empresa: number | null; filial: number | null; contrato: string | null;
  posto: string | null; posto_nome: string | null; funcao: string | null; motivo: string;
}

/**
 * Cria a ação pelo criar_plano_acao de sempre (Plano de Ações — mesma regra e
 * permissão da tela de lá) e registra a origem no formulário.
 */
export function useCriarPlanoFormulario(tituloFormulario: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      empresaId: string; titulo: string; problema: string; acao: string; area: string | null;
      prioridade: string; responsavel: string; prazo: string | null; origem: OrigemPlano;
    }) => {
      const { data: id, error } = await sb.rpc("criar_plano_acao", {
        _empresa_id: p.empresaId, _titulo: p.titulo, _problema: p.problema || null, _acao: p.acao || null,
        _area: p.area, _setor: p.area, _prioridade_normalizada: p.prioridade, _status_normalizado: "a_definir",
        _responsavel_profile_id: p.responsavel, _data_inicio_planejado: new Date().toISOString().slice(0, 10),
        _data_fim_planejado: p.prazo, _visibilidade: "publico",
        _comentarios: `Gerado pelo formulário "${tituloFormulario}". ${p.origem.motivo}`.slice(0, 1000),
      });
      if (error) throw new Error(error.message);
      const o = p.origem;
      const { error: e2 } = await sb.rpc("cs_form_plano_vincular", {
        p_plano: id, p_formulario: o.formulario_id, p_empresa: o.empresa, p_filial: o.filial, p_contrato: o.contrato,
        p_posto: o.posto, p_posto_nome: o.posto_nome, p_funcao: o.funcao, p_motivo: o.motivo,
      });
      if (e2) throw new Error(`A ação foi criada no Plano de Ações, mas não ficou ligada ao formulário: ${e2.message}`);
      return id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...K, "planos"] }),
  });
}

export type MsgIA = { role: "user" | "assistant"; content: string };

export async function perguntarIA(p: {
  formularioId: string; modo: "analise" | "pergunta"; pergunta?: string; historico?: MsgIA[]; filtro?: Filtro;
}): Promise<string> {
  const { data, error } = await supabase.functions.invoke("formulario-assistente-ia", {
    body: { formulario_id: p.formularioId, modo: p.modo, pergunta: p.pergunta, historico: p.historico, filtro: p.filtro },
  });
  if (error) {
    // A mensagem útil vem no corpo (403 sem acesso, 429 sem tokens).
    const ctx = (error as { context?: Response }).context;
    const corpo = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
    throw new Error(corpo?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return String(data?.texto ?? "");
}
