#!/usr/bin/env node
/**
 * Gera a migration de dados do levantamento de tamanhos de uniforme a partir
 * do CSV exportado do formulário que os encarregados preencheram por contrato.
 *
 * O CSV não é movimentação de estoque: é a GRADE DECLARADA — o tamanho que
 * cada colaborador diz vestir. Ele entra no ERP para a aba "Rotatividade do
 * Estoque" poder comparar o que a empresa compra/entrega com o que a equipe
 * realmente veste.
 *
 * Uso:
 *   node scripts/gerar-seed-levantamento-uniforme.mjs <caminho-do-csv> [saida.sql]
 *
 * Sem o segundo argumento, escreve em
 * supabase/migrations/20261013000011_sup_levantamento_uniforme_dados.sql.
 *
 * O SQL gerado é idempotente: a chave é (nome_completo, enviado_em), então
 * reexecutar com um CSV maior só acrescenta as respostas novas e atualiza o
 * vínculo de contrato das antigas. Quando chegarem respostas novas, rode este
 * script de novo com o CSV atualizado e aplique a migration regerada.
 */

import fs from "node:fs";
import path from "node:path";

const COLUNAS_PECA = {
  camisa: "Qual o tamanho da sua camisa / camiseta?",
  calca: "Qual o tamanho da sua calça / bermuda?",
  jaleco: "Qual o tamanho do seu jaleco?",
  jaqueta: "Qual o tamanho da sua jaqueta?",
  moletom: "Qual o tamanho do seu moletom?",
  calcado: "Qual a numeração do seu sapato / botina / bota?",
  luva: "Qual o tamanho da sua luva?",
};

/** CSV do formulário: separador `;`, tudo entre aspas, aspas dobrada escapa. */
function lerCsv(texto) {
  const linhas = [];
  let campo = "";
  let linha = [];
  let dentroDeAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroDeAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          dentroDeAspas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      dentroDeAspas = true;
    } else if (c === ";") {
      linha.push(campo);
      campo = "";
    } else if (c === "\n") {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else if (c !== "\r") {
      campo += c;
    }
  }
  if (campo || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

/** "12/10/2026, 21:26" → "2026-10-12 21:26:00-03" (horário de Brasília). */
function dataHoraIso(bruto) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})/.exec((bruto ?? "").trim());
  if (!m) return null;
  const [, dia, mes, ano, hora, minuto] = m;
  return `${ano}-${mes}-${dia} ${hora.padStart(2, "0")}:${minuto}:00-03`;
}

