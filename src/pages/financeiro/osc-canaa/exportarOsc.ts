import * as XLSX from "xlsx";
import { CENARIO_DESPESA_EXTRA, NOME_MES_LONGO, SEM_RUBRICA } from "@/lib/oscFinanceiro";
import { CRITERIO_LABEL, CtxOsc, GRUPO_LABEL, SITUACAO_LABEL, STATUS_PROJETO_LABEL, nomeRubrica } from "./comum";

// SIS-2026-0922 — exportação Excel: os mesmos números da tela (mesmo
// calcularOsc), com premissas e memória de cálculo, para prestação de contas.

const r2 = (v: number) => Math.round(v * 100) / 100;
const FMT = "#,##0.00;[Red]-#,##0.00";

function aba(linhas: (string | number | null)[][], larguras: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ws["!cols"] = larguras.map((wch) => ({ wch }));
  const ref = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
  if (ref) {
    for (let R = ref.s.r; R <= ref.e.r; R++) {
      for (let C = ref.s.c; C <= ref.e.c; C++) {
        const cel = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (cel && cel.t === "n") cel.z = FMT;
      }
    }
  }
  return ws;
}

export function exportarOscExcel(ctx: CtxOsc) {
  const { resultado: r, ano, parceria } = ctx;
  const wb = XLSX.utils.book_new();
  const gerado = new Date().toLocaleString("pt-BR");

  XLSX.utils.book_append_sheet(wb, aba([
    [`${parceria.nome} — Gestão Financeira ${ano}`],
    [`Gerado em ${gerado} pelo ERP (Financeiro › OSC Canaã). Mesmos números da tela.`],
    [],
    ["Indicador", "Valor"],
    ["Repasse mensal", parceria.repasse_mensal],
    [r.ultimoFechado ? `Saldo acumulado até ${NOME_MES_LONGO[r.ultimoFechado - 1]}` : "Saldo inicial", r.saldoAteUltimoFechado],
    [r.mesReferencia ? `Custo mensal de referência (${NOME_MES_LONGO[r.mesReferencia - 1]})` : "Custo mensal de referência", r.custoReferencia],
    ["Saldo projetado dezembro (antes de projetos)", r.saldoProjetadoDezembro],
    ["Projetos aprovados", r.projetosAprovados],
    ["Projetos pendentes", r.projetosPendentes],
    ["Saldo após projetos em dezembro", r.saldoAposProjetosDezembro],
    ["Reserva extra a confirmar", ctx.dados.ano?.reserva_extra ?? 0],
    ["Saldo livre a destinar", r.saldoLivre],
    ["Reserva férias/13º acumulada (mês atual)", r.reservaAcumuladaAtual],
    ["Total repasses no ano", r.totais.repasse],
    ["Total despesas consideradas", r.totais.despesas],
    ["Total aplicações", r.totais.aplicacoes],
    ["Total resgates", r.totais.resgates],
    [],
    ["Alertas"],
    ...r.alertas.map((a) => [a.nivel.toUpperCase(), a.mensagem]),
    [],
    ["Premissas"],
    ...(ctx.dados.ano?.premissas ?? "—").split("\n").map((l) => [l]),
  ], [52, 22]), "Resumo");

  XLSX.utils.book_append_sheet(wb, aba([
    ["Mês", "Situação", "Fonte do realizado", "Repasse", "Repasse confirmado", "Pago via Malote", "Histórico importado", "Ajustes fora do Malote",
      "Previsto (desp.+aplic.)", "Despesas consideradas", "Aplicação", "Resgates", "Saldo do mês", "Saldo acumulado", "Projetos", "Após projetos", "Reserva acumulada"],
    ...r.meses.map((m) => [
      NOME_MES_LONGO[m.mes - 1], SITUACAO_LABEL(m.situacao), m.fonteRealizado === "historico" ? "Planilha" : "Malote",
      m.repasse, m.repasseConfirmado ? "Sim" : "Não", m.pagoMalote, m.historicoImportado, m.ajustesManuais,
      r2(m.previstoDespesas + m.previstoAplicacoes), m.despesas, m.aplicacoes, m.resgates, m.saldoMes, m.saldoAcumulado,
      m.projetos, m.saldoAposProjetos, m.reservaAcumulada,
    ]),
  ], [12, 11, 12, 14, 10, 14, 14, 14, 16, 16, 12, 12, 14, 14, 12, 14, 14]), "Competências");

  const ids = new Set<string>();
  for (const m of r.meses) for (const id of Object.keys(m.porRubrica)) if (id !== CENARIO_DESPESA_EXTRA) ids.add(id);
  const ordem = new Map(ctx.dados.rubricas.map((x, i) => [x.id, i]));
  const rubs = [...ids].sort((a, b) => (ordem.get(a) ?? 999) - (ordem.get(b) ?? 999));
  const matriz = (campo: "considerado" | "previsto" | "realizado") => [
    ["Rubrica", "Categoria", ...NOME_MES_LONGO, "Total"],
    ...rubs.map((id) => {
      const vals = r.meses.map((m) => m.porRubrica[id]?.[campo] ?? 0);
      const rub = ctx.dados.rubricas.find((x) => x.id === id);
      return [nomeRubrica(ctx, id), id === SEM_RUBRICA ? "—" : GRUPO_LABEL[rub?.grupo ?? "outros"], ...vals, r2(vals.reduce((s, v) => s + v, 0))];
    }),
  ];
  XLSX.utils.book_append_sheet(wb, aba(matriz("considerado"), [28, 14, ...Array(13).fill(12)]), "Rubricas (considerado)");
  XLSX.utils.book_append_sheet(wb, aba(matriz("previsto"), [28, 14, ...Array(13).fill(12)]), "Rubricas (previsto)");
  XLSX.utils.book_append_sheet(wb, aba(matriz("realizado"), [28, 14, ...Array(13).fill(12)]), "Rubricas (realizado)");

  XLSX.utils.book_append_sheet(wb, aba([
    ["Nº Malote", "Parcela", "Competência", "Competência no Malote", "Data do pagamento", "Descrição", "Fornecedor", "Contrato", "Classificação",
      "Rubrica OSC", "Origem da rubrica", "Não é da OSC", "Motivo da revisão", "Revisado por", "Valor", "Link"],
    ...ctx.pagamentos.map((p) => [
      p.id_malote, p.numero_parcela, p.competencia, p.competencia_malote, p.data_pagamento, p.descricao, p.fornecedor, p.contrato_nome,
      p.classificacao_nome, p.ignorado ? "—" : nomeRubrica(ctx, p.rubrica_id), p.rubrica_origem === "reclassificado" ? "Revisão manual" : p.rubrica_origem === "de_para" ? "De-para" : "—",
      p.ignorado ? "Sim" : "", p.ajuste_motivo, p.ajuste_por, p.valor, `${window.location.origin}/app/malote/despesa/${p.despesa_id}`,
    ]),
  ], [12, 8, 12, 12, 12, 40, 28, 24, 24, 24, 14, 10, 30, 18, 14, 50]), "Pagamentos Malote");

  XLSX.utils.book_append_sheet(wb, aba([
    ["Competência", "Tipo", "Rubrica", "Descrição", "Origem", "Valor"],
    ...ctx.dados.lancamentos.map((l) => [l.competencia, l.tipo, nomeRubrica(ctx, l.rubrica_id), l.descricao, l.origem_ref, l.valor]),
  ], [12, 10, 28, 36, 24, 14]), "Lançamentos fora Malote");

  XLSX.utils.book_append_sheet(wb, aba([
    ["Projeto", "Descrição", "Rubrica", "Mês previsto", "Valor estimado", "Status"],
    ...ctx.dados.projetos.map((p) => [p.nome, p.descricao, p.rubrica_id ? nomeRubrica(ctx, p.rubrica_id) : "", p.competencia_prevista, p.valor_estimado, STATUS_PROJETO_LABEL[p.status]]),
  ], [28, 40, 24, 12, 14, 12]), "Investimentos");

  XLSX.utils.book_append_sheet(wb, aba([
    ["Rubrica", "Categoria", "Tipo", "Critério", "Base mensal", "Ajuste %"],
    ...ctx.dados.rubricas.map((x) => {
      const p = ctx.dados.previsoes.find((y) => y.rubrica_id === x.id);
      return [x.nome, GRUPO_LABEL[x.grupo] ?? x.grupo, x.tipo === "reserva" ? "Reserva" : "Despesa", p ? CRITERIO_LABEL[p.criterio] : "—", p?.base_mensal ?? 0, r2((p?.ajuste_pct ?? 0) * 100)];
    }),
    [],
    ["Memória de cálculo"],
    ["Saldo do mês = repasse (recebido, ou previsto se não confirmado) − despesas − aplicação na reserva + resgates."],
    ["Saldo acumulado = saldo inicial do ano + soma dos saldos do mês."],
    ["Mês fechado: realizado. Mês em aberto (corrente/atrasado): maior entre realizado e previsto por rubrica. Mês futuro: previsto."],
    ["Realizado = pagamentos confirmados no Malote (status pago; estorno/cancelamento saem) pela competência da despesa, ou o histórico da planilha nos meses com fonte 'Planilha', + ajustes fora do Malote."],
    ["Previsto = valor do mês, se informado; senão a base do critério (valor fixo, último mês fechado ou média dos meses fechados) × (1 + ajuste)."],
    ["Aplicação para férias/13º é reserva: sai do saldo livre, não é despesa. Resgate volta como entrada (sem dupla contagem quando a obrigação é paga)."],
    ["Após projetos = acumulado − projetos pendentes/aprovados até o mês (sem mês = dezembro). Saldo livre = após projetos em dezembro − reserva extra."],
  ], [60, 14, 10, 24, 14, 10]), "Plano e memória");

  XLSX.writeFile(wb, `OSC_Canaa_Gestao_Financeira_${ano}.xlsx`);
}
