// Arquivo: supabase/functions/email-enviar/index.ts
//
// Módulo E-mail (/app/email): cada pessoa envia do PRÓPRIO endereço e a
// mensagem fica em "EMAIL_MENSAGEM" (migration 20261106010000).
// Miolo compartilhado com Fornecedores em _shared/caixa-email.ts.
//
// Portão: JWT do usuário + has_screen_access('email','incluir').
//
// O "DE" É AMARRADO AO LOGIN — o Resend envia como qualquer endereço do
// domínio verificado sem senha, então se a tela escolhesse o remetente
// qualquer usuário mandaria como a diretoria. Ordem:
//   1. "EMAIL_REMETENTE" ativo do usuário (o admin define em
//      /app/email/remetentes); senão
//   2. o e-mail do login, se for @haggltda.com.br (lista trocável pelo
//      secret EMAIL_DOMINIOS, separada por vírgula); senão
//   3. não envia, e a tela explica o motivo.
// Reply-To não é usado: a resposta já volta para o próprio endereço.
//
// O domínio do remetente precisa estar verificado no Resend (SPF/DKIM no
// DNS), senão o Resend devolve "domain is not verified" e a mensagem vai
// para Falhas com esse texto.
//
// Secrets: RESEND_API_KEY (ou SMTP_*); EMAIL_DOMINIOS opcional (padrão haggltda.com.br).

import { nomeSeguro, servirCaixaEmail } from "../_shared/caixa-email.ts";

// O e-mail da empresa é sempre @haggltda.com.br (Pablo, 06/11/2026) — vira o
// padrão, sem depender de cadastrar secret. EMAIL_DOMINIOS só existe para
// SUBSTITUIR a lista se um dia entrar outro domínio. Domínio não é segredo.
const DOMINIOS = (Deno.env.get("EMAIL_DOMINIOS") || "haggltda.com.br")
  .split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);

servirCaixaEmail({
  menu: "email",
  acao: "incluir",
  mensagemSemAcesso: "Você não tem a ação 'incluir' em E-mail.",
  tabela: "EMAIL_MENSAGEM",
  bucket: "email-anexos",
  remetente: async (admin, u) => {
    const { data: r } = await admin.from("EMAIL_REMETENTE")
      .select("email, nome_exibicao, ativo").eq("user_id", u.uid).maybeSingle();
    if (r?.ativo && r.email) {
      return {
        de_nome: nomeSeguro(String(r.nome_exibicao || u.nomePerfil)),
        de_email: String(r.email).toLowerCase(),
        responder_para: null,
      };
    }
    const dominio = u.emailLogin.split("@")[1] ?? "";
    if (u.emailLogin && DOMINIOS.includes(dominio)) {
      return { de_nome: u.nomePerfil, de_email: u.emailLogin, responder_para: null };
    }
    return {
      de_nome: u.nomePerfil,
      de_email: null,
      responder_para: null,
      motivo: r && !r.ativo
        ? "Seu endereço de envio está desativado. Fale com o administrador do E-mail."
        : "Seu login não tem um e-mail da empresa cadastrado para envio. Peça ao administrador do E-mail para definir o seu endereço.",
    };
  },
});
