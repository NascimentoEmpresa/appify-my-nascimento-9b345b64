const { enviarMensagemWhatsapp } = require("./whatsapp");

// Busca reuniões que começam entre 9 e 11 minutos a partir de agora (janela
// de 2 minutos pra não perder o alvo entre um ciclo e outro do polling de
// 60s) e ainda não notificadas, manda WhatsApp pro organizador + convidados
// que tiverem telefone cadastrado, e marca como enviado (mesmo se algum
// envio individual falhar — não trava as demais pessoas nem fica repetindo
// pra sempre).
async function enviarLembretes10min(supabase, waClient) {
  const agora = new Date();
  const de = new Date(agora.getTime() + 9 * 60_000).toISOString();
  const ate = new Date(agora.getTime() + 11 * 60_000).toISOString();

  const { data: reunioes, error } = await supabase
    .from("reuniao")
    .select("id, titulo, data_hora, criado_por, responsavel_preenchimento_user_id")
    .in("etapa", ["agendada", "em_andamento"])
    .eq("lembrete_10min_enviado", false)
    .gte("data_hora", de)
    .lte("data_hora", ate);

  if (error) {
    console.error("[lembrete] erro ao buscar reuniões:", error.message);
    return;
  }
  if (!reunioes || reunioes.length === 0) return;

  for (const r of reunioes) {
    try {
      const { data: convidados } = await supabase
        .from("reuniao_convidado")
        .select("user_id")
        .eq("reuniao_id", r.id);

      const userIds = Array.from(new Set(
        [r.criado_por, r.responsavel_preenchimento_user_id, ...(convidados ?? []).map((c) => c.user_id)].filter(Boolean),
      ));

      const { data: perfis } = await supabase
        .from("profiles")
        .select("id, telefone")
        .in("id", userIds);

      const texto = `Sua reunião "${r.titulo}" começa em 10 minutos.`;

      for (const p of perfis ?? []) {
        if (!p.telefone) continue;
        try {
          await enviarMensagemWhatsapp(waClient, p.telefone, texto);
          console.log(`[lembrete] enviado pra ${p.telefone} (reunião ${r.id})`);
        } catch (e) {
          console.error(`[lembrete] falha ao enviar pra ${p.telefone}:`, e.message);
        }
      }

      await supabase.from("reuniao").update({ lembrete_10min_enviado: true }).eq("id", r.id);
    } catch (e) {
      console.error(`[lembrete] erro processando reunião ${r.id}:`, e.message);
    }
  }
}

module.exports = { enviarLembretes10min };
