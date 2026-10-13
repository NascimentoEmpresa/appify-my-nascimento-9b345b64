import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Responsável pela vaga (SISTEMA_RECRUTAMENTO_RESPONSAVEL, mig 20261013000003).
// Pedido de 13/10/2026: "etiqueta obrigatória puxando automático com opção
// manual". Quem move a vaga/candidato no Recrutamento vira o responsável
// (gatilho no RECRUTAMENTO_HISTORICO); quem conduz o Recrutamento pode fixar
// outra pessoa (rec_responsavel_definir) — fixado, o automático não troca.
// A RLS entrega o responsável das vagas que a pessoa já vê. Erro ou banco sem
// a tabela: a tela segue, só sem o responsável.

const db = supabase as unknown as SupabaseClient;
const BLOCO = 100; // ids por consulta (o .in vai na URL)

export interface ResponsavelVaga {
  vaga_id: number;
  responsavel_id: string | null;
  responsavel_nome: string;
  origem: "automatico" | "manual";
  atualizado_em: string;
}

async function buscar(ids: number[]): Promise<ResponsavelVaga[] | null> {
  const blocos: number[][] = [];
  for (let i = 0; i < ids.length; i += BLOCO) blocos.push(ids.slice(i, i + BLOCO));
  const res = await Promise.all(blocos.map((b) => db
    .from("SISTEMA_RECRUTAMENTO_RESPONSAVEL")
    .select("vaga_id,responsavel_id,responsavel_nome,origem,atualizado_em")
    .in("vaga_id", b)));
  if (res.some((r) => r.error)) return null;
  return res.flatMap((r) => (r.data ?? []) as ResponsavelVaga[]);
}

export function useResponsaveisDasVagas(vagas: ReadonlyArray<{ id: number }> | null | undefined) {
  const [responsaveis, setResponsaveis] = useState<Record<number, ResponsavelVaga>>({});

  /** Relê o responsável destas vagas (ex.: depois de mover um candidato). */
  const recarregar = useCallback(async (ids: number[]) => {
    const lista = Array.from(new Set(ids.filter((id) => Number.isFinite(id))));
    if (!lista.length) return;
    const achados = await buscar(lista);
    if (!achados) return;
    setResponsaveis((prev) => {
      const novo = { ...prev };
      for (const id of lista) delete novo[id];
      for (const r of achados) novo[Number(r.vaga_id)] = r;
      return novo;
    });
  }, []);

  useEffect(() => {
    recarregar((vagas ?? []).map((v) => Number(v.id)));
  }, [vagas, recarregar]);

  return { responsaveis, recarregar };
}

/** Quem pode ser escolhido como responsável (quem conduz o Recrutamento). */
export async function listarResponsaveisPossiveis(): Promise<{ id: string; nome: string }[]> {
  const { data, error } = await db.rpc("rec_responsaveis_possiveis");
  if (error) throw error;
  return (data ?? []) as { id: string; nome: string }[];
}

/** Fixa o responsável (manual) ou, com `usuarioId` null, devolve ao automático. */
export async function definirResponsavelVaga(vagaId: number, usuarioId: string | null): Promise<void> {
  const { error } = await db.rpc("rec_responsavel_definir", { p_vaga: vagaId, p_usuario: usuarioId });
  if (error) throw error;
}
