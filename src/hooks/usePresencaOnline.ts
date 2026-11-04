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
 * Sinal de presença (presenca_registrar).
 *
 * Até 03/11/2026 era um heartbeat por TEMPORIZADOR: 1 chamada por minuto por
 * aba aberta, com ou sem alguém usando — 25.152 chamadas no dia 03/11 para no
 * máximo 62 abas, a 4ª rota mais chamada do ERP. Pela regra do item 5
 * (src/lib/atualizarTela.ts), nada mais vai ao servidor por relógio.
 *
 * Agora o sinal sai quando a PESSOA age: ao abrir o ERP, ao voltar para a aba
 * e ao clicar/teclar — no máximo um a cada INTERVALO_HEARTBEAT_MS (5 min).
 * Quem está usando aparece "online"; quem parou de mexer some da lista depois
 * de JANELA_ONLINE_MS (src/lib/presencaOnline.ts). O estado "ausente" (aba
 * aberta, parada) deixou de existir de propósito: detectá-lo exige justamente
 * o temporizador que saiu.
 *
 * Falha é silenciosa de propósito: presença é enfeite, não pode derrubar tela
 * nem encher o console se o cluster estiver respirando.
 */
export function useHeartbeatPresenca(habilitado: boolean) {
  const { user } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!habilitado || !user?.id) return;
    let ultimoEnvio = 0;
    let primeiro = true;

    const enviar = () => {
      ultimoEnvio = Date.now();
      const ativo = estaAtivo(document.visibilityState === "visible", Date.now(), Date.now());
      sb.rpc("presenca_registrar", { _ativo: ativo }).then(
        () => {
          // O primeiro sinal da sessão já põe a própria pessoa na lista.
          if (primeiro) qc.invalidateQueries({ queryKey: ["presenca-online"] });
          primeiro = false;
        },
        () => undefined,
      );
    };
    const aoAgir = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - ultimoEnvio >= INTERVALO_HEARTBEAT_MS) enviar();
    };

    enviar();
    const opcoes = { passive: true } as const;
    window.addEventListener("pointerdown", aoAgir, opcoes);
    window.addEventListener("keydown", aoAgir, opcoes);
    document.addEventListener("visibilitychange", aoAgir);
    return () => {
      window.removeEventListener("pointerdown", aoAgir);
      window.removeEventListener("keydown", aoAgir);
      document.removeEventListener("visibilitychange", aoAgir);
    };
  }, [habilitado, user?.id, qc]);
}

/**
 * Lista de quem está online: busca ao abrir o painel e no botão "Atualizar"
 * (sem intervalo desde 03/11/2026).
 */
export function usePresencaOnline(habilitado: boolean) {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["presenca-online"],
    enabled: habilitado && !!user?.id,
    staleTime: 30_000,
    // 03/11/2026: sem busca automática — só quando o usuário pede (src/lib/atualizarTela.ts).
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
