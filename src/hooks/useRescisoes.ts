import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { emLotes } from "@/lib/emLotes";
import {
  STATUS_CANCELAMENTO_SOLICITADO, STATUS_SST_AGENDADO, STATUS_SST_ASO_VALIDO, STATUS_SST_RECEBIDA,
  TABELA as TABELA_SOLICITACOES, type SolicitacaoDemissao,
} from "@/lib/demissao/solicitacao";
import {
  TABELA_RESCISAO, montarLinhasRescisao,
  type LinhaRescisao, type RescisaoRH, type VinculoEmpregado,
} from "@/lib/demissao/rescisao";

// RH_RESCISAO, a solicitação e EMPREGADOS fora do types.ts gerado — mesmo padrão do PainelDemissoes.
const sb = supabase as unknown as SupabaseClient;

/**
 * Os dados de Recursos Humanos › Rescisões: as linhas da RH_RESCISAO (do
 * ERP, importadas da planilha e lançadas à mão) + a solicitação de cada
 * linha do ERP, juntas em `montarLinhasRescisao`.
 *
 * Desde 22/10/2026 (mig 20261022000400) a linha do ERP nasce no banco quando
 * o RH libera a demissão — a solicitação aqui só completa (status do fluxo,
 * link). Por isso o recorte é "do RH em diante", sem o Pendente RH: o que o
 * RH ainda não liberou não é rescisão.
 */
export const STATUS_SOLICITACAO_NA_RESCISAO = [
  STATUS_CANCELAMENTO_SOLICITADO, "Pendente SST", STATUS_SST_RECEBIDA,
  STATUS_SST_AGENDADO, STATUS_SST_ASO_VALIDO, "Concluída", "Cancelada",
];

const PAGINA = 1000; // teto de linhas por resposta do PostgREST

async function lerTudo<T>(montar: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await montar(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    todas.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGINA) return todas;
  }
}

/** Empresa + matrícula de quem está nas solicitações (EMPREGADOS), em lotes por causa do limite de URL do cluster. */
async function buscarEmpregados(ids: number[]): Promise<Map<number, VinculoEmpregado>> {
  const unicos = [...new Set(ids)].map(String);
  if (!unicos.length) return new Map();
  const rows = await emLotes<{ ID: number; Cadastro: unknown; Empresa: unknown }>(unicos, 40,
    (lote) => sb.from("EMPREGADOS").select("ID,Cadastro,Empresa").in("ID", lote), 4);
  return new Map(rows.map((r) => [Number(r.ID), {
    empresa: r.Empresa == null ? null : String(r.Empresa),
    matricula: r.Cadastro == null ? null : String(r.Cadastro),
  }]));
}

export function useRescisoes() {
  const { user } = useAuth();
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoDemissao[]>([]);
  const [rescisoes, setRescisoes] = useState<RescisaoRH[]>([]);
  const [empregados, setEmpregados] = useState<Map<number, VinculoEmpregado>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      // Em paralelo: as duas listas não dependem uma da outra.
      const [sols, rescs] = await Promise.all([
        lerTudo<SolicitacaoDemissao>((de, ate) => sb.from(TABELA_SOLICITACOES).select("*")
          .in("status", STATUS_SOLICITACAO_NA_RESCISAO).order("id", { ascending: false }).range(de, ate)),
        lerTudo<RescisaoRH>((de, ate) => sb.from(TABELA_RESCISAO).select("*").order("id").range(de, ate)),
      ]);
      setSolicitacoes(sols);
      setRescisoes(rescs);
      setCarregando(false);
      // Empresa/matrícula chegam depois — a tela já abre sem elas.
      buscarEmpregados(sols.map((s) => s.colaborador_id).filter((v): v is number => v != null))
        .then(setEmpregados)
        .catch((e) => console.warn("EMPREGADOS (empresa/matrícula):", e));
    } catch (e) {
      setErro((e as Error).message);
      setCarregando(false);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  // Quem lançou: o nome que fica gravado na ficha (e no histórico do kanban).
  const [quemSou, setQuemSou] = useState("");
  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("display_name, email").eq("id", user.id).maybeSingle()
      .then(({ data }) => setQuemSou(data?.display_name ?? data?.email ?? user.email ?? ""));
  }, [user?.id, user?.email]);

  const linhas = useMemo(() => montarLinhasRescisao(solicitacoes, rescisoes, empregados), [solicitacoes, rescisoes, empregados]);

  /** Grava na linha (toda linha da tela já existe no banco desde a mig 20261022000400). */
  const salvar = useCallback(async (l: LinhaRescisao, dados: Partial<RescisaoRH>): Promise<RescisaoRH> => {
    if (!l.rescisao) throw new Error("Linha sem registro de rescisão — atualize a tela.");
    const { data, error } = await sb.from(TABELA_RESCISAO)
      .update({ ...dados, atualizado_por: quemSou || null }).eq("id", l.rescisao.id).select().single();
    if (error) throw new Error(error.message);
    const nova = data as RescisaoRH;
    setRescisoes((rs) => rs.map((r) => (r.id === nova.id ? nova : r)));
    return nova;
  }, [quemSou]);

  /**
   * Editar uma célula da planilha: muda NA HORA (otimista) e volta se o
   * banco recusar — esperar o servidor a cada célula é o que deixa uma
   * planilha de 1.100 linhas "pesada".
   */
  const atualizar = useCallback(async (l: LinhaRescisao, dados: Partial<RescisaoRH>) => {
    if (!l.rescisao) throw new Error("Linha sem registro de rescisão — atualize a tela.");
    const antes = l.rescisao;
    const mudouStatus = dados.status_rescisao != null && dados.status_rescisao !== antes.status_rescisao;
    setRescisoes((rs) => rs.map((r) => (r.id === antes.id
      ? { ...r, ...dados, ...(mudouStatus ? { status_desde: new Date().toISOString() } : {}) } : r)));
    try { await salvar(l, dados); } catch (e) {
      setRescisoes((rs) => rs.map((r) => (r.id === antes.id ? antes : r)));
      throw e;
    }
  }, [salvar]);

  /** Rescisão lançada à mão (a linha que o RH digitava na planilha, sem solicitação). */
  const criarManual = useCallback(async (dados: Partial<RescisaoRH>): Promise<RescisaoRH> => {
    const { data, error } = await sb.from(TABELA_RESCISAO)
      .insert({ ...dados, origem: "manual", atualizado_por: quemSou || null }).select().single();
    if (error) throw new Error(error.message);
    const nova = data as RescisaoRH;
    setRescisoes((rs) => [...rs, nova]);
    return nova;
  }, [quemSou]);

  const excluir = useCallback(async (r: RescisaoRH) => {
    const { error } = await sb.from(TABELA_RESCISAO).delete().eq("id", r.id);
    if (error) throw new Error(error.message);
    setRescisoes((rs) => rs.filter((x) => x.id !== r.id));
  }, []);

  return { linhas, solicitacoes, rescisoes, empregados, carregando, erro, carregar, salvar, atualizar, criarManual, excluir, quemSou };
}

export interface HistoricoRescisao {
  id: number;
  status_de: string | null;
  status_para: string | null;
  por: string | null;
  em: string;
}

export async function buscarHistoricoRescisao(rescisaoId: number): Promise<HistoricoRescisao[]> {
  const { data, error } = await sb.from("RH_RESCISAO_HISTORICO")
    .select("id,status_de,status_para,por,em").eq("rescisao_id", rescisaoId).order("em", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as HistoricoRescisao[];
}
