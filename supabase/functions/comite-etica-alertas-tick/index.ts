// Arquivo: supabase/functions/comite-etica-alertas-tick/index.ts
//
// Varre os procedimentos do Canal de Ética e acende os alertas de prazo e de
// abandono. Agendada por pg_cron em dias úteis às 8h (ver migration
// 20260914000004) — mesmo padrão de sla-escalonamento-tick e regua-cobranca-tick.
//
// A conta inteira acontece no banco (comite_etica_apurar_alertas). Aqui só
// sobra o que o SQL não faz: avisar gente. E o aviso é deliberadamente MUDO
// sobre o conteúdo — diz que há caso vencido e quantos, nunca o protocolo, o
// assunto ou o nome de ninguém. Notificação aparece na tela de bloqueio do
// celular, e canal de ética não vaza por push.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: resumo, error } = await admin.rpc("comite_etica_apurar_alertas");
  if (error) {
    console.error("apurar alertas", error.message);
    return json({ error: error.message }, 500);
  }

  // Quantos alertas ficaram abertos hoje. É isto, e só isto, que vai no push.
  const { count: abertos } = await admin
    .from("CANAL_DENUNCIA_ALERTA")
    .select("id", { count: "exact", head: true })
    .is("resolvido_em", null);

  if (!abertos) return json({ ok: true, ...(resumo as object), avisados: 0 });

  // Quem cuida do canal: o cadastro de responsáveis ativos. Se ele estiver
  // vazio, ninguém é avisado — e isso é melhor do que decidir sozinho mandar
  // alerta de denúncia para uma lista mais larga do que a combinada.
  const { data: resp } = await admin
    .from("COMITE_ETICA_RESPONSAVEL")
    .select("user_id").eq("ativo", true);

  const userIds = (resp ?? []).map((r) => (r as { user_id: string }).user_id);
  if (userIds.length === 0) {
    return json({ ok: true, ...(resumo as object), avisados: 0, motivo: "nenhum responsável cadastrado" });
  }

  const { error: pushErr } = await admin.functions.invoke("enviar-notificacao-push", {
    body: {
      user_ids: userIds,
      titulo: "Comitê de Ética",
      corpo: abertos === 1
        ? "1 procedimento precisa de atenção hoje."
        : `${abertos} procedimentos precisam de atenção hoje.`,
    },
  });
  if (pushErr) console.error("push", pushErr.message);

  return json({ ok: true, ...(resumo as object), avisados: userIds.length });
});
