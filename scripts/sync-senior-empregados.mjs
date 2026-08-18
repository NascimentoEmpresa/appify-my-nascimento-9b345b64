// =====================================================================
// Sincroniza hagg.BiEmpregados (Senior/MySQL) -> EMPREGADOS (Supabase).
//
// POR QUE ISTO E UM SCRIPT, E NAO UMA EDGE FUNCTION: o MySQL do Senior so
// e alcancavel por TUNEL SSH, e Edge Function (Deno Deploy) nao abre nem
// socket TCP cru nem SSH. Entao o robo tem que rodar numa maquina que
// enxergue os dois lados — o servidor de producao, via Agendador de
// Tarefas, e o lugar natural.
//
// CHAVE: (numemp, numcad) -> (Empresa, Cadastro). NUNCA so numcad:
// medido, `numcad = 1` sao cinco pessoas diferentes, uma por empresa.
//
// tipcol = 2 (68 pessoas) fica de fora: (Empresa, Cadastro) colide entre
// tipcol 1 e 2, e a EMPREGADOS nao tem coluna de tipo para desempatar.
// Importa-las agora sobrescreveria gente. Ver o cabecalho da migration
// 20260906000008.
//
// Quem decide insert/update e a RPC rh_sync_senior_empregados. Aqui so
// se le, converte e envia em lotes.
//
// Uso:
//   SENIOR_SSH_PW=... SENIOR_DB_PW=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
//     node scripts/sync-senior-empregados.mjs [--dry-run]
// =====================================================================
import { Client } from "ssh2";
import mysql from "mysql2";

const SSH = {
  host: process.env.SENIOR_SSH_HOST ?? "72.61.222.128",
  port: Number(process.env.SENIOR_SSH_PORT ?? 22),
  username: process.env.SENIOR_SSH_USER ?? "haggtunel",
  password: process.env.SENIOR_SSH_PW,
};
const DB = { user: process.env.SENIOR_DB_USER ?? "hagg", password: process.env.SENIOR_DB_PW };
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DRY = process.argv.includes("--dry-run");
const LOTE = 500;

for (const [nome, v] of [["SENIOR_SSH_PW", SSH.password], ["SENIOR_DB_PW", DB.password],
                         ["SUPABASE_URL", SUPABASE_URL], ["SUPABASE_SERVICE_KEY", SERVICE_KEY]]) {
  if (!v && !(DRY && nome.startsWith("SUPABASE"))) { console.error(`Falta a variavel ${nome}.`); process.exit(1); }
}

// Datas do Senior vem como Date. A EMPREGADOS guarda texto no formato
// brasileiro, que e o que o resto do ERP ja le (rh_data espera isso).
const dataBR = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(+d)) return null;
  // 1900-12-31 e o "sem afastamento" do Senior, nao uma data real.
  if (d.getFullYear() <= 1901) return null;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};
// Salario vai como texto pt-BR: e assim que a coluna esta preenchida hoje.
const valorBR = (v) => (v == null || v === "" ? null
  : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }));

function lerSenior() {
  return new Promise((ok, err) => {
    const ssh = new Client();
    ssh.on("ready", () => ssh.forwardOut("127.0.0.1", 0, "127.0.0.1", 3306, (e, stream) => {
      if (e) return err(e);
      const conn = mysql.createConnection({ ...DB, stream, connectTimeout: 30000 });
      // sitafa e a SITUACAO (7=Demitido, 1=Trabalhando...), nao a data —
      // a descricao vem da BiSituacoes. Quem tem a data e datafa.
      conn.query(
        `SELECT e.numemp, e.numcad, e.nomfun, e.datadm, e.datafa,
                coalesce(s.descricao, '') AS situacao,
                e.codfil, e.tipsex, e.datnas, e.numcpf, e.numpis, e.valsal
           FROM hagg.BiEmpregados e
           LEFT JOIN hagg.BiSituacoes s ON s.situacao = e.sitafa
          WHERE e.tipcol = 1`,
        (e2, linhas) => { if (e2) return err(e2); conn.end(); ssh.end(); ok(linhas); });
    }));
    ssh.on("error", err);
    ssh.connect(SSH);
  });
}

async function enviar(lote) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rh_sync_senior_empregados`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ _linhas: lote }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Supabase HTTP ${r.status}: ${txt.slice(0, 300)}`);
  return JSON.parse(txt);
}

(async () => {
  const t0 = Date.now();
  const linhas = await lerSenior();
  const payload = linhas.map((e) => ({
    empresa: e.numemp, cadastro: e.numcad, nome: String(e.nomfun ?? "").trim(),
    admissao: dataBR(e.datadm), situacao: String(e.situacao ?? "").trim() || null,
    data_afastamento: dataBR(e.datafa), filial: e.codfil, sexo: String(e.tipsex ?? "").trim() || null,
    nascimento: dataBR(e.datnas), cpf: String(e.numcpf ?? "").trim() || null,
    pis: String(e.numpis ?? "").trim() || null, salario: valorBR(e.valsal),
  }));

  console.log(`Senior: ${payload.length} colaboradores (tipcol=1) em ${Date.now() - t0} ms`);
  if (DRY) {
    console.log("--dry-run: nada enviado. Amostra:");
    console.log(JSON.stringify(payload.slice(0, 3), null, 2));
    return;
  }

  const total = { inseridos: 0, atualizados: 0, ignorados: 0 };
  for (let i = 0; i < payload.length; i += LOTE) {
    const r = await enviar(payload.slice(i, i + LOTE));
    for (const k of Object.keys(total)) total[k] += r[k] ?? 0;
    process.stdout.write(`\r  lote ${Math.floor(i / LOTE) + 1}: +${total.inseridos} ins / ${total.atualizados} upd`);
  }
  console.log(`\nOK em ${Date.now() - t0} ms — inseridos ${total.inseridos}, atualizados ${total.atualizados}, ignorados ${total.ignorados}`);
})().catch((e) => { console.error("FALHOU:", e.message); process.exit(1); });
