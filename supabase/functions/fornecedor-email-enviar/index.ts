// Arquivo: supabase/functions/fornecedor-email-enviar/index.ts
//
// Envia o e-mail escrito na caixa de Fornecedores (Suprimentos) e grava o
// resultado em "SUP_FORNECEDOR_EMAIL" (migration 20261106009500).
// O miolo (validar, anexar, enviar, gravar) está em _shared/caixa-email.ts,
// junto com o módulo E-mail; aqui fica só o que é desta caixa.
//
// Portão: JWT do usuário + has_screen_access('fornecedores_email','incluir').
// Só esta function marca uma mensagem como enviada/falhou (service role); a
// RLS deixa a tela mexer apenas no próprio rascunho.
//
// REMETENTE: o "De" NÃO é livre. O Resend só entrega pelo domínio verificado,
// então o endereço vem do secret SUPRIMENTOS_EMAIL_FROM (ou SMTP_FROM, ou
// SMTP_USER — o mesmo de comite-etica-nova-denuncia). O nome de exibição leva
// o nome de quem escreveu e o Reply-To o e-mail do login: o fornecedor
// responde direto para a pessoa, não para uma caixa que ninguém lê.
//
// Secrets: RESEND_API_KEY (preferido) ou SMTP_HOST/PORT/USER/PASS;
// SUPRIMENTOS_EMAIL_FROM opcional.

import { nomeSeguro, servirCaixaEmail, soEndereco } from "../_shared/caixa-email.ts";

const FROM_CRU = Deno.env.get("SUPRIMENTOS_EMAIL_FROM") || Deno.env.get("SMTP_FROM") || Deno.env.get("SMTP_USER") || "";

servirCaixaEmail({
  menu: "fornecedores_email",
  acao: "incluir",
  mensagemSemAcesso: "Você não tem a ação 'incluir' em Fornecedores — E-mails.",
  tabela: "SUP_FORNECEDOR_EMAIL",
  bucket: "sup-fornecedor-email",
  remetente: async (_admin, u) => {
    const de = soEndereco(FROM_CRU);
    return {
      de_nome: nomeSeguro(`${u.nomePerfil} · Suprimentos Grupo Nascimento`),
      de_email: de || null,
      responder_para: u.emailLogin || null,
      motivo: de ? undefined : "Remetente não configurado no servidor (SUPRIMENTOS_EMAIL_FROM / SMTP_FROM).",
    };
  },
  colunasExtras: (corpo) => ({
    // Fornecedores ligados à mensagem (os donos dos endereços escolhidos).
    fornecedor_ids: Array.isArray(corpo?.fornecedor_ids)
      ? (corpo.fornecedor_ids as unknown[]).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x))
      : [],
  }),
});
