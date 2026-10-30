import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  estaAtivo,
  INTERVALO_HEARTBEAT_MS,
  montarListaPresenca,
  type PresencaLinha,
} from "@/lib/presencaOnline";

const sb = supabase as any;

/**
 * Heartbeat de presença: 1 chamada a presenca_registrar por minuto por aba,
 * mais uma imediata ao voltar para a aba (a bolinha fica verde na hora, sem
 * esperar o próximo minuto). Interação de mouse/teclado só atualiza uma
 * variável — não dispara request.
 *
 * Falha é silenciosa de propósito: presença é enfeite, não pode derrubar tela
 * nem encher o console se o cluster estiver respirando.
 */
export function useHeartbeatPresenca(habilitado: boolean) {
  const { user } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!habilitado || !user?.id) return;
    let ultimaInteracao = Date.now();
    let ultimoEnvio = 0;
    let primeiro = true;

    const enviar = () => {
      ultimoEnvio = Date.now();
      const ativo = estaAtivo(document.visibilityState === "visible", ultimaInteracao, Date.now());
      sb.rpc("presenca_registrar", { _ativo: ativo }).then(
        () => {
          // O primeiro sinal da sessão já põe a própria pessoa na lista,
          // sem esperar o minuto da próxima busca.
          if (primeiro) qc.invalidateQueries({ queryKey: ["presenca-online"] });
          primeiro = false;
        },
        () => undefined,
      );
    };
    const marcarInteracao = () => {
      ultimaInteracao = Date.now();
    };
    const aoMudarVisibilidade = () => {
      if (document.visibilityState !== "visible") return;
      ultimaInteracao = Date.now();
      // Volta rápida (alt-tab) não precisa de request extra.
      if (Date.now() - ultimoEnvio > 15_000) enviar();
    };

    enviar();
    const timer = window.setInterval(enviar, INTERVALO_HEARTBEAT_MS);
    const opcoes = { passive: true } as const;
    window.addEventListener("pointerdown", marcarInteracao, opcoes);
    window.addEventListener("keydown", marcarInteracao, opcoes);
    window.addEventListener("pointermove", marcarInteracao, opcoes);
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", marcarInteracao);
      window.removeEventListener("keydown", marcarInteracao);
      window.removeEventListener("pointermove", marcarInteracao);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [habilitado, user?.id, qc]);
}

/**
 * Lista de quem está online. Refaz a cada minuto SÓ com a aba visível (o
 * React Query não refaz intervalo em segundo plano por padrão) — com a aba
 * escondida ninguém está olhando o painel.
 */
export function usePresencaOnline(habilitado: boolean) {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["presenca-online"],
    enabled: habilitado && !!user?.id,
    staleTime: 30_000,
    refetchInterval: INTERVALO_HEARTBEAT_MS,
    queryFn: async () => {
      const { data, error } = await sb.rpc("presenca_listar");
      if (error) throw error;
      const linhas = (data ?? []) as (PresencaLinha & { agora: string })[];
      return { linhas, agora: linhas[0]?.agora ?? new Date().toISOString() };
    },
  });

  const pessoas = useMemo(
    () => (q.data ? montarListaPresenca(q.data.linhas, q.data.agora) : []),
    [q.data],
  );
  return { pessoas, carregando: q.isLoading, erro: q.error };
}
