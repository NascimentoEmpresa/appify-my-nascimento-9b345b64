// ============================================================================
//  MONTAR A MISTURA DE TRÁFEGO A PARTIR DO LOG REAL DO KONG
//
//  Uso: node infra/carga/montar-mix.mjs ./incidente-2026-11-03/kong.log.gz > mix.json
//
//  O teste de carga não inventa requisição: ele repete as que o ERP fez de
//  verdade num dia, NA MESMA PROPORÇÃO. Uma rota que foi 10 % do tráfego
//  daquele dia é 10 % do teste. Assim "o sistema aguenta N req/s" quer dizer
//  N req/s DO NOSSO tráfego, com as telas pesadas no peso que elas têm.
//
//  Só leitura: GET e HEAD de /rest/v1. POST de RPC entra apenas para as RPCs
//  da lista LEITURA_RPC abaixo (conferidas no código: não gravam nada), com o
//  corpo que o frontend manda. Todo o resto (auth, storage, functions, POST,
//  PATCH, DELETE) fica de fora: teste de carga não pode escrever na produção.
//
//  Para cada rota guarda até 40 URLs reais diferentes (com os filtros que o
//  usuário usou); o peso da rota é a contagem do dia.
// ============================================================================
import fs from "node:fs";
import zlib from "node:zlib";
import readline from "node:readline";

const arq = process.argv[2];
if (!arq) { console.error("uso: node montar-mix.mjs <kong.log.gz>"); process.exit(1); }

// RPCs de leitura que o boot e as telas mais chamam. {USER} vira o id do
// usuário do token na hora do teste.
const LEITURA_RPC = {
  has_screen_access: [
    { _user: "{USER}", _menu: "malote_aprovacoes", _acao: "visualizar", _empresa: null },
    { _user: "{USER}", _menu: "sup_pedidos_materiais", _acao: "visualizar", _empresa: null },
    { _user: "{USER}", _menu: "chamados_sistemas", _acao: "visualizar", _empresa: null },
  ],
  list_accessible_menus: [{ _user: "{USER}", _acao: "visualizar", _empresa: null }],
  list_configured_menu_codes: [{}],
  presenca_listar: [{}],
  sis_status_dev_telas: [{}],
  sistema_saude: [{}],
  fluxo_caixa_ler_fonte: [
    { p_fonte: "v_fluxo_caixa_importado_fluxo_caixa" },
    { p_fonte: "v_debito_automatico_fluxo_caixa" },
  ],
};

const rx = /\] "(GET|HEAD|POST) (\/rest\/v1\/[^ ]+) HTTP\/[\d.]+" (\d{3})/;
const norm = (p) => p.split("?")[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id");
const rotas = new Map(); // chave -> { metodo, peso, urls:Set, rpc?, corpos? }

const rl = readline.createInterface({ input: fs.createReadStream(arq).pipe(zlib.createGunzip()), crlfDelay: Infinity });
for await (const bruto of rl) {
  const m = bruto.split('\\"').join('"').match(rx);
  if (!m) continue;
  const [, metodo, url] = m;
  const caminho = norm(url);
  if (metodo === "POST") {
    const nome = caminho.startsWith("/rest/v1/rpc/") ? caminho.slice(13) : null;
    if (!nome || !LEITURA_RPC[nome]) continue;
    const k = `POST ${caminho}`;
    const r = rotas.get(k) ?? { metodo, caminho, peso: 0, rpc: nome, corpos: LEITURA_RPC[nome] };
    r.peso++; rotas.set(k, r);
    continue;
  }
  if (caminho.startsWith("/rest/v1/rpc/")) continue;
  const k = `${metodo} ${caminho}`;
  const r = rotas.get(k) ?? { metodo, caminho, peso: 0, urls: new Set() };
  r.peso++;
  if (r.urls.size < 40) r.urls.add(url.replace(/\\u0026/g, "&"));
  rotas.set(k, r);
}

const lista = [...rotas.values()]
  .filter((r) => r.peso >= 20)                  // rota que apareceu menos de 20x no dia não pesa
  .map((r) => ({ metodo: r.metodo, caminho: r.caminho, peso: r.peso, urls: r.urls ? [...r.urls] : undefined, corpos: r.corpos }))
  .sort((a, b) => b.peso - a.peso);
const total = lista.reduce((s, r) => s + r.peso, 0);
console.error(`${lista.length} rotas, ${total} requisições de leitura no dia de referência`);
process.stdout.write(JSON.stringify({ origem: arq, total, rotas: lista }, null, 0));
