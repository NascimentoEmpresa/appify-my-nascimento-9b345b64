// 10/11/2026 — Data de Admissão pelo cadastro do ERP (EMPREGADOS).
//
// Pablo: "a planilha da SAMU não está puxando a data de admissão, ajusta pra
// aparecer a data de admissão de todos". A coluna vinha da Base de
// Funcionários (Excel), achada pelo cabeçalho "ADMISS" ou, sem ele, por uma
// posição fixa — e a base do SAMU não traz a data onde o código procura, então
// a coluna saía vazia para todo mundo. A data de admissão de todos já está no
// EMPREGADOS (sincronizado com a Senior): ela vale sempre que a base não
// trouxer uma data. O que a base traz continua mandando.

const { limparTexto } = require("./extratores");

const pad2 = (n) => String(n).padStart(2, "0");

/** "2026-06-29" ou "29/06/2026" → "29/06/2026"; outra coisa → "". */
function admissaoParaBr(v) {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${pad2(m[1])}/${pad2(m[2])}/${m[3]}`;
  return "";
}

const ehDemitido = (situacao) => /DEMIT/i.test(String(situacao ?? ""));

/**
 * Mapa nome (limparTexto) → admissão "dd/mm/aaaa". Nome repetido (recontratado,
 * homônimo): vale o cadastro que não está demitido; entre iguais, a admissão
 * mais recente.
 */
function montarMapaAdmissoes(empregados) {
  const melhor = new Map();
  for (const e of empregados) {
    const nome = limparTexto(e.Nome);
    const data = admissaoParaBr(e["Admissão"]);
    if (!nome || !data) continue;
    const iso = data.split("/").reverse().join("-");
    const atual = melhor.get(nome);
    const ativo = !ehDemitido(e["Situação"]);
    if (!atual || (ativo && !atual.ativo) || (ativo === atual.ativo && iso > atual.iso)) {
      melhor.set(nome, { data, iso, ativo });
    }
  }
  return new Map([...melhor].map(([nome, v]) => [nome, v.data]));
}

/** Lê EMPREGADOS em páginas (o PostgREST corta em 1000 linhas). */
async function carregarAdmissoes(supabase) {
  const todos = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase
      .from("EMPREGADOS")
      .select('"ID", "Nome", "Admissão", "Situação"')
      .order("ID")
      .range(de, de + 999);
    if (error) throw new Error(`falha ao ler as admissões do EMPREGADOS: ${error.message}`);
    todos.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return montarMapaAdmissoes(todos);
}

module.exports = { admissaoParaBr, montarMapaAdmissoes, carregarAdmissoes };
