// Marca automaticamente plano_acao como "atrasada" quando a Data de
// conclusão já passou. Roda via cron (net.http_post) usando service_role
// pra nunca ser bloqueada por RLS — mesmo padrão de sla-escalonamento-tick
// e regua-cobranca-tick. O UPDATE direto no cron (sem edge function) não
// gerava nenhuma execução em cron.job_run_details.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STATUS_ISENTOS = "(atrasada,concluida_validada,cancelada,concluida_pendente_evidencia)";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const hoje = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("plano_acao")
      .update({ status_normalizado: "atrasada" })
      .is("deleted_at", null)
      .not("data_fim_planejado", "is", null)
      .lt("data_fim_planejado", hoje)
      .not("status_normalizado", "in", STATUS_ISENTOS)
      .select("id");

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, marcadas: data?.length ?? 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("plano-acao-marcar-atrasadas error", err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
