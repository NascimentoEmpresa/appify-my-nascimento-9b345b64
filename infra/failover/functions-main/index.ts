// ============================================================================
//  Roteador das Edge Functions da replica
// ============================================================================
//
//  POR QUE ISTO EXISTE
//  O runtime da Supabase (supabase/edge-runtime) nao descobre as funcoes
//  sozinho: ele sobe UM "main service" que recebe toda requisicao e decide
//  qual funcao carregar. Na Supabase gerenciada esse papel e da plataforma
//  deles; aqui e este arquivo.
//
//  POR QUE ELE LE O config.toml
//  O exemplo oficial de self-hosted usa uma variavel unica, VERIFY_JWT, valendo
//  para todas as funcoes. Neste ERP isso nao serve: das 59 funcoes, 45 exigem
//  JWT e 14 sao publicas de proposito (Canal de Etica, Portal do Colaborador,
//  webhook da Meta, as chamadas pelo CI). Um interruptor global quebraria um
//  dos dois lados:
//    - ligado  -> o formulario publico de denuncia para de funcionar;
//    - deslig. -> funcoes administrativas perdem a primeira tranca.
//  Entao aqui a regra vem do MESMO supabase/config.toml que vale na producao.
//  Se alguem acrescentar uma funcao la, a replica acompanha sem editar isto.
//
//  PADRAO DA SUPABASE: funcao nao listada no config.toml exige JWT.
//  Mantemos igual — o default e fechado.
//
//  A verificacao do JWT e feita na mao com Web Crypto (HS256) para nao
//  depender de baixar biblioteca no boot: numa queda da Supabase, a replica
//  precisa subir mesmo com a internet ruim.
// ============================================================================

const PASTA_FUNCOES = "/home/deno/functions";
const CAMINHO_CONFIG = "/home/deno/config.toml";
const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";

// --- quais funcoes sao publicas, segundo o config.toml ----------------------
function lerPublicas(): Set<string> {
  const publicas = new Set<string>();
  let texto: string;
  try {
    texto = Deno.readTextFileSync(CAMINHO_CONFIG);
  } catch (e) {
    // Sem o config.toml nao da para saber o que e publico. Fechar tudo seria
    // derrubar o Canal de Etica em silencio; abrir tudo seria pior. Falamos
    // alto e fechamos.
    console.error(`[main] NAO LI ${CAMINHO_CONFIG}: ${e}. Todas as funcoes vao exigir JWT.`);
    return publicas;
  }
  let atual: string | null = null;
  for (const linha of texto.split(/\r?\n/)) {
    const cabecalho = linha.match(/^\s*\[functions\.([A-Za-z0-9_-]+)\]\s*$/);
    if (cabecalho) {
      atual = cabecalho[1];
      continue;
    }
    if (/^\s*\[/.test(linha)) {
      atual = null;
      continue;
    }
    if (atual && /^\s*verify_jwt\s*=\s*false\s*$/.test(linha)) {
      publicas.add(atual);
      atual = null;
    }
  }
  return publicas;
}

const PUBLICAS = lerPublicas();
console.log(`[main] ${PUBLICAS.size} funcoes publicas no config.toml: ${[...PUBLICAS].join(", ")}`);

// --- verificacao de JWT HS256 ----------------------------------------------
const b64urlParaBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

let chaveHmac: CryptoKey | null = null;
async function obterChave(): Promise<CryptoKey> {
  if (!chaveHmac) {
    chaveHmac = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
  }
  return chaveHmac;
}

async function jwtValido(token: string): Promise<boolean> {
  const partes = token.split(".");
  if (partes.length !== 3) return false;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await obterChave(),
      b64urlParaBytes(partes[2]),
      new TextEncoder().encode(`${partes[0]}.${partes[1]}`),
    );
    if (!ok) return false;
    const corpo = JSON.parse(new TextDecoder().decode(b64urlParaBytes(partes[1])));
    // exp e opcional no padrao, mas todo token que a Supabase emite tem.
    if (typeof corpo.exp === "number" && corpo.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

const json = (corpo: unknown, status: number) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });

// --- despacho ---------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const nome = url.pathname.split("/").filter(Boolean)[0];

  if (!nome || nome === "_internal") {
    return json({ replica: true, funcoes_publicas: PUBLICAS.size }, 200);
  }

  // O preflight do navegador nunca leva Authorization. Respondendo aqui, o
  // CORS funciona ate para as funcoes que exigem JWT.
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers":
          "authorization, x-client-info, apikey, content-type, x-worker-secret, x-chamados-ci-secret",
        "access-control-allow-methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
      },
    });
  }

  try {
    await Deno.stat(`${PASTA_FUNCOES}/${nome}`);
  } catch {
    return json({ erro: `funcao '${nome}' nao existe nesta replica` }, 404);
  }

  if (!PUBLICAS.has(nome)) {
    const cabecalho = req.headers.get("authorization") ?? "";
    const token = cabecalho.toLowerCase().startsWith("bearer ") ? cabecalho.slice(7).trim() : "";
    if (!token || !(await jwtValido(token))) {
      return json({ erro: "JWT invalido ou ausente", funcao: nome }, 401);
    }
  }

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `${PASTA_FUNCOES}/${nome}`,
      memoryLimitMb: 256,
      workerTimeoutMs: 180_000,
      noModuleCache: false,
      envVars: Object.entries(Deno.env.toObject()),
    });
    return await worker.fetch(req);
  } catch (e) {
    console.error(`[main] falha em '${nome}':`, e);
    return json({ erro: String(e), funcao: nome }, 500);
  }
});
