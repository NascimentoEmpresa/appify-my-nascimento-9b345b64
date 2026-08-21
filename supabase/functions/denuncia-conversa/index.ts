// Arquivo: supabase/functions/denuncia-conversa/index.ts
// Conversa do denunciante com o Comitê de Ética, sem login.
//
// POR QUE EXISTE
// Mesma razão de denuncia-registrar/denuncia-consultar: o navegador manda JSON
// puro, SEM nenhum header de autenticação, e quem guarda a chave é esta função.
// Nenhum token passa pelo cliente.
//
// Duas operações no mesmo endpoint porque são a mesma sessão lógica: abrir a
// conversa (lista + marca as do comitê como lidas) e responder. Quem decide é
// a presença de `mensagem` no corpo.
//
// A credencial é conferida a CADA chamada pela RPC (e-mail + senha contra o
// hash bcrypt). Não existe sessão nem cookie: mandar o protocolo de outra
// pessoa não adianta, porque a senha não confere com a linha dela.
//
// verify_jwt = false no config.toml — público de propósito.
// ANONIMATO: não loga corpo, IP nem user-agent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// "authorization" fica FORA do allow-headers de propósito: se um dia alguém
// mandar um token daqui, o navegador barra antes de sair.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: { identificador?: string; email?: string; senha?: string; protocolo?: string; mensagem?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido." }, 400);
  }

  // E-mail OU protocolo: o relato anônimo não tem e-mail, e é a mesma
  // conversa. `email` segue aceito para não quebrar tela em cache.
  const identificador = (body?.identificador ?? body?.email ?? "").trim();
  // A senha não é normalizada: é escolhida pela pessoa e gravada como veio.
  const senha = body?.senha ?? "";
  const protocolo = (body?.protocolo ?? "").trim();
  const mensagem = (body?.mensagem ?? "").trim();

  if (!identificador || !senha || !protocolo) {
    return json({ error: "Informe o e-mail (ou o protocolo), a senha e o número do protocolo." }, 400);
  }

  const sb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

  if (mensagem) {
    const { error } = await sb.rpc("denuncia_responder", {
      p_identificador: identificador, p_senha: senha, p_protocolo: protocolo, p_mensagem: mensagem,
    });
    if (error) return json({ error: error.message || "Não foi possível enviar agora." }, 400);
  }

  // Sempre devolve o fio atualizado — inclusive logo depois de enviar, para a
  // tela não precisar de uma segunda chamada só para mostrar o que acabou de
  // escrever.
  const { data, error } = await sb.rpc("denuncia_mensagens", {
    p_identificador: identificador, p_senha: senha, p_protocolo: protocolo,
  });

  // 400 para tudo: 401/404 distintos entregariam de graça se o protocolo
  // existe, que é justamente o que a RPC evita.
  if (error) return json({ error: error.message || "Não foi possível carregar a conversa." }, 400);
  return json(data);
});
