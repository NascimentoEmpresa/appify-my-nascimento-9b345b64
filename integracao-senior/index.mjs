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

// A service_role e um JWT de ~219 caracteres. Colar num painel web corta com
// facilidade, e o sintoma era um 401 generico DEPOIS de ler o Senior inteiro.
// Conferir na partida custa nada e falha na hora certa.
if (SERVICE_KEY && !DRY) {
  const partes = SERVICE_KEY.split(".");
  if (partes.length !== 3 || SERVICE_KEY.length < 150) {
    console.error("SUPABASE_SERVICE_KEY nao parece um JWT valido: " + SERVICE_KEY.length +
      " caracteres e " + partes.length + " partes (o esperado sao 3 partes e ~219 caracteres).");
    console.error('  comeca em "' + SERVICE_KEY.slice(0, 12) + '" e termina em "' + SERVICE_KEY.slice(-12) + '"');
    console.error("  provavel corte ao colar no painel: recadastre a variavel inteira.");
    process.exit(1);
  }
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
  if (r.status === 401) {
    throw new Error("Supabase recusou a chave (401). A SUPABASE_SERVICE_KEY em uso tem " +
      SERVICE_KEY.length + ' caracteres, comeca em "' + SERVICE_KEY.slice(0, 12) +
      '" e termina em "' + SERVICE_KEY.slice(-12) +
      '". Confira se e a service_role e se nao foi cortada ao colar. Resposta: ' + txt.slice(0, 160));
  }
  if (!r.ok) throw new Error(`Supabase HTTP ${r.status}: ${txt.slice(0, 300)}`);
  return JSON.parse(txt);
}

// Uma passada completa. Isolada numa funcao para servir aos dois modos: uma
// execucao so (agendador externo) ou laco continuo (container que fica no ar,
// tipo Discloud/Railway — la nao ha cron, o processo e que persiste).
async function rodar() {
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
}

// SYNC_INTERVALO_MIN ligado = fica no ar e repete. Sem ele, roda uma vez e sai,
// que e o que um agendador externo (Tarefas do Windows, cron, GitHub Actions)
// espera.
const INTERVALO = Number(process.env.SYNC_INTERVALO_MIN ?? 0);
const falhar = (e) => console.error("FALHOU:", e.message);

if (INTERVALO > 0 && !DRY) {
  console.log(`Modo continuo: a cada ${INTERVALO} min.`);
  // Erro numa rodada nao derruba o processo: a proxima tenta de novo. Sem isso,
  // uma queda de rede no Senior mataria o robo ate alguem reiniciar.
  const ciclo = async () => { try { await rodar(); } catch (e) { falhar(e); } };
  await ciclo();
  setInterval(ciclo, INTERVALO * 60_000);
} else {
  rodar().catch((e) => { falhar(e); process.exit(1); });
}
