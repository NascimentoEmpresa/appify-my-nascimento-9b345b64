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
 * Os dados do módulo Rescisões (21/10/2026, mig 20261021000030): as
 * solicitações do ERP que chegaram ao RH + as fichas da RH_RESCISAO (ERP,
 * importadas da planilha e lançadas à mão), juntas numa lista só —
 * `montarLinhasRescisao`, a mesma regra que a tabela do RH usava.
 *
 * As solicitações são as que o RH enxerga (o mesmo recorte de status do
 * PainelDemissoes, etapa "rh"): do "Pendente RH" em diante, com as
 * canceladas — a cancelada sem ficha a própria montagem tira.
 */
export const STATUS_SOLICITACAO_NA_RESCISAO = [
  STATUS_CANCELAMENTO_SOLICITADO, "Pendente RH", "Pendente SST", STATUS_SST_RECEBIDA,
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

  /** Grava na ficha da linha (cria a ficha da solicitação na primeira vez). */
  const salvar = useCallback(async (l: LinhaRescisao, dados: Partial<RescisaoRH>): Promise<RescisaoRH> => {
    const corpo = { ...dados, atualizado_por: quemSou || null };
    const { data, error } = l.rescisao
      ? await sb.from(TABELA_RESCISAO).update(corpo).eq("id", l.rescisao.id).select().single()
      : await sb.from(TABELA_RESCISAO).insert({ ...corpo, solicitacao_id: l.solicitacao?.id ?? null, origem: "erp" }).select().single();
    if (error) throw new Error(error.message);
    const nova = data as RescisaoRH;
    setRescisoes((rs) => (rs.some((r) => r.id === nova.id) ? rs.map((r) => (r.id === nova.id ? nova : r)) : [...rs, nova]));
    return nova;
  }, [quemSou]);

  /**
   * Arrastar no kanban: a coluna muda NA HORA (otimista) e volta se o banco
   * recusar — esperar o servidor a cada card arrastado é o que deixava o
   * quadro do Recrutamento "pesado".
   */
  const mover = useCallback(async (l: LinhaRescisao, dados: Partial<RescisaoRH>) => {
    if (l.rescisao) {
      const antes = l.rescisao;
      setRescisoes((rs) => rs.map((r) => (r.id === antes.id ? { ...r, ...dados, status_desde: new Date().toISOString() } : r)));
      try { await salvar(l, dados); } catch (e) {
        setRescisoes((rs) => rs.map((r) => (r.id === antes.id ? antes : r)));
        throw e;
      }
      return;
    }
    await salvar(l, dados);
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

  return { linhas, solicitacoes, rescisoes, empregados, carregando, erro, carregar, salvar, mover, criarManual, excluir, quemSou };
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
