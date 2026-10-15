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
  origem: "automatico" | "manual" | "assumido";
  atualizado_em: string;
  /** Transferida por outra pessoa (mig 20261014000047). */
  transferida_em?: string | null;
  transferida_por_nome?: string | null;
  /** Quando a responsável clicou em "Ciente". */
  ciente_em?: string | null;
}

/**
 * Vaga que outra pessoa passou para a responsável e ela ainda não deu
 * "Ciente" — a "nova demanda" que no Excel era a linha pintada de vermelho.
 */
export function novaDemanda(r: ResponsavelVaga | null | undefined): boolean {
  if (!r?.transferida_em) return false;
  return !r.ciente_em || new Date(r.ciente_em) < new Date(r.transferida_em);
}

const COLS = "vaga_id,responsavel_id,responsavel_nome,origem,atualizado_em";
const COLS_TRANSF = `${COLS},transferida_em,transferida_por_nome,ciente_em`;

async function buscar(ids: number[]): Promise<ResponsavelVaga[] | null> {
  const blocos: number[][] = [];
  for (let i = 0; i < ids.length; i += BLOCO) blocos.push(ids.slice(i, i + BLOCO));
  const ler = (cols: string) => Promise.all(blocos.map((b) => db
    .from("SISTEMA_RECRUTAMENTO_RESPONSAVEL")
    .select(cols)
    .in("vaga_id", b)));
  // Banco ainda sem a mig 20261014000047: lê sem as colunas da transferência.
  let res = await ler(COLS_TRANSF);
  if (res.some((r) => r.error)) res = await ler(COLS);
  if (res.some((r) => r.error)) return null;
  return res.flatMap((r) => (r.data ?? []) as unknown as ResponsavelVaga[]);
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

/** "Ciente" da vaga transferida (mig 20261014000047): tira o vermelho. */
export async function marcarCienteVaga(vagaId: number): Promise<void> {
  const { error } = await db.rpc("rec_responsavel_ciente", { p_vaga: vagaId });
  if (error) throw error;
}

/** "Tornar-me responsável" (mig 20261014000003): a própria pessoa assume a vaga. */
export async function assumirVaga(vagaId: number): Promise<void> {
  const { error } = await db.rpc("rec_responsavel_assumir", { p_vaga: vagaId });
  if (error) throw error;
}

/** Quantas vagas de Recrutamento/Seleção cada pessoa cuida (null = sem responsável). */
export async function contarVagasPorResponsavel(): Promise<{ responsavel_id: string | null; responsavel_nome: string; vagas: number }[]> {
  const { data, error } = await db.rpc("rec_responsaveis_contagem");
  if (error) throw error;
  return ((data ?? []) as { responsavel_id: string | null; responsavel_nome: string; vagas: number | string }[])
    .map((r) => ({ ...r, vagas: Number(r.vagas) }));
}
