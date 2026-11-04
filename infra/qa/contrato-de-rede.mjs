// ============================================================================
//  CONTRATO DE REDE — o que uma tela PODE pedir de uma tabela grande
//  (04/11/2026, complemento das regras D5/D6 do guardião)
//
//  As regras D5/D6 do `.github/scripts/guardiao-desempenho.mjs` são regex sobre
//  o código, então só veem `.from("NOME_LITERAL")`. Escapam delas: nome de
//  tabela em variável, chamada dentro de hook ou helper, consulta montada por
//  biblioteca, e o que uma Edge Function pede por conta da tela.
//
//  Este módulo julga a REQUISIÇÃO, não o texto do código: é usado pelo
//  `orcamento-requisicoes.mjs` dentro do interceptador do Playwright, onde
//  toda chamada passa obrigatoriamente. O que escapa do texto não escapa do
//  fio.
//
//  Vale para GET em `/rest/v1/<tabela>` quando a tabela está em
//  `.github/tabelas-grandes.json` (a MESMA lista do guardião, de propósito:
//  uma regra, um arquivo para atualizar). Reprova:
//    • sem `limit`, sem `offset` e sem cabeçalho `Range`  → a tela pede a
//      tabela inteira;
//    • `select=*`                                        → traz coluna que a
//      tela não usa.
//  Não reprova: escrita (POST/PATCH/DELETE), `HEAD` (contagem), `.single()`
//  (Accept do PostgREST) e filtro por `id=eq.`, que são leitura de uma linha.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

export const GRANDES = new Set(Object.keys(
  JSON.parse(fs.readFileSync(path.join(AQUI, "../../.github/tabelas-grandes.json"), "utf8")).tabelas,
));

/**
 * @param {{url: string, metodo: string, cabecalhos?: Record<string,string>}} req
 * @returns {string|null} motivo da reprovação, ou null quando é legítima
 */
export function violacaoDeContrato({ url, metodo, cabecalhos }) {
  let u;
  try { u = new URL(url, "http://interno"); } catch { return null; }
  const m = u.pathname.match(/\/rest\/v1\/([^/]+)$/);
  if (!m) return null;                        // RPC, auth, storage: outra regra
  const tabela = decodeURIComponent(m[1]);
  if (!GRANDES.has(tabela)) return null;
  if ((metodo || "GET").toUpperCase() !== "GET") return null;  // escrita/HEAD não é lista

  const q = u.searchParams;
  const h = Object.fromEntries(
    Object.entries(cabecalhos ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
  );

  const umaLinha = /vnd\.pgrst\.object/.test(h["accept"] ?? "") || /^eq\./.test(q.get("id") ?? "");
  if (umaLinha) return null;

  if (!q.has("limit") && !q.has("offset") && !h["range"]) {
    return `GET "${tabela}" sem limit/Range: a tela pede a tabela grande INTEIRA. `
      + `Pagine no servidor (.range) e calcule total/KPI numa RPC.`;
  }

  if ((q.get("select") ?? "").split(",").map((s) => s.trim()).includes("*")) {
    return `GET "${tabela}" com select=*: traz coluna que a tela não usa. Peça as colunas pelo nome.`;
  }

  return null;
}
