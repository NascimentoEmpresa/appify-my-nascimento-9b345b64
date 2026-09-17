// SIS-2026-0427: orquestração dos jobs de extração de VA/VT — mesmo
// padrão de worker/src/emailAta.js (frontend grava 1 linha de job, worker
// detecta no próximo ciclo, processa, grava o resultado de volta).

const { gerarPlanilhaTj, gerarPlanilhaSamu, gerarPlanilhaSms, gerarPlanilhaUfrgs } = require("./planilhas");

const BUCKET = "extrator-beneficios";

async function baixar(supabase, path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`falha ao baixar ${path}: ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}

async function processarPorTomador(supabase, job) {
  const { tomador, parametros, arquivos_entrada: arq } = job;

  switch (tomador) {
    case "ufrgs": {
      const [bufferBase, bufferPdfVa, bufferPdfVt] = await Promise.all([
        baixar(supabase, arq.base),
        baixar(supabase, arq.va),
        baixar(supabase, arq.vt),
      ]);
      return gerarPlanilhaUfrgs({ bufferBase, bufferPdfVa, bufferPdfVt });
    }
    case "samu": {
      const [bufferBase, bufferPonto] = await Promise.all([baixar(supabase, arq.base), baixar(supabase, arq.ponto)]);
      return gerarPlanilhaSamu({
        bufferBase,
        bufferPonto,
        valorUnitario24h: parametros.valorUnitario24h,
        tipoBeneficio: parametros.tipoBeneficio,
      });
    }
    case "sms": {
      const [bufferBase, bufferPonto] = await Promise.all([baixar(supabase, arq.base), baixar(supabase, arq.ponto)]);
      return gerarPlanilhaSms({
        bufferBase,
        bufferPonto,
        valorUnitario24h: parametros.valorUnitario24h,
        tipoBeneficio: parametros.tipoBeneficio,
      });
    }
    case "tj": {
      const [bufferBase, bufferPdf] = await Promise.all([baixar(supabase, arq.base), baixar(supabase, arq.pdf)]);
      return gerarPlanilhaTj({
        bufferBase,
        bufferPdf,
        periodo: parametros.periodo,
        valorUnitario: parametros.valorUnitario,
        tipoBeneficio: parametros.tipoBeneficio,
      });
    }
    default:
      throw new Error(`tomador desconhecido: ${tomador}`);
  }
}

async function processarJobsExtratorBeneficios(supabase) {
  const { data: jobs, error } = await supabase
    .from("extrator_beneficios_job")
    .select("*")
    .eq("status", "pendente");

  if (error) {
    console.error("[extrator-beneficios] erro ao buscar jobs:", error.message);
    return;
  }
  if (!jobs || jobs.length === 0) return;

  for (const job of jobs) {
    try {
      await supabase.from("extrator_beneficios_job").update({ status: "processando" }).eq("id", job.id);

      const bufferSaida = await processarPorTomador(supabase, job);
      const path = `${job.tomador}/${job.id}/resultado.xlsx`;

      const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, bufferSaida, {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: true,
      });
      if (uploadErr) throw new Error(`falha ao subir planilha gerada: ${uploadErr.message}`);

      await supabase
        .from("extrator_beneficios_job")
        .update({ status: "concluido", arquivo_saida_path: path })
        .eq("id", job.id);

      console.log(`[extrator-beneficios] job ${job.id} (${job.tomador}) concluído.`);
    } catch (e) {
      console.error(`[extrator-beneficios] erro no job ${job.id}:`, e.message);
      await supabase
        .from("extrator_beneficios_job")
        .update({ status: "erro", mensagem_erro: e.message })
        .eq("id", job.id);
    }
  }
}

module.exports = { processarJobsExtratorBeneficios };
