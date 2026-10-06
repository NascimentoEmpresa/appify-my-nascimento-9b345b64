// Mesmo ensaio, mas com o driver que o Storage API usa: node-postgres.
// node-postgres NAO aceita multiplos hosts nem target_session_attrs.
// A pergunta: o HAProxy sozinho faz o Storage sobreviver ao failover?
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.ALVO, port: 5000,
  user: "postgres", password: process.env.SENHA || "postgres", database: "postgres",
  max: 5, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000,
});
pool.on("error", () => {});   // sem isto o processo morre no primeiro erro de socket

const DURACAO = Number(process.env.DURACAO || 75) * 1000;
const confirmados = [];
const eventos = [];
let falhas = 0, ultimoOk = null, ultimoOkAntes = null, primeiraFalha = null, primeiroOkDepois = null;
const inicio = Date.now();

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await pool.query("CREATE TABLE IF NOT EXISTS prova_multi(id bigserial primary key, quando timestamptz default clock_timestamp())");
  await pool.query("TRUNCATE prova_multi");

  while (Date.now() - inicio < DURACAO) {
    const agora = Date.now();
    try {
      const r = await pool.query("INSERT INTO prova_multi DEFAULT VALUES RETURNING id");
      confirmados.push(r.rows[0].id);
      ultimoOk = agora;
      if (primeiraFalha && !primeiroOkDepois) {
        primeiroOkDepois = agora;
        eventos.push({ evento: "escrita voltou", t: ((agora - inicio) / 1000).toFixed(2) });
      }
    } catch (e) {
      falhas++;
      if (!primeiraFalha) {
        primeiraFalha = agora; ultimoOkAntes = ultimoOk;
        eventos.push({ evento: "primeira falha", t: ((agora - inicio) / 1000).toFixed(2), erro: String(e.message).slice(0, 70) });
      }
      await dormir(200);
    }
    await dormir(50);
  }

  let noBanco = new Set();
  for (let i = 0; i < 60; i++) {
    try { const r = await pool.query("SELECT id FROM prova_multi"); noBanco = new Set(r.rows.map((x) => Number(x.id))); break; }
    catch { await dormir(1000); }
  }
  const perdidos = confirmados.filter((i) => !noBanco.has(Number(i)));
  console.log(JSON.stringify({
    driver: "node-postgres, conectado ao provedor sobrevivente",
    confirmados_pelo_cliente: confirmados.length,
    presentes_no_banco_depois: noBanco.size,
    TRANSACOES_PERDIDAS: perdidos.length,
    tentativas_de_escrita_falhadas: falhas,
    INDISPONIBILIDADE_SEGUNDOS: ultimoOkAntes && primeiroOkDepois ? ((primeiroOkDepois - ultimoOkAntes) / 1000).toFixed(2) : null,
    eventos,
  }, null, 2));
  process.exit(0);
})();
