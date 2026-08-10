import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

/**
 * Vínculo da conta do Discord.
 *
 * Existe para as notificações do ERP encontrarem a pessoa no Discord. O campo
 * que realmente importa é o `discord_id` (o "snowflake"): é ele que faz a
 * menção <@id> funcionar. O e-mail entra porque é o que um humano consegue
 * conferir a olho — ninguém reconhece um snowflake.
 *
 * Dois caminhos, e a diferença fica gravada em `verificado`:
 *   OAuth  → o Discord confirmou a conta. `verificado = true`.
 *   Manual → alguém digitou. Pode ser typo, pode ser o ID do colega.
 *
 * Ver supabase/migrations/20260828000010_vinculo_discord.sql.
 */

const sb = supabase as any;

/** Precisa estar registrada no app do Discord E em DISCORD_REDIRECT_URIS. */
export const DISCORD_REDIRECT_PATH = "/app/meu-perfil/discord";
export function discordRedirectUri(): string {
  return `${window.location.origin}${DISCORD_REDIRECT_PATH}`;
}

export interface VinculoDiscord {
  user_id: string;
  discord_id: string;
  discord_username: string | null;
  discord_email: string | null;
  discord_avatar: string | null;
  verificado: boolean;
  vinculado_em: string;
}

export function useMeuDiscord() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["usuario_discord", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<VinculoDiscord | null> => {
      const { data, error } = await sb
        .from("usuario_discord")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
}

function useInvalidar() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["usuario_discord"] });
}

/** Passo 1 do OAuth: pede a URL de autorização e manda o navegador para lá. */
export function useIniciarVinculoDiscord() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("discord-vincular", {
        body: { action: "iniciar", redirect_uri: discordRedirectUri() },
      });
      if (error) throw new Error(await mensagemDaFuncao(error));
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("O servidor não devolveu a URL do Discord.");
      // Guarda onde voltar depois de concluir, para o usuário cair de novo no
      // lugar de onde saiu.
      sessionStorage.setItem("discord_voltar_para", window.location.pathname);
      window.location.href = data.url;
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível iniciar o vínculo."),
  });
}

/** Passo 2: entrega o code de volta para a função concluir o vínculo. */
export function useConcluirVinculoDiscord() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (v: { code: string; state: string }) => {
      const { data, error } = await supabase.functions.invoke("discord-vincular", {
        body: {
          action: "concluir",
          code: v.code,
          state: v.state,
          redirect_uri: discordRedirectUri(),
        },
      });
      if (error) throw new Error(await mensagemDaFuncao(error));
      if (data?.error) throw new Error(data.error);
      return data as { discord_id: string; discord_username: string | null };
    },
    onSuccess: (d) => {
      invalidar();
      toast.success(`Discord vinculado: ${d.discord_username ?? d.discord_id}`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível concluir o vínculo."),
  });
}

/**
 * Caminho manual. Grava sempre com `verificado = false` — e a RLS recusaria
 * qualquer outra coisa, então a tela não consegue mentir nem por engano.
 */
export function useVincularDiscordManual() {
  const invalidar = useInvalidar();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (v: { discord_id: string; discord_email: string }) => {
      if (!user?.id) throw new Error("Sessão expirada.");
      const id = v.discord_id.trim();
      if (!/^[0-9]{5,25}$/.test(id)) {
        throw new Error("O ID do Discord é só números. Copie por 'Copiar ID do usuário'.");
      }
      const { error } = await sb.from("usuario_discord").upsert({
        user_id: user.id,
        discord_id: id,
        discord_email: v.discord_email.trim() || null,
        verificado: false,
      }, { onConflict: "user_id" });
      if (error) {
        if (/usuario_discord_unico|duplicate/i.test(error.message ?? "")) {
          throw new Error("Este ID já está vinculado a outro usuário do ERP.");
        }
        throw error;
      }
    },
    onSuccess: () => { invalidar(); toast.success("Discord vinculado."); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível vincular."),
  });
}

export function useDesvincularDiscord() {
  const invalidar = useInvalidar();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async () => {
      const { error } = await sb.from("usuario_discord").delete().eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => { invalidar(); toast.success("Discord desvinculado."); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível desvincular."),
  });
}

/**
 * `functions.invoke` embrulha o corpo do erro; sem isto o usuário veria só
 * "Edge Function returned a non-2xx status code" em vez do motivo real.
 */
async function mensagemDaFuncao(error: any): Promise<string> {
  try {
    const corpo = await error?.context?.json?.();
    if (corpo?.error) return corpo.error;
  } catch { /* fica com a mensagem genérica */ }
  return error?.message ?? "Falha ao falar com o servidor.";
}
