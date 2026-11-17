// =====================================================================
// rotas-da-pr.cjs — de "arquivos alterados na PR" para "URLs das telas"
// (12/11/2026, pedido do Pablo: ao abrir a PR o chamado conclui e o
// solicitante recebe no chat um resumo do que foi feito "e as URLS pra ele
// acessar").
//
// Usado pelo .github/workflows/chamado_concluir_no_merge.yml (job da PR
// aberta). Só LÊ TEXTO: o src/App.tsx da PR chega como string pela API do
// GitHub e é analisado com expressões regulares — nada do código da PR é
// executado (o workflow roda em pull_request_target, com secrets).
//
// Como acha a tela de um arquivo:
//   1. mapa componente → módulo pelos imports do App.tsx (import X from
//      "./pages/..." e lazy(() => import("./pages/...")));
//   2. mapa rota → componente pelos <Route path=... element={...}>, com os
//      caminhos relativos somados ao pai (/app/...);
//   3. arquivo da PR em src/pages: a tela do próprio arquivo ou, se for um
//      componente de apoio, as telas da pasta mais próxima acima dele.
// Rotas com parâmetro (":id") ficam de fora — não dá para montar o link.
// Testado em src/test/rotas-da-pr.test.ts.
// =====================================================================

const URL_APP = "https://app.grpnascimento.com.br";
const MAX_URLS = 8;

const semExtensao = (p) => p.replace(/\.(tsx|ts|jsx|js)$/, "").replace(/\/index$/, "");
const pastaDe = (p) => p.slice(0, Math.max(0, p.lastIndexOf("/")));

/** componente → "src/pages/..." (sem extensão). */
function importsDePaginas(app) {
  const mapa = new Map();
  const reImport = /import\s+(\w+)\s+from\s+["']\.\/(pages\/[^"']+)["']/g;
  const reLazy = /const\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*["']\.\/(pages\/[^"']+)["']\s*\)\s*\)/g;
  for (const re of [reImport, reLazy]) {
    let m;
    while ((m = re.exec(app))) mapa.set(m[1], semExtensao(`src/${m[2]}`));
  }
  return mapa;
}

/** Fecha o { ... } que abre em `inicio` (o índice do "{"). */
function fimDasChaves(texto, inicio) {
  let n = 0;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === "{") n++;
    else if (texto[i] === "}") { n--; if (n === 0) return i; }
  }
  return -1;
}

const juntar = (pai, filho) => {
  if (filho.startsWith("/")) return filho;
  const base = pai.endsWith("/") ? pai.slice(0, -1) : pai;
  return filho ? `${base}/${filho}` : base || "/";
};

/** [{ caminho, componentes[] }] — caminhos absolutos, com o aninhamento resolvido. */
function rotasDoApp(app) {
  const rotas = [];
  const pilha = [""];
  const re = /<Route\b|<\/Route>/g;
  let m;
  while ((m = re.exec(app))) {
    if (m[0] === "</Route>") { if (pilha.length > 1) pilha.pop(); continue; }
    // Atributos até o fim da tag (pulando o element={...}, que tem "/>" dentro).
    let i = m.index + m[0].length;
    let attrs = "";
    let elemento = "";
    let autoFecha = false;
    while (i < app.length) {
      if (app.startsWith("element={", i)) {
        const ini = i + "element=".length;
        const fim = fimDasChaves(app, ini);
        if (fim < 0) break;
        elemento = app.slice(ini, fim + 1);
        i = fim + 1;
        continue;
      }
      if (app.startsWith("/>", i)) { autoFecha = true; break; }
      if (app[i] === ">") break;
      attrs += app[i];
      i++;
    }
    re.lastIndex = i;
    const path = /path="([^"]*)"/.exec(attrs)?.[1];
    const pai = pilha[pilha.length - 1];
    const caminho = path === undefined ? pai : juntar(pai, path);
    const componentes = [...elemento.matchAll(/<([A-Z]\w*)/g)].map((x) => x[1]);
    rotas.push({ caminho, componentes });
    if (!autoFecha) pilha.push(caminho);
  }
  return rotas;
}

/**
 * Telas (URLs completas) mexidas pela PR.
 * @param {string} app - conteúdo do src/App.tsx (da PR)
 * @param {string[]} arquivos - caminhos alterados na PR
 * @returns {{ url: string, caminho: string }[]}
 */
function urlsDaPr(app, arquivos) {
  const imports = importsDePaginas(app);
  // módulo → caminhos (só os sem parâmetro e dentro do /app ou públicos).
  const porModulo = new Map();
  // Telas que têm rota, mesmo só com parâmetro: arquivo delas não cai no
  // "pasta mais próxima" (a tela do chamado /:id não é a lista de PRs).
  const comRota = new Set();
  for (const r of rotasDoApp(app)) {
    for (const c of r.componentes) { const mod = imports.get(c); if (mod) comRota.add(mod); }
    if (!r.caminho || r.caminho.includes(":") || r.caminho.includes("*")) continue;
    for (const c of r.componentes) {
      const mod = imports.get(c);
      if (!mod) continue;
      if (!porModulo.has(mod)) porModulo.set(mod, new Set());
      porModulo.get(mod).add(r.caminho);
    }
  }
  const achados = [];
  const comRotaNaPasta = (pasta) => [...comRota].filter((m) => pastaDe(m) === pasta);
  const add = (mod) => { for (const c of porModulo.get(mod) ?? []) if (!achados.includes(c)) achados.push(c); };

  for (const arq of arquivos) {
    if (!/^src\/pages\/.+\.(tsx|ts|jsx|js)$/.test(arq) || /\.test\./.test(arq)) continue;
    const mod = semExtensao(arq);
    if (porModulo.has(mod)) { add(mod); continue; }
    if (comRota.has(mod)) continue;
    // Componente de apoio: as telas da pasta mais próxima acima.
    let pasta = pastaDe(arq);
    while (pasta.startsWith("src/pages")) {
      // Só quando a pasta é de UMA tela (ex.: bonificacao/ com a
      // BonificacaoColetiva). Arquivo de apoio numa pasta com várias telas
      // (ex.: chamados/types.tsx) não diz qual delas mudou — melhor nenhum
      // link do que um link errado.
      const daPasta = comRotaNaPasta(pasta);
      if (daPasta.length) { if (daPasta.length === 1) daPasta.forEach(add); break; }
      pasta = pastaDe(pasta);
    }
  }
  return achados.slice(0, MAX_URLS).map((caminho) => ({ caminho, url: `${URL_APP}${caminho}` }));
}

module.exports = { urlsDaPr, rotasDoApp, importsDePaginas, URL_APP, MAX_URLS };
