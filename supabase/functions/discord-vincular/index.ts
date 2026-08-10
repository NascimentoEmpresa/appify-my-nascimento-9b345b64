// supabase/functions/discord-vincular/index.ts
//
// Vincula a conta de Discord do usuário logado no ERP, por OAuth2.
//
// POR QUE OAUTH PRÓPRIO, E NÃO supabase.auth.linkIdentity('discord')
//   O linkIdentity resolveria em menos código, mas transformaria o Discord
//   numa FORMA DE ENTRAR NO ERP: quem controlasse aquela conta de Discord
//   logaria no sistema. A necessidade aqui é notificação, não autenticação —
//   então o Discord é tratado como canal, e a superfície de login do ERP
//   continua exatamente a que era.
//
// FLUXO
//   iniciar  -> devolve a URL de autorização do Discord com um `state` novo,
//               gravado e amarrado ao usuário.
//   concluir -> recebe {code, state}, confere que o state é DESTE usuário,
//               troca o code por token, lê /users/@me e grava o vínculo.
//
// O `state` é o que impede o ataque óbvio: sem ele, alguém poderia iniciar o
// fluxo com a própria conta de Discord e induzir a vítima a concluí-lo,
// deixando as notificações da vítima caindo no Discord do atacante.
//
// O token do Discord é usado uma vez e descartado. Não guardamos refresh
// token: para mencionar alguém num canal basta o ID, e guardar credencial
// que não vamos usar é só aumentar o estrago de um vazamento.
//
// SEGREDOS (supabase secrets set ...)
//   DISCORD_CLIENT_ID       — público, mas fica aqui junto do resto
//   DISCORD_CLIENT_SECRET   — nunca sai daqui
//   DISCORD_REDIRECT_URIS   — lista separada por vírgula das URLs de retorno
//                             permitidas. O front manda a que vai usar e ela
//                             é conferida contra esta lista: sem isso o
//                             parâmetro viraria redirect aberto.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("DISCORD_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("DISCORD_CLIENT_SECRET") ?? "";
const REDIRECT_URIS = (Deno.env.get("DISCORD_REDIRECT_URIS") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return json({
        error:
          "Integração com o Discord ainda não configurada. Falta definir DISCORD_CLIENT_ID e DISCORD_CLIENT_SECRET.",
      }, 503);
    }

    // Quem está falando? O JWT do próprio usuário decide — nunca um id vindo
    // do corpo da requisição.
    const authHeader = req.headers.get("Authorization") ?? "";
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: userData, error: userErr } = await admin.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData?.user) return json({ error: "Sessão inválida." }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const redirectUri = String(body.redirect_uri ?? "");

    if (!REDIRECT_URIS.includes(redirectUri)) {
      return json({
        error: "URL de retorno não autorizada. Confira DISCORD_REDIRECT_URIS.",
      }, 400);
    }

    // ── iniciar ──────────────────────────────────────────────────────
    if (action === "iniciar") {
      await admin.rpc("usuario_discord_limpar_states").catch(() => {});

      const state = crypto.randomUUID() + "." + crypto.randomUUID();
      const { error } = await admin
        .from("usuario_discord_oauth_state")
        .insert({ state, user_id: userId });
      if (error) return json({ error: "Não foi possível iniciar o vínculo." }, 500);

      const url = new URL("https://discord.com/api/oauth2/authorize");
      url.searchParams.set("client_id", CLIENT_ID);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      // Só o mínimo: quem é e qual o e-mail. Nada de ler mensagens ou entrar
      // em servidores — escopo pedido a mais é escopo que alguém vai estranhar.
      url.searchParams.set("scope", "identify email");
      url.searchParams.set("state", state);
      url.searchParams.set("prompt", "consent");

      return json({ url: url.toString() });
    }

    // ── concluir ─────────────────────────────────────────────────────
    if (action === "concluir") {
      const code = String(body.code ?? "");
      const state = String(body.state ?? "");
      if (!code || !state) return json({ error: "Retorno do Discord incompleto." }, 400);

      // O state tem de existir E pertencer a quem está chamando.
      const { data: st } = await admin
        .from("usuario_discord_oauth_state")
        .select("user_id, created_at")
        .eq("state", state)
        .maybeSingle();

      // Consome o state de imediato: serve uma vez só, dando errado ou certo.
      await admin.from("usuario_discord_oauth_state").delete().eq("state", state);

      if (!st || st.user_id !== userId) {
        return json({ error: "Pedido de vínculo inválido ou expirado. Tente de novo." }, 400);
      }
      if (Date.now() - new Date(st.created_at).getTime() > 10 * 60 * 1000) {
        return json({ error: "O pedido expirou. Clique em vincular novamente." }, 400);
      }

      const tokenResp = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenResp.ok) {
        return json({ error: "O Discord recusou a autorização. Tente de novo." }, 400);
      }
      const token = await tokenResp.json();

      const meResp = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!meResp.ok) return json({ error: "Não foi possível ler o perfil do Discord." }, 400);
      const me = await meResp.json();

      if (!me?.id) return json({ error: "O Discord não devolveu o identificador da conta." }, 400);

      // Conta de Discord já usada por OUTRA pessoa do ERP: barra com mensagem
      // clara em vez de deixar o UNIQUE estourar em erro cru.
      const { data: jaUsado } = await admin
        .from("usuario_discord")
        .select("user_id")
        .eq("discord_id", me.id)
        .maybeSingle();
      if (jaUsado && jaUsado.user_id !== userId) {
        return json({
          error: "Esta conta do Discord já está vinculada a outro usuário do ERP.",
        }, 409);
      }

      const { error: upErr } = await admin.from("usuario_discord").upsert({
        user_id: userId,
        discord_id: me.id,
        discord_username: me.username ?? null,
        discord_email: me.email ?? null,
        discord_avatar: me.avatar
          ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png`
          : null,
        verificado: true,
        vinculado_em: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (upErr) return json({ error: "Não foi possível gravar o vínculo." }, 500);

      return json({
        ok: true,
        discord_id: me.id,
        discord_username: me.username ?? null,
        discord_email: me.email ?? null,
      });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (e) {
    return json({ error: (e as Error)?.message ?? "Falha inesperada." }, 500);
  }
});
