// Edge function: carga chunked do Pacote DO ZERO (modo streaming).
// Lê o CSV do Storage em stream — nunca carrega o arquivo inteiro em memória.
// Cada chamada processa até CHUNK_SIZE linhas a partir de offset.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { parse as parseCsvLine } from "https://deno.land/std@0.224.0/csv/parse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CHUNK_SIZE = 2000;
const INSERT_BATCH = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function partPrefix(path: string) {
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  const file = path.slice(folder.length).replace(/\.gz$/i, "").replace(/\.csv$/i, "");
  return { folder, prefix: file };
}

// Async generator: yields one CSV record (raw line, respecting quotes) per iteration.
async function* csvRecords(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.pipeThrough(new TextDecoderStream("utf-8")).getReader();
  let buf = "";
  let inQuote = false;
  while (true) {
    const { value, done } = await reader.read();
    if (value) buf += value;
    let i = 0;
    let lineStart = 0;
    while (i < buf.length) {
      const c = buf.charCodeAt(i);
      if (c === 34 /* " */) {
        inQuote = !inQuote;
      } else if (c === 10 /* \n */ && !inQuote) {
        let line = buf.slice(lineStart, i);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.length > 0) yield line;
        lineStart = i + 1;
      }
      i++;
    }
    buf = buf.slice(lineStart);
    if (done) {
      if (buf.length > 0) {
        let line = buf;
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.length > 0) yield line;
      }
      return;
    }
  }
}

function parseLine(line: string): string[] {
  // Parse a single CSV line with separator ; using std/csv.
  const out = parseCsvLine(line, { separator: ";", lazyQuotes: true }) as string[][];
  return out[0] ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Não autenticado" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Sessão inválida" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: podeCarregar } = await admin.rpc("can_access", { _user: u.user.id, _menu: "administracao", _acao: "alterar" });
    if (!podeCarregar) return json({ error: "Apenas administradores" }, 403);

    const body = await req.json().catch(() => ({}));
    const arquivo: string = body.arquivo;
    const batchId: string = body.batch_id;
    const offset: number = Number(body.offset ?? 0);
    const append: boolean = Boolean(body.append ?? false);
    if (!arquivo || !batchId) return json({ error: "arquivo e batch_id são obrigatórios" }, 400);

    const { data: ctrl, error: ctrlErr } = await admin
      .from("mz_status").select("*").eq("arquivo", arquivo).maybeSingle();
    if (ctrlErr || !ctrl) return json({ error: "Arquivo não cadastrado em mz_status" }, 404);
    if (!ctrl.storage_path) return json({ error: "Arquivo ainda não foi enviado ao Storage" }, 400);

    const tabela: string = ctrl.tabela;
    let storagePath: string = ctrl.storage_path;

    if (offset === 0) {
      if (!append) {
        await admin.from(tabela).delete().eq("migration_batch_id", batchId);
        await admin.from("mz_status").update({
          status: "EM_ANDAMENTO",
          iniciou_em: new Date().toISOString(),
          migration_batch_id: batchId,
          linhas_carregadas: 0,
          ultimo_erro: null,
          updated_at: new Date().toISOString(),
        }).eq("arquivo", arquivo);
      } else {
        await admin.from("mz_status").update({
          status: "EM_ANDAMENTO",
          migration_batch_id: batchId,
          ultimo_erro: null,
          updated_at: new Date().toISOString(),
        }).eq("arquivo", arquivo);
      }
    }

    // Localiza o blob (com fallback de sufixos)
    let { data: blob, error: dlErr } = await admin.storage.from("migracao-zero").download(storagePath);
    if (dlErr || !blob) {
      const { folder, prefix } = partPrefix(storagePath);
      const { data: candidates } = await admin.storage.from("migracao-zero").list(folder.replace(/\/$/, ""), {
        limit: 100,
        sortBy: { column: "updated_at", order: "desc" },
      });
      const match = candidates?.find((f) => {
        const n = f.name.toLowerCase();
        const p = prefix.toLowerCase();
        return (n === `${p}.csv` || n === `${p}.csv.gz` || n.startsWith(`${p}_`) || n.startsWith(`${p}-`) || n.startsWith(`${p} parte`));
      });
      if (match) {
        storagePath = `${folder}${match.name}`;
        const retry = await admin.storage.from("migracao-zero").download(storagePath);
        blob = retry.data;
        dlErr = retry.error;
      }
    }
    if (dlErr || !blob) return json({ error: `Falha ao baixar storage: ${dlErr?.message}` }, 500);

    // Stream + descompactação opcional (.gz)
    const isGz = storagePath.toLowerCase().endsWith(".gz");
    let stream: ReadableStream<Uint8Array> = blob.stream();
    if (isGz) {
      try {
        stream = stream.pipeThrough(new DecompressionStream("gzip"));
      } catch (e) {
        return json({ error: `Falha ao descompactar .gz: ${e instanceof Error ? e.message : String(e)}` }, 500);
      }
    }

    const normalize = (k: string) =>
      k.replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_|_$/g, "");

    let header: string[] | null = null;
    let dataIdx = 0; // índice da linha de dados (0-based, sem contar header)
    const collected: Record<string, unknown>[] = [];
    let finalizou = true; // assume true; vira false se sair do loop por chunk cheio

    const iter = csvRecords(stream);
    for await (const rawLine of iter) {
      if (header === null) {
        const cols = parseLine(rawLine);
        header = cols.map((c, i) => normalize(c) || `col_${i}`);
        continue;
      }
      // pula linhas anteriores ao offset
      if (dataIdx < offset) {
        dataIdx++;
        continue;
      }
      // se já coletamos o chunk, paramos — não há necessidade de ler o resto
      if (collected.length >= CHUNK_SIZE) {
        finalizou = false;
        break;
      }
      const fields = parseLine(rawLine);
      const obj: Record<string, unknown> = {
        migration_batch_id: batchId,
        arquivo_origem_carga: arquivo,
        linha_csv: dataIdx + 2, // +2 = header + 1-based
      };
      for (let i = 0; i < header.length; i++) {
        const nk = header[i];
        if (!nk) continue;
        obj[nk] = fields[i] ?? null;
      }
      collected.push(obj);
      dataIdx++;
    }

    // Cancela o leitor caso tenhamos saído cedo
    try { (iter as unknown as { return?: () => Promise<unknown> }).return?.(); } catch { /* noop */ }

    let inserted = 0;
    let lastError: string | null = null;
    for (let i = 0; i < collected.length; i += INSERT_BATCH) {
      const chunk = collected.slice(i, i + INSERT_BATCH);
      const { error } = await admin.from(tabela).insert(chunk);
      if (error) { lastError = error.message; break; }
      inserted += chunk.length;
    }

    const novoTotal = (ctrl.linhas_carregadas ?? 0) + inserted;
    const reallyFinalizou = !lastError && finalizou;
    const nextOffset = offset + inserted;

    await admin.from("mz_status").update({
      linhas_carregadas: novoTotal,
      status: lastError ? "ERRO" : (reallyFinalizou ? "OK" : "EM_ANDAMENTO"),
      ultimo_erro: lastError,
      finalizou_em: reallyFinalizou ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("arquivo", arquivo);

    return json({
      ok: !lastError,
      arquivo, tabela,
      total_csv: reallyFinalizou ? novoTotal : null, // desconhecido até finalizar
      offset, processed: inserted, next_offset: nextOffset,
      finalizou: reallyFinalizou, error: lastError,
      linhas_carregadas_acumulado: novoTotal,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
