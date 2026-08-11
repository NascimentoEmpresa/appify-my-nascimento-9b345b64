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

type ResultadoFoto = "importada" | "ja_tinha" | "sem_foto" | "falhou";

/**
 * Traz a foto do Discord para a foto de perfil do ERP.
 *
 * COPIA os bytes para o bucket `avatars` em vez de apontar para o CDN do
 * Discord. A URL de lá embute o hash do avatar: no dia em que a pessoa troca a
 * foto no Discord, aquele endereço vira 404 e o ERP perderia a imagem em
 * silêncio. Copiar também evita que toda tela do ERP bata no CDN do Discord.
 *
 * Sem `forcar`, só preenche quem está sem foto — trocar sem pedir a imagem que
 * alguém subiu à mão seria mexer no que não foi pedido. O botão em Meu Perfil
 * passa `forcar`, porque aí a troca é o pedido.
 *
 * É best-effort no caminho automático: falha aqui não pode derrubar um vínculo
 * que já foi gravado. O vínculo é o que importa; a foto é o bônus.
 */
async function importarFoto(
  admin: any,
  userId: string,
  urlDiscord: string | null,
  forcar: boolean,
): Promise<ResultadoFoto> {
  if (!urlDiscord) return "sem_foto";
  try {
    if (!forcar) {
      const { data: perfil } = await admin
        .from("profiles").select("avatar_url").eq("id", userId).maybeSingle();
      if (perfil?.avatar_url) return "ja_tinha";
    }

    // 256px: o maior tamanho que as telas do ERP usam sem ficar pesado.
    const resp = await fetch(`${urlDiscord}?size=256`);
    if (!resp.ok) return "falhou";
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const tipo = resp.headers.get("Content-Type") ?? "image/png";

    const caminho = `${userId}/discord-${Date.now()}.png`;
    const { error: upErr } = await admin.storage
      .from("avatars").upload(caminho, bytes, { contentType: tipo, upsert: true });
    if (upErr) return "falhou";

    const url = `${SUPABASE_URL}/storage/v1/object/public/avatars/${caminho}`;
    const { error: updErr } = await admin
      .from("profiles").update({ avatar_url: url }).eq("id", userId);
    if (updErr) return "falhou";

    return "importada";
  } catch {
    return "falhou";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const configurado = !!CLIENT_ID && !!CLIENT_SECRET && REDIRECT_URIS.length > 0;

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

    // ── status ───────────────────────────────────────────────────────
    // Responde antes de qualquer exigência de configuração: é o que o convite
    // automático consulta para não abrir um modal pedindo algo que ainda não
    // funciona. Diz apenas sim ou não — nenhum segredo sai daqui.
    if (action === "status") return json({ configurado });

    if (!configurado) {
      return json({
        error:
          "Integração com o Discord ainda não configurada. Falta definir DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET e DISCORD_REDIRECT_URIS.",
      }, 503);
    }

    // ── usar_foto ────────────────────────────────────────────────────
    // O caminho deliberado: quem JÁ tem foto no ERP e quer trocar pela do
    // Discord. Sai da URL guardada no vínculo, sem precisar do token do
    // Discord — que é usado uma vez e descartado, de propósito.
    //
    // Fica ACIMA da conferência de redirect_uri: esta ação não redireciona
    // para lugar nenhum e não manda redirect_uri. Embaixo da conferência ela
    // era barrada com "URL de retorno não autorizada" — erro que não tinha
    // nada a ver com o que a pessoa clicou.
    if (action === "usar_foto") {
      const { data: v } = await admin
        .from("usuario_discord")
        .select("discord_avatar")
        .eq("user_id", userId)
        .maybeSingle();
      if (!v?.discord_avatar) {
        return json({ error: "Não há foto do Discord guardada no seu vínculo." }, 400);
      }
      const r = await importarFoto(admin, userId, v.discord_avatar, true);
      if (r !== "importada") {
        return json({ error: "Não foi possível trazer a foto do Discord." }, 502);
      }
      return json({ ok: true });
    }

    // Daqui para baixo só ficam as ações que REDIRECIONAM para o Discord
    // (`iniciar`) ou voltam dele (`concluir`). Só elas mandam redirect_uri, e
    // só elas precisam desta trava — sem ela o parâmetro viraria redirect
    // aberto. Ação que não redireciona não deve ser conferida por aqui.
    if (!REDIRECT_URIS.includes(redirectUri)) {
      return json({
        error: "URL de retorno não autorizada. Confira DISCORD_REDIRECT_URIS.",
      }, 400);
    }

    // ── iniciar ──────────────────────────────────────────────────────
    if (action === "iniciar") {
      // O builder do PostgREST não implementa .catch() como método (só .then()),
      // então precisa envolver em try/catch em vez de encadear .catch() nele.
      try {
        await admin.rpc("usuario_discord_limpar_states");
      } catch { /* faxina de states vencidos é best-effort, não trava o vínculo */ }

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

      // `global_name` é o nome de exibição — o que a pessoa reconhece como seu.
      // `username` é o handle, e em conta criada a partir do e-mail corporativo
      // o Discord o gera do próprio e-mail ("joaovictorcontroladoria_49009").
      // Guardar o handle fazia o perfil parecer que o ERP trocou o nome da
      // pessoa pelo e-mail dela. Só cai no handle quando não há nome de exibição.
      const nomeDiscord = me.global_name ?? me.username ?? null;

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

      const avatarDiscord = me.avatar
        ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png`
        : null;

      const { error: upErr } = await admin.from("usuario_discord").upsert({
        user_id: userId,
        discord_id: me.id,
        discord_username: nomeDiscord,
        discord_email: me.email ?? null,
        discord_avatar: avatarDiscord,
        verificado: true,
        vinculado_em: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (upErr) return json({ error: "Não foi possível gravar o vínculo." }, 500);

      // Aproveita a foto só para quem ainda não tem — ver importarFoto().
      const foto = await importarFoto(admin, userId, avatarDiscord, false);

      return json({
        ok: true,
        discord_id: me.id,
        discord_username: nomeDiscord,
        discord_email: me.email ?? null,
        foto_importada: foto === "importada",
      });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (e) {
    return json({ error: (e as Error)?.message ?? "Falha inesperada." }, 500);
  }
});
