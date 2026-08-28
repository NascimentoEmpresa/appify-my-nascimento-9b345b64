// Envia o pedido de compra ao fornecedor, por e-mail, com link de confirmação.
//
// POR QUE PELO WORKER E NÃO PELA TELA
// A tela não tem como mandar e-mail: o SMTP mora aqui, e Edge Function não
// tem servidor de e-mail configurado neste projeto. A tela enfileira (cria a
// linha de envio) e este módulo despacha — mesmo caminho da ata de reunião.
//
// COMPROVAÇÃO POR CLIQUE, NÃO POR PIXEL
// O e-mail carrega um link único. Abrir registra que chegou; apertar "estou
// ciente" registra o aceite. Pixel invisível seria mais cômodo e não valeria
// nada: cliente de e-mail corporativo bloqueia imagem remota por padrão, então
// "não visualizou" viraria o caso comum — e o preview do Outlook dispararia o
// pixel sem ninguém ter lido, enganando para os dois lados.
//
// UM LOTE PEQUENO POR CICLO
// E-mail para fornecedor é comunicação externa em nome da empresa. Se algo
// estiver errado no template ou no destinatário, é melhor descobrir depois de
// três do que depois de trezentos.

const POR_CICLO = Number(process.env.PEDIDO_ENVIO_POR_CICLO || 3);
const BASE_APP = process.env.APP_BASE_URL || "https://appify-my-nascimento.lovable.app";

const fmtBRL = (v) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtQtd = (v) =>
  Number(v ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

const fmtData = (d) => (!d ? "—" : new Date(d).toLocaleDateString("pt-BR"));

/** Escapa o que vai para dentro do HTML — nome de item vem de digitação livre. */
const esc = (t) =>
  String(t ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function montarHtml({ pedido, itens, link }) {
  const linhas = itens
    .map(
      (i) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${esc(i.nome)}${
          i.tamanho ? ` <span style="color:#6b7280">(${esc(i.tamanho)})</span>` : ""
        }</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${fmtQtd(i.quantidade)} ${esc(i.unidade || "UN")}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${
          i.valor_unitario != null ? fmtBRL(i.valor_unitario) : "—"
        }</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;color:#111827">
  <h2 style="margin:0 0 4px">Pedido de compra ${esc(pedido.numero)}</h2>
  <p style="margin:0 0 16px;color:#6b7280">${esc(pedido.empresa_nome || "")}</p>

  <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">
    <thead>
      <tr style="background:#f3f4f6">
        <th style="padding:6px 8px;text-align:left">Item</th>
        <th style="padding:6px 8px;text-align:right">Qtd</th>
        <th style="padding:6px 8px;text-align:right">Valor un.</th>
      </tr>
    </thead>
    <tbody>${linhas || '<tr><td colspan="3" style="padding:12px;color:#6b7280">Sem itens.</td></tr>'}</tbody>
  </table>

  <p style="margin:0 0 4px"><strong>Total: ${fmtBRL(pedido.valor_total)}</strong></p>
  <p style="margin:0 0 4px;font-size:14px">Entrega prevista: ${fmtData(pedido.data_limite_entrega)}</p>
  ${pedido.forma_pagamento ? `<p style="margin:0 0 4px;font-size:14px">Pagamento: ${esc(pedido.forma_pagamento)}</p>` : ""}
  ${pedido.local_entrega ? `<p style="margin:0 0 4px;font-size:14px">Local de entrega: ${esc(pedido.local_entrega)}</p>` : ""}
  <p style="margin:0 0 16px;font-size:14px">Frete: ${pedido.frete_incluso ? "incluso" : "não incluso"}</p>

  <p style="margin:24px 0">
    <a href="${link}"
       style="display:inline-block;background:#0f3171;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">
      Ver o pedido e confirmar
    </a>
  </p>

  <p style="font-size:12px;color:#6b7280;margin:0">
    Ao abrir o link acima você confirma o recebimento deste pedido. Se o botão
    não funcionar, copie e cole no navegador:<br>
    <span style="word-break:break-all">${link}</span>
  </p>
</div>`;
}

async function enviarPedidosPendentes(supabase, transportador) {
  if (!transportador) return;

  const { data: pendentes, error } = await supabase
    .from("sup_compra_pedido_envio")
    .select("id, pedido_id, email_destino, token")
    .is("enviado_em", null)
    .is("erro_envio", null)
    .order("criado_em", { ascending: true })
    .limit(POR_CICLO);
  if (error) throw error;
  if (!pendentes || !pendentes.length) return;

  for (const env of pendentes) {
    try {
      const { data: dados, error: erroDados } = await supabase.rpc(
        "sup_compra_pedido_por_token",
        { p_token: env.token },
      );
      if (erroDados) throw erroDados;
      if (!dados || dados.erro) throw new Error(dados?.erro || "pedido não encontrado");

      const link = `${BASE_APP}/pedido/confirmar/${env.token}`;
      const pedido = dados.pedido || {};

      await transportador.sendMail({
        from: process.env.SMTP_USER,
        to: env.email_destino,
        subject: `Pedido de compra ${pedido.numero ?? ""} — ${pedido.empresa_nome ?? ""}`.trim(),
        html: montarHtml({ pedido, itens: dados.itens || [], link }),
      });

      await supabase
        .from("sup_compra_pedido_envio")
        .update({ enviado_em: new Date().toISOString() })
        .eq("id", env.id);

      console.log(`[pedido] ${pedido.numero} enviado para ${env.email_destino}`);
    } catch (e) {
      const motivo = String(e && e.message ? e.message : e).slice(0, 400);
      // Grava o erro e PARA de tentar este envio.
      //
      // E-mail que falha costuma falhar de novo pelo mesmo motivo (endereço
      // inexistente, caixa cheia). Retentar sozinho encheria a caixa do
      // fornecedor no dia em que voltasse, e esconderia o problema de quem
      // precisa corrigir o cadastro. A tela mostra o erro e alguém reenvia.
      await supabase
        .from("sup_compra_pedido_envio")
        .update({ erro_envio: motivo })
        .eq("id", env.id);
      console.error(`[pedido] falha ao enviar ${env.id}: ${motivo}`);
    }
  }
}

module.exports = { enviarPedidosPendentes, montarHtml };
