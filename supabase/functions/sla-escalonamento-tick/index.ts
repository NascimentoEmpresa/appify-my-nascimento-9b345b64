import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1) Instâncias abertas com etapa atual definida
    const { data: instancias, error: e1 } = await supabase
      .from("sup_aprov_instancia")
      .select("id, empresa_id, fluxo_id, etapa_atual_id, aberta_em, referencia_codigo, solicitante_user_id")
      .eq("status", "pendente")
      .not("etapa_atual_id", "is", null);
    if (e1) throw e1;

    const processados = { instancias: 0, alertas: 0, reatribuicoes: 0 };

    for (const inst of instancias ?? []) {
      // Etapa atual com prazo
      const { data: etapa } = await supabase
        .from("sup_aprov_etapa")
        .select("id, nome, prazo_horas, responsavel_user_id, fluxo_id")
        .eq("id", inst.etapa_atual_id)
        .maybeSingle();
      if (!etapa?.prazo_horas) continue;

      const horasDecorridas = (Date.now() - new Date(inst.aberta_em).getTime()) / 36e5;
      const pctPrazo = horasDecorridas / etapa.prazo_horas;
      processados.instancias++;

      // Régua ativa do fluxo
      const { data: reguas } = await supabase
        .from("sup_aprov_regua_escalonamento")
        .select("id")
        .eq("ativo", true)
        .limit(1);
      const reguaId = reguas?.[0]?.id;
      if (!reguaId) continue;

      // Degraus já disparados para esta etapa/instância
      const { data: jaDisparados } = await supabase
        .from("sup_aprov_alerta_log")
        .select("degrau_id")
        .eq("instancia_id", inst.id)
        .eq("etapa_id", etapa.id);
      const disparados = new Set((jaDisparados ?? []).map((d: any) => d.degrau_id));

      // Degraus elegíveis (pct_prazo atingido + horas_extra)
      const { data: degraus } = await supabase
        .from("sup_aprov_regua_degrau")
        .select("id, ordem, pct_prazo, horas_extra, destinatarios, reatribui")
        .eq("regua_id", reguaId)
        .order("ordem", { ascending: true });

      for (const d of degraus ?? []) {
        if (disparados.has(d.id)) continue;
        const horasGatilho = (etapa.prazo_horas * Number(d.pct_prazo)) + Number(d.horas_extra ?? 0);
        if (horasDecorridas < horasGatilho) continue;

        // Destinatários: por padrão responsável da etapa + solicitante
        const destinatariosIds = new Set<string>();
        if (etapa.responsavel_user_id) destinatariosIds.add(etapa.responsavel_user_id);
        if (inst.solicitante_user_id) destinatariosIds.add(inst.solicitante_user_id);

        // Fallback Helena (diretor da empresa)
        const { data: emp } = await supabase
          .from("empresas")
          .select("diretor_user_id")
          .eq("id", inst.empresa_id)
          .maybeSingle();
        if (emp?.diretor_user_id) destinatariosIds.add(emp.diretor_user_id);

        const ids = Array.from(destinatariosIds);

        // Notifica sininho
        if (ids.length) {
          const rows = ids.map((uid) => ({
            user_id: uid,
            empresa_id: inst.empresa_id,
            titulo: `Aprovação em atraso — ${inst.referencia_codigo ?? ""}`.trim(),
            mensagem: `Etapa "${etapa.nome}" ultrapassou ${Math.round(pctPrazo * 100)}% do prazo.`,
            tipo: "aprovacao_sla",
            link: `/app/aprovacoes/inbox?ref=${inst.id}`,
            lida: false,
          }));
          await supabase.from("notificacoes").insert(rows);
        }

        // Log do alerta
        await supabase.from("sup_aprov_alerta_log").insert({
          instancia_id: inst.id,
          etapa_id: etapa.id,
          degrau_id: d.id,
          destinatarios_efetivos: { user_ids: ids },
        });
        processados.alertas++;

        // Reatribuição → fallback Helena
        if (d.reatribui && emp?.diretor_user_id && emp.diretor_user_id !== etapa.responsavel_user_id) {
          await supabase
            .from("sup_aprov_etapa")
            .update({ delegado_para_user_id: emp.diretor_user_id, delegado_ate: new Date(Date.now() + 7 * 86400000).toISOString() })
            .eq("id", etapa.id);
          processados.reatribuicoes++;
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, ...processados }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("sla-tick error", err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