/** Tamanho vira texto limpo; o SQL ainda passa por sup_tamanho_da_variante(). */
function tamanho(bruto) {
  const t = (bruto ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  return t === "" || t === "-" ? null : t;
}

function literal(valor) {
  if (valor === null || valor === undefined) return "NULL";
  return `'${String(valor).replace(/'/g, "''")}'`;
}

function main() {
  const caminhoCsv = process.argv[2];
  if (!caminhoCsv) {
    console.error("uso: node scripts/gerar-seed-levantamento-uniforme.mjs <caminho-do-csv> [saida.sql]");
    process.exit(1);
  }
  const destino =
    process.argv[3] ??
    path.join("supabase", "migrations", "20261013000011_sup_levantamento_uniforme_dados.sql");

  let texto = fs.readFileSync(caminhoCsv, "utf8");
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);

  const linhas = lerCsv(texto);
  const cabecalho = linhas[0].map((c) => c.trim());
  const indice = (nome) => {
    const i = cabecalho.indexOf(nome);
    if (i < 0) throw new Error(`coluna ausente no CSV: "${nome}"`);
    return i;
  };

  const iEnviado = indice("Enviado em");
  const iNome = indice("Nome Completo");
  const iNomeCurto = indice("Nome");
  const iContrato = indice("Contrato");
  const iPeca = Object.fromEntries(
    Object.entries(COLUNAS_PECA).map(([chave, titulo]) => [chave, indice(titulo)]),
  );

  const respostas = new Map();
  let ignoradasSemData = 0;
  let ignoradasSemNome = 0;
  let duplicadasExatas = 0;

  for (const linha of linhas.slice(1)) {
    if (!linha.some((c) => c.trim())) continue;
    const enviadoEm = dataHoraIso(linha[iEnviado]);
    if (!enviadoEm) {
      ignoradasSemData++;
      continue;
    }
    const nome = (linha[iNome] || linha[iNomeCurto] || "").trim().replace(/\s+/g, " ").toUpperCase();
    if (!nome) {
      ignoradasSemNome++;
      continue;
    }
    const chave = `${nome}|${enviadoEm}`;
    if (respostas.has(chave)) {
      duplicadasExatas++;
      continue;
    }
    respostas.set(chave, {
      enviadoEm,
      nome,
      contrato: (linha[iContrato] || "").trim().replace(/\s+/g, " "),
      pecas: Object.fromEntries(
        Object.keys(COLUNAS_PECA).map((chavePeca) => [chavePeca, tamanho(linha[iPeca[chavePeca]])]),
      ),
    });
  }

  const ordenadas = [...respostas.values()].sort((a, b) => a.enviadoEm.localeCompare(b.enviadoEm));
  const pessoas = new Set(ordenadas.map((r) => r.nome)).size;
  const contratos = new Set(ordenadas.map((r) => r.contrato).filter(Boolean)).size;
  const arquivo = path.basename(caminhoCsv);

  const valores = ordenadas
    .map((r) => {
      const campos = [
        `${literal(r.enviadoEm)}::timestamptz`,
        literal(r.nome),
        literal(r.contrato || null),
        ...Object.keys(COLUNAS_PECA).map((chave) => literal(r.pecas[chave])),
      ];
      return `  (${campos.join(", ")})`;
    })
    .join(",\n");

  const sql = `-- [SEM-CHAMADO] Levantamento de tamanhos de uniforme — dados (grade declarada)
--
-- GERADO POR SCRIPT. Não edite à mão:
--   node scripts/gerar-seed-levantamento-uniforme.mjs <csv> ${destino.replace(/\\\\/g, "/")}
--
-- Origem: ${arquivo}
-- ${ordenadas.length} respostas · ${pessoas} pessoas distintas · ${contratos} contratos
-- Respostas descartadas na geração: ${ignoradasSemData} sem data válida, ${ignoradasSemNome} sem nome, ${duplicadasExatas} duplicadas exatas.
--
-- A chave é (nome_completo, enviado_em): quem respondeu mais de uma vez tem
-- todas as respostas guardadas, e a RPC do dashboard considera só a última de
-- cada pessoa. Reexecutar com um CSV maior é seguro.
--
-- O contrato vem como texto livre do formulário e é resolvido aqui contra
-- public.contratos por rh_norm_contrato(), que ignora acento, pontuação e
-- zero à esquerda ("066/2026" = "66/2026"). Resposta cujo texto não casa com
-- nenhum contrato fica com contrato_id/empresa_id nulos de propósito — é o
-- caso de "ADMINISTRATIVO", que existe para quatro empresas e não dá para
-- desambiguar sem perguntar.
--
-- ROLLBACK:
--   DELETE FROM public.sup_levantamento_uniforme WHERE origem_arquivo = ${literal(arquivo)};
-- ============================================================================

WITH bruto (
  enviado_em, nome_completo, contrato_texto,
  camisa, calca, jaleco, jaqueta, moletom, calcado, luva
) AS (
  VALUES
${valores}
),
resolvido AS (
  SELECT b.*,
         (
           SELECT c.id
             FROM public.contratos c
            WHERE public.rh_norm_contrato(c.nome) = public.rh_norm_contrato(b.contrato_texto)
            LIMIT 1
         ) AS contrato_id
    FROM bruto b
)
INSERT INTO public.sup_levantamento_uniforme (
  empresa_id, contrato_id, contrato_texto, nome_completo, enviado_em,
  camisa, calca, jaleco, jaqueta, moletom, calcado, luva, origem_arquivo
)
SELECT c.empresa_id,
       r.contrato_id,
       r.contrato_texto,
       r.nome_completo,
       r.enviado_em,
       public.sup_tamanho_da_variante(r.camisa),
       public.sup_tamanho_da_variante(r.calca),
       public.sup_tamanho_da_variante(r.jaleco),
       public.sup_tamanho_da_variante(r.jaqueta),
       public.sup_tamanho_da_variante(r.moletom),
       public.sup_tamanho_da_variante(r.calcado),
       public.sup_tamanho_da_variante(r.luva),
       ${literal(arquivo)}
  FROM resolvido r
  LEFT JOIN public.contratos c ON c.id = r.contrato_id
ON CONFLICT (nome_completo, enviado_em) DO UPDATE
  SET empresa_id     = EXCLUDED.empresa_id,
      contrato_id    = EXCLUDED.contrato_id,
      contrato_texto = EXCLUDED.contrato_texto,
      camisa         = EXCLUDED.camisa,
      calca          = EXCLUDED.calca,
      jaleco         = EXCLUDED.jaleco,
      jaqueta        = EXCLUDED.jaqueta,
      moletom        = EXCLUDED.moletom,
      calcado        = EXCLUDED.calcado,
      luva           = EXCLUDED.luva,
      origem_arquivo = EXCLUDED.origem_arquivo;

-- Conferência pós-aplicação (deve bater com o cabeçalho deste arquivo):
--   SELECT count(*) AS respostas,
--          count(DISTINCT nome_completo) AS pessoas,
--          count(*) FILTER (WHERE contrato_id IS NULL) AS sem_contrato
--     FROM public.sup_levantamento_uniforme;

NOTIFY pgrst, 'reload schema';
`;

  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, sql, "utf8");

  console.log(`${destino}`);
  console.log(`  ${ordenadas.length} respostas · ${pessoas} pessoas · ${contratos} contratos`);
  if (ignoradasSemData || ignoradasSemNome || duplicadasExatas) {
    console.log(
      `  descartadas: ${ignoradasSemData} sem data, ${ignoradasSemNome} sem nome, ${duplicadasExatas} duplicadas exatas`,
    );
  }
}

main();
