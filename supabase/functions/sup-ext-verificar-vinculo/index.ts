// Edge Function: sup-ext-verificar-vinculo
//
// Chamada pelo Login.tsx (aba "Externo"), ANTES de abrir sessão anônima.
// Revalida CPF+nascimento contra EMPREGADOS (reusa sup_ext_casar_empregado,
// a mesma função que sup_ext_prevalidar/sup_ext_entrar_empregado usam) e
// confere se o cadastro já está vinculado a uma conta real
// (EMPREGADOS.auth_user_id — mesmo campo que Administração > Usuários >
// "Vincular colaborador" grava). Se estiver, gera um magic link via Admin
// Auth API e devolve o token pro front trocar por uma sessão de verdade
// (supabase.auth.verifyOtp) — sem senha, sem e-mail sendo enviado de fato,
// o token só serve pra essa troca imediata.
//
// Não mexe em sup_ext_tentativa (contagem de tentativas/bloqueio) — quem
// cuida disso continua sendo sup_ext_prevalidar/sup_ext_entrar_empregado,
// chamadas normalmente depois desta. Esta função é só um lookup a mais;
// qualquer falha aqui devolve linked:false e o front segue no fluxo
// anônimo de sempre, sem travar ninguém.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ linked: false }, 200);
  }

  try {
    const { cpf, nascimento } = await req.json();
    if (!cpf || !nascimento) return jsonResponse({ linked: false }, 200);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    const { data: casarRows, error: casarErr } = await admin.rpc("sup_ext_casar_empregado", {
      p_cpf: cpf,
      p_nascimento: nascimento,
    });
    if (casarErr) return jsonResponse({ linked: false }, 200);

    const r = Array.isArray(casarRows) ? casarRows[0] : casarRows;
    if (!r?.ok || !r?.id) return jsonResponse({ linked: false }, 200);

    const { data: emp } = await admin
      .from("EMPREGADOS")
      .select("auth_user_id")
      .eq("ID", r.id)
      .maybeSingle();

    const authUserId = (emp as { auth_user_id: string | null } | null)?.auth_user_id;
    if (!authUserId) return jsonResponse({ linked: false }, 200);

    const { data: profile } = await admin
      .from("profiles")
      .select("email")
      .eq("id", authUserId)
      .maybeSingle();

    const email = (profile as { email: string | null } | null)?.email;
    if (!email) return jsonResponse({ linked: false }, 200);

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !link?.properties?.hashed_token) return jsonResponse({ linked: false }, 200);

    return jsonResponse({ linked: true, email, token_hash: link.properties.hashed_token });
  } catch {
    return jsonResponse({ linked: false }, 200);
  }
});
