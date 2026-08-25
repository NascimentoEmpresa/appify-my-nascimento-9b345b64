// Busca reuniões concluídas com PDF final já gerado/upado (pelo app, ao
// clicar "Encerrar Reunião") e ainda não enviadas por e-mail, baixa o PDF
// do Storage e manda pros e-mails cadastrados (organizador + convidados).
async function enviarEmailsAta(supabase, transportador) {
  const { data: reunioes, error } = await supabase
    .from("reuniao")
    .select("id, titulo, pdf_final_storage_path, criado_por, responsavel_preenchimento_user_id")
    .eq("etapa", "concluida")
    .eq("email_ata_enviado", false)
    .not("pdf_final_storage_path", "is", null);

  if (error) {
    console.error("[email-ata] erro ao buscar reuniões:", error.message);
    return;
  }
  if (!reunioes || reunioes.length === 0) return;

  for (const r of reunioes) {
    try {
      const { data: arquivo, error: downloadErr } = await supabase.storage
        .from("reunioes")
        .download(r.pdf_final_storage_path);

      if (downloadErr || !arquivo) {
        console.error(`[email-ata] falha ao baixar PDF da reunião ${r.id}:`, downloadErr?.message);
        continue;
      }
      const buffer = Buffer.from(await arquivo.arrayBuffer());

      const { data: convidados } = await supabase
        .from("reuniao_convidado")
        .select("user_id")
        .eq("reuniao_id", r.id);

      const userIds = Array.from(new Set(
        [r.criado_por, r.responsavel_preenchimento_user_id, ...(convidados ?? []).map((c) => c.user_id)].filter(Boolean),
      ));

      const { data: perfis } = await supabase
        .from("profiles")
        .select("email")
        .in("id", userIds);

      const emails = (perfis ?? []).map((p) => p.email).filter(Boolean);

      if (emails.length > 0) {
        await transportador.sendMail({
          from: process.env.SMTP_USER,
          to: emails.join(","),
          subject: `Ata da reunião: ${r.titulo}`,
          text: `Segue em anexo o PDF final da ata da reunião "${r.titulo}".`,
          attachments: [{ filename: "ata-final.pdf", content: buffer }],
        });
        console.log(`[email-ata] enviado pra ${emails.join(", ")} (reunião ${r.id})`);
      }

      await supabase.from("reuniao").update({ email_ata_enviado: true }).eq("id", r.id);
    } catch (e) {
      console.error(`[email-ata] erro processando reunião ${r.id}:`, e.message);
    }
  }
}

module.exports = { enviarEmailsAta };
