import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader =
      req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1) Validate user with anon client (no service_role yet)
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userErr } = await anon.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    const userId = userData.user.id;

    // 2) Server-side admin check via SECURITY DEFINER RPC
    const { data: podeVer, error: roleErr } = await anon.rpc("can_access", {
      _user: userId,
      _menu: "administracao",
      _acao: "visualizar",
    });
    if (roleErr || podeVer !== true) {
      return jsonResponse({ error: "forbidden" }, 403);
    }

    // 3) Only after admin OK: instantiate service-role client
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await sb
      .from("regra_contabilizacao")
      .select(
        `codigo_evento,evento,descricao,gatilho,impacta_caixa,entra_dre,exige_contrato,exige_centro_custo,requer_pedido,requer_3way_match,prioridade,ativo,centro_custo_padrao,observacao,filtro,conta_debito:conta_debito_id(classificacao,descricao),conta_credito:conta_credito_id(classificacao,descricao)`
      )
      .order("codigo_evento", { ascending: true, nullsFirst: false })
      .order("prioridade", { ascending: true });

    if (error) {
      return jsonResponse({ error: "internal_error" }, 500);
    }

    return jsonResponse(data, 200);
  } catch (_e) {
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
