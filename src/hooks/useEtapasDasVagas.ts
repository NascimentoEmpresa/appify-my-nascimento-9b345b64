import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { vagaTemEtapa, type EtapaVaga } from "@/lib/recrutamento/statusDetalhado";

// Etapa do kanban de cada vaga (SISTEMA_RECRUTAMENTO_ETAPA, mig
// 20261008000008) — o que o selo de status detalhado mostra. A RLS entrega a
// etapa das vagas que a pessoa já vê, então serve igual para o Recrutamento,
// o Operacional e o solicitante. Só busca vaga em andamento (encerrada e fila
// de aprovação não detalham). Banco sem a tabela ou erro: fica sem detalhe e
// a tela mostra o status de sempre.

const db = supabase as unknown as SupabaseClient;
const BLOCO = 100; // ids por consulta (o .in vai na URL)

async function buscarEtapas(ids: number[]): Promise<EtapaVaga[] | null> {
  const blocos: number[][] = [];
  for (let i = 0; i < ids.length; i += BLOCO) blocos.push(ids.slice(i, i + BLOCO));
  const res = await Promise.all(blocos.map((b) => db
    .from("SISTEMA_RECRUTAMENTO_ETAPA")
    .select("vaga_id,etapa,candidatos,por_etapa,atualizado_em")
    .in("vaga_id", b)));
  if (res.some((r) => r.error)) return null;
  return res.flatMap((r) => (r.data ?? []) as EtapaVaga[]);
}

export function useEtapasDasVagas(vagas: ReadonlyArray<{ id: number; status?: string | null }> | null | undefined) {
  const [etapas, setEtapas] = useState<Record<number, EtapaVaga>>({});

  /** Relê a etapa destas vagas (ex.: depois de mover um candidato). */
  const recarregar = useCallback(async (ids: number[]) => {
    const lista = Array.from(new Set(ids.filter((id) => Number.isFinite(id))));
    if (!lista.length) return;
    const achadas = await buscarEtapas(lista);
    if (!achadas) return;
    setEtapas((prev) => {
      const novo = { ...prev };
      for (const id of lista) delete novo[id]; // vaga que saiu do kanban perde a etapa
      for (const e of achadas) novo[Number(e.vaga_id)] = e;
      return novo;
    });
  }, []);

  useEffect(() => {
    recarregar((vagas ?? []).filter((v) => vagaTemEtapa(v.status)).map((v) => Number(v.id)));
  }, [vagas, recarregar]);

  return { etapas, recarregar };
}
