// Edge function: ponte única com a API dos Correios (CWS).
//
// Três ações, todas SOMENTE DE LEITURA — nada aqui posta ou cria objeto:
//   • rastrear — situação dos objetos postados (API SRO Rastro)
//   • cep      — endereço a partir do CEP (API CEP)
//   • cotar    — preço e prazo antes de postar (APIs Preço e Prazo)
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

/**
 * SEDEX Contrato AG — o produto que a empresa usa em 100% das postagens
 * (confirmado nos cupons da agência de Triunfo). Fica fixo aqui, e não como
 * parâmetro vindo da tela, porque um código de produto que o contrato não tem
 * é recusado pela API com erro obscuro: melhor uma constante conferida do que
 * um campo livre para digitar errado.
 */
const PRODUTO = "03220";

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
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      // OBRIGATÓRIO no SRO Rastro, e não é opcional nem tem equivalente em
      // query string: sem este header a API recusa TODA consulta de rastreio
      // com "SRO-018: Permitido apenas os valores pt-BR, en e es-ES para o
      // idioma" — inclusive a requisição mínima, só com o código do objeto.
      // Medido contra a API em 09/09/2026. `idioma=pt-BR` na URL não resolve.
      "Accept-Language": "pt-BR",
    },
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
    const { acao, codigos, codigo: codigoUnico, cep, cotacao } = await req.json().catch(() => ({}));

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

    // Trajeto COMPLETO de UM objeto — o que alimenta o mapa.
    //
    // Separado de `rastrear` porque a diferença é `resultado=T` (todos os
    // eventos) contra `resultado=U` (só o último). Pedir o histórico inteiro
    // dos 50 objetos da tela a cada abertura seria trafegar centenas de
    // eventos para mostrar um badge de uma linha.
    if (acao === "trajeto") {
      const codigo = String(codigoUnico ?? "").trim().toUpperCase();
      if (!codigo) return json({ error: "Informe o código do objeto." }, 400);

      const token = await obterToken(admin);
      const { status, corpo } = await comToken(
        token,
        `/srorastro/v1/objetos?codigosObjetos=${encodeURIComponent(codigo)}&resultado=T`,
      );
      if (status !== 200) {
        return json({ error: `Correios respondeu ${status} ao rastrear.`, detalhe: corpo }, 502);
      }

      const o = (corpo?.objetos ?? [])[0] ?? null;
      if (!o) return json({ codigo, mensagem: "Objeto não encontrado.", eventos: [] });

      // Os Correios devolvem do mais NOVO para o mais velho. Quem lê um
      // trajeto lê na ordem em que aconteceu, então a inversão é feita aqui,
      // uma vez, e não em cada tela que consumir isto.
      const eventos = [...(o.eventos ?? [])].reverse().map((e: any) => ({
        descricao: e.descricao ?? null,
        data: e.dtHrCriado ?? null,
        cidade: e.unidade?.endereco?.cidade ?? null,
        uf: e.unidade?.endereco?.uf ?? null,
        // O destino do evento de transferência: é ele que revela a próxima
        // parada antes de o objeto chegar lá.
        destinoCidade: e.unidadeDestino?.endereco?.cidade ?? null,
        destinoUf: e.unidadeDestino?.endereco?.uf ?? null,
      }));

      return json({ codigo: o.codObjeto ?? codigo, mensagem: o.mensagem ?? null, eventos });
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

    if (acao === "cotar") {
      const { cepOrigem, cepDestino, pesoKg, comprimento, largura, altura, valorDeclarado } = cotacao ?? {};
      const oCep = String(cepOrigem ?? "").replace(/\D/g, "");
      const dCep = String(cepDestino ?? "").replace(/\D/g, "");
      if (oCep.length !== 8 || dCep.length !== 8) {
        return json({ error: "Informe o CEP do remetente e o do destinatário." }, 400);
      }
      // Gramas: é a unidade que a API espera em psObjeto.
      const gramas = Math.round(Number(pesoKg ?? 0) * 1000);
      if (!Number.isFinite(gramas) || gramas <= 0) {
        return json({ error: "Informe o peso total, em quilos." }, 400);
      }
      const dim = { c: Number(comprimento ?? 0), l: Number(largura ?? 0), a: Number(altura ?? 0) };
      if (![dim.c, dim.l, dim.a].every((n) => Number.isFinite(n) && n > 0)) {
        return json({ error: "Informe comprimento, largura e altura, em centímetros." }, 400);
      }

      const token = await obterToken(admin);

      // tpObjeto=2 é PACOTE — é o que o cupom da agência imprime em todos os
      // envios da empresa. O adicional 019 (Valor Declarado) só entra quando
      // há valor: mandá-lo zerado faz a API recusar.
      const params = new URLSearchParams({
        cepOrigem: oCep,
        cepDestino: dCep,
        psObjeto: String(gramas),
        tpObjeto: "2",
        comprimento: String(dim.c),
        largura: String(dim.l),
        altura: String(dim.a),
      });
      const declarado = Number(valorDeclarado ?? 0);
      if (Number.isFinite(declarado) && declarado > 0) {
        params.set("servicosAdicionais", "019");
        params.set("vlDeclarado", String(declarado));
      }

      const preco = await comToken(token, `/preco/v1/nacional/${PRODUTO}?${params.toString()}`);
      if (preco.status !== 200) {
        return json({ error: `Correios respondeu ${preco.status} ao cotar o preço.`, detalhe: preco.corpo }, 502);
      }

      // Prazo é uma chamada separada, e não é fatal: sem ela ainda vale mostrar
      // o preço. Por isso o resultado é opcional, não um erro.
      const prazo = await comToken(
        token,
        `/prazo/v1/nacional/${PRODUTO}?cepOrigem=${oCep}&cepDestino=${dCep}`,
      );

      return json({
        produto: PRODUTO,
        // Vêm no formato brasileiro ("129,47"), não como número.
        precoTotal: preco.corpo?.pcFinal ?? null,
        precoProduto: preco.corpo?.pcBaseGeral ?? null,
        adicionais: (preco.corpo?.servicoAdicional ?? []).map((s: any) => ({
          codigo: s.coServAdicional,
          valor: s.pcServicoAdicional,
        })),
        // Peso cobrado pode ser maior que o real quando o volume "cubado"
        // pesa mais que a balança — é o que explica cupom acima do esperado.
        pesoCobradoKg: preco.corpo?.psCobrado ?? null,
        prazoDias: prazo.status === 200 ? prazo.corpo?.prazoEntrega ?? null : null,
        prazoAte: prazo.status === 200 ? prazo.corpo?.dataMaxima ?? null : null,
      });
    }

    return json({ error: "Ação inválida. Use 'rastrear', 'cep' ou 'cotar'." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message ?? "Erro inesperado." }, 500);
  }
});
