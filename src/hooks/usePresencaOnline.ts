import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  estaAtivo,
  INTERVALO_HEARTBEAT_MS,
  montarListaPresenca,
  normalizarPreferencias,
  PREFERENCIAS_VAZIAS,
  type PreferenciasPresenca,
  type PresencaLinha,
  type UsuarioElenco,
} from "@/lib/presencaOnline";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  return {
    pessoas,
    linhas: q.data?.linhas ?? [],
    agora: q.data?.agora ?? null,
    carregando: q.isLoading,
    erro: q.error,
  };
}

/**
 * Elenco do painel: TODOS os usuários ativos (nome, foto, setor), via
 * presenca_usuarios (20261030003600). Muda pouco e são centenas de linhas,
 * então fica 10 min em cache e não refaz por intervalo — quem refaz por
 * minuto é só a presença, que é pequena.
 */
export function useElencoPresenca(habilitado: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["presenca-elenco"],
    enabled: habilitado && !!user?.id,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await sb.rpc("presenca_usuarios");
      if (error) throw error;
      return (data ?? []) as UsuarioElenco[];
    },
  });
}

/**
 * Favoritos, ordem arrastada e grupos recolhidos — por usuário, no banco
 * (usuario_presenca_preferencia), para valer em qualquer máquina. A tela
 * muda na hora (cache otimista) e a gravação sai 700 ms depois do último
 * gesto: arrastar várias pessoas seguidas vira um upsert só.
 */
export function usePreferenciasPresenca(habilitado: boolean) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const chave = ["presenca-preferencias", user?.id];
  const timer = useRef<number | undefined>(undefined);

  const q = useQuery({
    queryKey: chave,
    enabled: habilitado && !!user?.id,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await sb
        .from("usuario_presenca_preferencia")
        .select("preferencias")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return normalizarPreferencias(data?.preferencias);
    },
  });

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const salvar = useCallback(
    (prefs: PreferenciasPresenca) => {
      if (!user?.id) return;
      qc.setQueryData(["presenca-preferencias", user.id], prefs);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        sb.from("usuario_presenca_preferencia")
          .upsert({ user_id: user.id, preferencias: prefs }, { onConflict: "user_id" })
          .then(({ error }: { error: unknown }) => {
            if (error) console.warn("[presenca] preferência não salva", error);
          });
      }, 700);
    },
    [qc, user?.id],
  );

  return { prefs: q.data ?? PREFERENCIAS_VAZIAS, salvar };
}
