// Edge function: ponte única com a API dos Correios (CWS).
//
// Duas ações, as duas SOMENTE DE LEITURA:
//   • rastrear — situação dos objetos postados (API SRO Rastro)
//   • cep      — endereço a partir do CEP (API CEP)
//
// Por que uma função só, e não uma por ação: as duas precisam do mesmo token,
// e o token exige cache (ver abaixo). Separar em duas funções duplicaria a
// lógica de token — e importar de `_shared` impediria a publicação pelo editor
// web do Supabase, que quebra com import relativo para fora da pasta.
//
// A credencial NUNCA vai para o browser. O código de acesso fica em secret da
// própria function; o frontend só chama esta ponte, já autenticado no ERP.
//
// ── Sobre o token ────────────────────────────────────────────────────
// O *código de acesso* dos Correios não expira (a tela do CWS diz "validade
// indeterminada"). O *token* derivado dele dura 24h, e a API de token aceita
// no máximo 3 requisições por segundo — pedir um token por chamada estouraria
// o limite com o painel de pedidos aberto. Por isso o token é guardado em
// `correios_token` e reaproveitado até faltar pouco para vencer.
//
// Edge Function é efêmera: cache em memória do processo não sobrevive entre
// invocações, então o cache PRECISA ser em tabela.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API = "https://api.correios.com.br";

/** Margem de renovação: os Correios já devolvem token novo a 30 min do fim. */
const MARGEM_MS = 30 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Devolve um token válido, reaproveitando o que está em `correios_token`.
 *
 * O token é emitido no escopo do CARTÃO DE POSTAGEM, não do idCorreios: o
 * Rastro só devolve objetos do contrato do remetente, e é o token de cartão
 * que carrega esse vínculo.
 */
async function obterToken(admin: ReturnType<typeof createClient>): Promise<string> {
  const { data: cache } = await admin
    .from("correios_token")
    .select("token, expira_em")
    .eq("id", 1)
    .maybeSingle();

  if (cache?.token && cache.expira_em) {
    const restante = new Date(cache.expira_em).getTime() - Date.now();
    if (restante > MARGEM_MS) return cache.token as string;
  }

  const usuario = Deno.env.get("CORREIOS_API_USUARIO");
  const codigo = Deno.env.get("CORREIOS_API_CODIGO");
  const cartao = Deno.env.get("CORREIOS_CARTAO_POSTAGEM");
  if (!usuario || !codigo || !cartao) {
    throw new Error(
      "Integração com os Correios não configurada — faltam os secrets CORREIOS_API_USUARIO, CORREIOS_API_CODIGO e CORREIOS_CARTAO_POSTAGEM.",
    );
  }

  const resp = await fetch(`${API}/token/v1/autentica/cartaopostagem`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${usuario}:${codigo}`)}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ numero: cartao }),
  });

  if (!resp.ok) {
    // 401 aqui quase sempre significa código de acesso regerado no CWS: gerar
    // um novo invalida o anterior na hora. Vale dizer isso, senão a mensagem
    // manda procurar problema em rede.
    const detalhe = resp.status === 401
      ? "Código de acesso recusado — ele pode ter sido regerado no CWS. Atualize o secret CORREIOS_API_CODIGO."
      : `Falha ao autenticar nos Correios (HTTP ${resp.status}).`;
    throw new Error(detalhe);
  }

  const dados = await resp.json();
  await admin.from("correios_token").upsert({
    id: 1,
    token: dados.token,
    expira_em: dados.expiraEm,
    atualizado_em: new Date().toISOString(),
  });
  return dados.token as string;
}

/** Chamada às APIs de negócio, já com o Bearer. */
async function comToken(token: string, caminho: string) {
  const resp = await fetch(`${API}${caminho}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  return { status: resp.status, corpo: await resp.json().catch(() => null) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

    // Quem chama precisa ser um usuário do ERP. Sem isso a ponte viraria um
    // proxy aberto para o contrato dos Correios da empresa.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { acao, codigos, cep } = await req.json().catch(() => ({}));

    if (acao === "rastrear") {
      const lista: string[] = Array.isArray(codigos)
        ? [...new Set(codigos.map((c: string) => String(c ?? "").trim().toUpperCase()).filter(Boolean))]
        : [];
      if (lista.length === 0) return json({ objetos: [] });
      // O SRO aceita no máximo 50 códigos por chamada.
      if (lista.length > 50) return json({ error: "Máximo de 50 objetos por consulta." }, 400);

      const token = await obterToken(admin);
      const query = lista.map((c) => `codigosObjetos=${encodeURIComponent(c)}`).join("&");
      // resultado=U traz só o último evento — é o que o card mostra, e evita
      // trafegar o histórico inteiro de 50 objetos a cada abertura da tela.
      const { status, corpo } = await comToken(token, `/srorastro/v1/objetos?${query}&resultado=U`);
      if (status !== 200) {
        return json({ error: `Correios respondeu ${status} ao rastrear.`, detalhe: corpo }, 502);
      }

      const objetos = (corpo?.objetos ?? []).map((o: any) => {
        const evento = (o.eventos ?? [])[0] ?? null;
        return {
          codigo: o.codObjeto,
          // Objeto inexistente ou de outro contrato vem com `mensagem` no
          // lugar dos eventos — é informação, não erro.
          mensagem: o.mensagem ?? null,
          descricao: evento?.descricao ?? null,
          data: evento?.dtHrCriado ?? null,
          local: evento?.unidade?.endereco
            ? `${evento.unidade.endereco.cidade ?? ""}${evento.unidade.endereco.uf ? "-" + evento.unidade.endereco.uf : ""}`
            : null,
          entregue: /entregue ao destinat/i.test(evento?.descricao ?? ""),
        };
      });
      return json({ objetos });
    }

    if (acao === "cep") {
      const limpo = String(cep ?? "").replace(/\D/g, "");
      if (limpo.length !== 8) return json({ error: "CEP deve ter 8 dígitos." }, 400);

      const token = await obterToken(admin);
      const { status, corpo } = await comToken(token, `/cep/v1/enderecos/${limpo}`);
      if (status === 404) return json({ error: "CEP não encontrado." }, 404);
      if (status !== 200) {
        return json({ error: `Correios respondeu ${status} ao consultar o CEP.`, detalhe: corpo }, 502);
      }

      return json({
        cep: corpo.cep,
        logradouro: corpo.logradouro ?? null,
        complemento: corpo.complemento ?? null,
        bairro: corpo.bairro ?? null,
        cidade: corpo.localidade ?? corpo.nomeMunicipio ?? null,
        uf: corpo.uf ?? null,
      });
    }

    return json({ error: "Ação inválida. Use 'rastrear' ou 'cep'." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message ?? "Erro inesperado." }, 500);
  }
});
