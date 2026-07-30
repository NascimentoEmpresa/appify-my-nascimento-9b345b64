import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CAIXA_POR_SETOR: Record<string, string | undefined> = {
  financeiro: Deno.env.get("COBRANCA_EMAIL_FINANCEIRO"),
  juridico: Deno.env.get("COBRANCA_EMAIL_JURIDICO"),
};

async function obterTokenGraph(): Promise<string> {
  const tenantId = Deno.env.get("AZURE_TENANT_ID")!;
  const clientId = Deno.env.get("AZURE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("AZURE_CLIENT_SECRET")!;

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Falha ao autenticar no Graph: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function enviarEmailGraph(caixa: string, destinatarios: string[], assunto: string, corpoHtml: string) {
  const token = await obterTokenGraph();
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(caixa)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: assunto,
        body: { contentType: "HTML", content: corpoHtml },
        toRecipients: destinatarios.map((email) => ({ emailAddress: { address: email } })),
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) throw new Error(`Graph sendMail falhou: ${res.status} ${await res.text()}`);
  return { status: res.status };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { execucao_id, acao } = await req.json();

    if (!execucao_id || !["aprovar", "rejeitar", "confirmar_manual"].includes(acao)) {
      return new Response(JSON.stringify({ ok: false, error: "Parâmetros inválidos (execucao_id, acao)." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cliente com o JWT de quem chamou, só pra identificar o usuário autenticado
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );
    const { data: userData, error: eUser } = await userClient.auth.getUser();
    if (eUser || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "Não autenticado." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const { data: execucao, error: eExec } = await admin
      .from("regua_cobranca_execucao")
      .select("id, status, canal, destinatario, assunto, conteudo, etapa_id")
      .eq("id", execucao_id)
      .maybeSingle();
    if (eExec) throw eExec;
    if (!execucao) {
      return new Response(JSON.stringify({ ok: false, error: "Execução não encontrada." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (execucao.status !== "aguardando_aprovacao") {
      return new Response(JSON.stringify({ ok: false, error: `Execução não está aguardando aprovação (status atual: ${execucao.status}).` }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Só quem tem acesso a cobrancas (alterar = vê tudo, aprovar = restrito a
    // 30 dias/Jurídico) pode aprovar/rejeitar — ver Lote 8d/8e.
    const [alterarCheck, aprovarCheck] = await Promise.all([
      admin.rpc("can_access", { _user: userData.user.id, _menu: "cobrancas", _acao: "alterar" }),
      admin.rpc("can_access", { _user: userData.user.id, _menu: "cobrancas", _acao: "aprovar" }),
    ]);
    const autorizado = alterarCheck.data === true || aprovarCheck.data === true;
    if (!autorizado) {
      return new Response(JSON.stringify({ ok: false, error: "Sem permissão pra aprovar cobranças." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (acao === "rejeitar") {
      await admin.from("regua_cobranca_execucao").update({ status: "cancelada" }).eq("id", execucao_id);
      return new Response(JSON.stringify({ ok: true, status: "cancelada" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (acao === "confirmar_manual") {
      // Canal não automatizado (ex: WhatsApp) — a pessoa já fez o envio manual, só confirma.
      await admin
        .from("regua_cobranca_execucao")
        .update({ status: "executada", executado_em: new Date().toISOString(), executado_por: userData.user.id })
        .eq("id", execucao_id);
      return new Response(JSON.stringify({ ok: true, status: "executada" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // acao === "aprovar": só faz sentido de verdade pra e-mail (é o único canal automatizado)
    if (execucao.canal !== "email") {
      return new Response(JSON.stringify({ ok: false, error: "Este canal exige confirmação manual, não aprovação de envio automático." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: etapa } = await admin
      .from("regua_cobranca_etapa")
      .select("setor_remetente")
      .eq("id", execucao.etapa_id)
      .maybeSingle();

    const destinatarios = (execucao.destinatario ?? "").split(";").map((s: string) => s.trim()).filter(Boolean);
    if (destinatarios.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "Sem destinatário cadastrado pra este envio." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const caixa = CAIXA_POR_SETOR[etapa?.setor_remetente ?? "financeiro"];
    if (!caixa) throw new Error(`Caixa de envio não configurada para o setor "${etapa?.setor_remetente}"`);

    const respostaGraph = await enviarEmailGraph(caixa, destinatarios, execucao.assunto ?? "", execucao.conteudo ?? "");

    await admin
      .from("regua_cobranca_execucao")
      .update({
        status: "executada",
        executado_em: new Date().toISOString(),
        executado_por: userData.user.id,
        resposta: respostaGraph,
      })
      .eq("id", execucao_id);

    return new Response(JSON.stringify({ ok: true, status: "executada" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("regua-cobranca-aprovar error", err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
