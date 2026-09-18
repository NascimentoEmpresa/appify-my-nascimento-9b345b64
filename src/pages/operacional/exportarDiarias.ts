import * as XLSX from "xlsx";
import {
  COLUNAS_UFRGS,
  DiariaUfrgs,
  PostoUfrgs,
  SINDICATOS_UFRGS,
  STATUS_SOLICITACAO,
  TarifaUfrgs,
  anoDaCompetencia,
  mesDaCompetencia,
  tarifaVigente,
} from "./diariasUfrgs";
import {
  STATUS_SOLICITACAO as STATUS_DIARISTA,
  SolicitacaoDiaria,
  labelTipoPix,
  labelTurno,
  valorTotalLinha,
} from "./diarias";

/**
 * Exportação das diárias para Excel.
 *
 * O PEDIDO, literalmente: "o intuito é o sistema gerar um relatório
 * exatamente igual o excel anexado nesse prompt para os usuários-finais não
 * precisarem preencher manualmente o excel [...] mantendo o controle,
 * histórico e rastreabilidade".
 *
 * Então isto não é um "dump de tabela em xlsx". É a aba "DIARIAS 09.2025" do
 * arquivo 1789651523607-RETIFICADO__1_.xlsx reconstruída: o cabeçalho de três
 * linhas com ANO/MÊS/Período, as duas linhas de tarifa (5 e 6) que as
 * fórmulas referenciam, as 23 colunas na mesma ordem, a linha de
 * Totalizadores, a tabela de referência do contrato, os dois resumos de
 * tributos, o resumo por sindicato, a PLANILHA RESUMO - VIAGENS REALIZADAS e
 * o bloco POSTO/CARGO com o total por localidade.
 *
 * AS FÓRMULAS VÃO VIVAS, não só o resultado. Quem recebe o relatório abre e
 * confere a conta clicando na célula — que é o que a pessoa faz hoje na
 * planilha à mão, e tirar isso transformaria o Excel gerado num PDF gordo.
 * Os valores calculados também vão gravados em cada célula (o `v` junto do
 * `f`), para o arquivo abrir com os números certos antes de qualquer
 * recálculo.
 *
 * O QUE NÃO FOI REPRODUZIDO, e por quê: a planilha entregue tem restos de
 * rascunho — a linha 153 com um SUBTOTAL de um pedaço aleatório do mês, o
 * "b1b1" nas células Q155/Q156, as linhas 177-179 do bloco de Tramandaí sem
 * código de posto, e as abas Plan1/Plan2 (contas de conferência de outro
 * mês, com referência externa a '[3]Out-Nov'). Copiar aquilo pareceria bug
 * do sistema, não fidelidade.
 *
 * `xlsx` 0.18.5 (community) escreve merge, largura de coluna, formato de
 * número e fórmula, mas NÃO escreve estilo (negrito, cor, borda) — por isso
 * o arquivo sai com a mesma estrutura e sem o preenchimento visual.
 */

// ── Formatos da planilha original ────────────────────────────────────
/** O formato contábil das colunas de dinheiro, copiado célula a célula. */
const FMT_MOEDA = '_("R$ "* #,##0.00_);_("R$ "* \\(#,##0.00\\);_("R$ "* "-"??_);_(@_)';
const FMT_DATA = "dd/mm/yyyy";

/** Larguras (wch) de A..W, medidas no arquivo entregue. */
const LARGURAS = [
  9.21, 16.36, 27.64, 69.93, 36.07, 46.07, 24.07, 26.93, 18.36, 64.36, 31.07, 10.93, 19.79,
  24.79, 38.79, 26.93, 27.36, 36.64, 33.5, 41.5, 31.21, 34.93, 68.07, 7.93, 15.5,
];

type Celula = XLSX.CellObject;
type Folha = XLSX.WorkSheet;

/** Serial do Excel (dias desde 30/12/1899) — evita fuso na escrita de data. */
function serialData(iso: string): number | null {
  if (!iso) return null;
  const [a, m, d] = iso.split("-").map(Number);
  if (!a || !m || !d) return null;
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

/** Escreve uma célula por endereço, mantendo o !ref da folha coerente. */
function celula(ws: Folha, addr: string, cel: Celula | null) {
  if (!cel) return;
  ws[addr] = cel;
}

const txt = (v: string): Celula => ({ t: "s", v });
const num = (v: number, z?: string): Celula => ({ t: "n", v, ...(z ? { z } : {}) });
const dinheiro = (centavos: number): Celula => num((centavos || 0) / 100, FMT_MOEDA);
const data = (iso: string): Celula | null => {
  const s = serialData(iso);
  return s == null ? null : num(s, FMT_DATA);
};
/** Fórmula viva + o valor já calculado, para o arquivo abrir pronto. */
const formula = (f: string, v: number, z?: string): Celula => ({
  t: "n",
  f,
  v,
  ...(z ? { z } : {}),
});

/** Ajusta !ref para cobrir tudo o que foi escrito. */
function fecharFolha(ws: Folha) {
  let maxR = 0;
  let maxC = 0;
  for (const k of Object.keys(ws)) {
    if (k.startsWith("!")) continue;
    const a = XLSX.utils.decode_cell(k);
    if (a.r > maxR) maxR = a.r;
    if (a.c > maxC) maxC = a.c;
  }
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
}

const col = (i: number) => XLSX.utils.encode_col(i);
/** "N" + 8 → "N8". */
const ref = (coluna: string, linha: number) => `${coluna}${linha}`;

// ── O relatório UFRGS ────────────────────────────────────────────────

export interface OpcoesExportacaoUfrgs {
  /** Nome do arquivo, sem extensão. */
  nomeArquivo: string;
  /** Aparece na linha 2, como na planilha original. */
  empresa?: string;
  /** Aparece na linha 3 ("Contrato: ..."). */
  contrato?: string;
  postos: PostoUfrgs[];
  tarifas: TarifaUfrgs[];
}

/**
 * A linha 5 é a tarifa de SINECARGA/RS e a linha 6 a de SINDIRODOSUL/RS — é
 * essa a ordem do arquivo entregue, e cada linha de dado aponta para uma das
 * duas ($N$5 ou $N$6). A confirmação está na linha 69 do original, a única
 * SINECARGA do mês e a única que usa $N$5.
 *
 * Qual VIGÊNCIA vai no cabeçalho: a das próprias diárias exportadas. Se o
 * lote misturar duas tarifas do mesmo sindicato (exportação que atravessa um
 * dissídio), a linha de cabeçalho fica com a mais recente e as diárias da
 * tarifa antiga saem com valor gravado em vez de fórmula — melhor uma célula
 * sem fórmula do que uma fórmula que devolve outro número.
 */
const ORDEM_TARIFA: readonly string[] = ["SINECARGA/RS", "SINDIRODOSUL/RS"];

function tarifasDoCabecalho(diarias: DiariaUfrgs[], opcoes: OpcoesExportacaoUfrgs) {
  const escolhidas = new Map<string, TarifaUfrgs | null>();
  for (const sindicato of ORDEM_TARIFA) {
    const delas = diarias.filter((d) => d.sindicato === sindicato);
    // A tarifa da diária mais recente do sindicato; sem diárias, a vigente
    // hoje — o relatório vazio ainda mostra a tabela do contrato.
    const maisRecente = delas
      .slice()
      .sort((a, b) => b.saida.localeCompare(a.saida))[0];
    const t = maisRecente
      ? tarifaVigente(opcoes.tarifas, sindicato, maisRecente.saida)
      : tarifaVigente(opcoes.tarifas, sindicato, new Date().toISOString().slice(0, 10));
    escolhidas.set(sindicato, t ?? null);
  }
  return escolhidas;
}

export function montarFolhaUfrgs(
  diarias: DiariaUfrgs[],
  opcoes: OpcoesExportacaoUfrgs,
): Folha {
  const ws: Folha = {};
  const merges: XLSX.Range[] = [];
  const merge = (a: string) => merges.push(XLSX.utils.decode_range(a));

  // Ordem do relatório: pela criação, que é a ordem em que as linhas entram
  // na planilha hoje (a coluna "Item" é a posição, não um dado da diária).
  const linhas = diarias
    .slice()
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm) || a.id.localeCompare(b.id));

  const cabecalho = tarifasDoCabecalho(linhas, opcoes);
  const linhaTarifa = new Map<string, number>();
  ORDEM_TARIFA.forEach((s, i) => linhaTarifa.set(s, 5 + i));

  // ── linhas 1 a 4: o cabeçalho do relatório ──
  celula(ws, "D1", txt("TABELA DE PAGAMENTO DE DIÁRIAS UFRGS     "));
  merge("D1:S1");
  celula(ws, "D2", txt(opcoes.empresa || linhas[0]?.contratoEmpresa || ""));
  merge("D2:S2");
  celula(ws, "D3", txt(`Contrato: ${opcoes.contrato || linhas[0]?.contratoNome || ""}`));
  merge("D3:S3");

  const competencias = [...new Set(linhas.map((l) => l.competencia).filter(Boolean))].sort();
  const competencia = competencias[0] ?? "";
  celula(ws, "V2", txt("ANO"));
  celula(ws, "W2", competencia ? num(anoDaCompetencia(competencia)) : txt(""));
  celula(ws, "V3", txt("MÊS"));
  celula(
    ws,
    "W3",
    txt(
      // Exportação que atravessa meses não tem "o mês": o cabeçalho diz
      // quais, e o Período abaixo dá as datas exatas.
      competencias.length > 1
        ? competencias.map(mesDaCompetencia).join(" / ")
        : mesDaCompetencia(competencia),
    ),
  );

  const datasSaida = linhas.map((l) => l.saida).filter(Boolean).sort();
  const datasRetorno = linhas.map((l) => l.retorno).filter(Boolean).sort();
  const de = datasSaida[0] ?? "";
  const ate = datasRetorno[datasRetorno.length - 1] ?? "";
  const br = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
  celula(ws, "J4", txt(de && ate ? `Período de ${br(de)} A ${br(ate)}` : ""));
  merge("J4:L4");
  celula(ws, "R4", txt("VA"));

  // ── linhas 5 e 6: as tarifas que as fórmulas referenciam ──
  for (const [sindicato, linha] of linhaTarifa) {
    const t = cabecalho.get(sindicato) ?? null;
    celula(ws, ref("M", linha), txt(sindicato));
    celula(ws, ref("N", linha), dinheiro(t?.hospedagemCentavos ?? 0));
    celula(ws, ref("O", linha), dinheiro(t?.cafeCentavos ?? 0));
    celula(ws, ref("P", linha), dinheiro(t?.almocoCentavos ?? 0));
    celula(ws, ref("Q", linha), dinheiro(t?.jantaCentavos ?? 0));
    celula(ws, ref("R", linha), dinheiro(t?.vaCentavos ?? 0));
  }

  // ── linha 7: os títulos das colunas ──
  COLUNAS_UFRGS.forEach((c, i) => celula(ws, ref(col(i), 7), txt(c.titulo)));
  // Colunas de controle do sistema, depois do relatório. A planilha original
  // já tinha uma helper na coluna Y (=S/31.69, para recuperar os dias de VA);
  // aqui elas carregam a rastreabilidade que o pedido cita como o motivo de
  // sair do Excel — sem isso o relatório exportado não diz de qual diária do
  // sistema cada linha veio, nem em que estado ela está.
  const COL_EXTRA = COLUNAS_UFRGS.length; // X
  celula(ws, ref(col(COL_EXTRA), 7), txt("Dias VA"));
  celula(ws, ref(col(COL_EXTRA + 1), 7), txt("Nº no sistema"));
  celula(ws, ref(col(COL_EXTRA + 2), 7), txt("Status"));
  celula(ws, ref(col(COL_EXTRA + 3), 7), txt("Lançada por"));

  // ── linhas 8+: os dados ──
  const PRIMEIRA = 8;
  linhas.forEach((l, i) => {
    const r = PRIMEIRA + i;
    const tl = linhaTarifa.get(l.sindicato);
    const tCab = cabecalho.get(l.sindicato) ?? null;
    // A fórmula só entra quando a tarifa da linha É a do cabeçalho; senão o
    // resultado divergiria do valor faturado (ver ORDEM_TARIFA acima).
    const mesmaTarifa = !!tl && !!tCab && !!l.tarifaId && tCab.id === l.tarifaId;

    celula(ws, ref("A", r), num(i + 1)); // Item
    celula(ws, ref("B", r), txt(l.codFornecedor));
    celula(ws, ref("C", r), txt(l.matricula));
    celula(ws, ref("D", r), txt(l.motoristaNome));
    celula(ws, ref("E", r), txt(l.sindicato));
    celula(ws, ref("F", r), txt(l.lotacao));
    celula(ws, ref("G", r), txt(l.numeroOficio));
    celula(ws, ref("H", r), data(l.saida));
    celula(ws, ref("I", r), data(l.retorno));
    celula(ws, ref("J", r), txt(l.destino));
    celula(ws, ref("K", r), l.dataDeposito ? data(l.dataDeposito) : null);
    celula(ws, ref("L", r), txt(l.posto));
    celula(ws, ref("M", r), dinheiro(l.valorPostoVariavelCentavos));
    celula(ws, ref("N", r), num(l.qtHospedagem));
    celula(ws, ref("O", r), num(l.qtCafe));
    celula(ws, ref("P", r), num(l.qtAlmoco));
    celula(ws, ref("Q", r), num(l.qtJanta));

    // R = ($N$<t>*N<r>)+($O$<t>*O<r>)+($P$<t>*P<r>)+($Q$<t>*Q<r>)
    const valorTotal = l.valorTotalCentavos / 100;
    celula(
      ws,
      ref("R", r),
      mesmaTarifa
        ? formula(
            `($N$${tl}*N${r})+($O$${tl}*O${r})+($P$${tl}*P${r})+($Q$${tl}*Q${r})`,
            valorTotal,
            FMT_MOEDA,
          )
        : dinheiro(l.valorTotalCentavos),
    );
    // S = tarifa de VA × dias de VA (na planilha isto era "=31.69*2")
    celula(
      ws,
      ref("S", r),
      mesmaTarifa && l.qtVa > 0
        ? formula(`$R$${tl}*${l.qtVa}`, l.valorVaCentavos / 100, FMT_MOEDA)
        : dinheiro(l.valorVaCentavos),
    );
    // T = R - S
    celula(ws, ref("T", r), formula(`R${r}-S${r}`, l.valorLiquidoCentavos / 100, FMT_MOEDA));
    // U = (T*f/(1-f)), o gross-up da alíquota total
    const f = l.aliquotaTotal || 0;
    celula(
      ws,
      ref("U", r),
      formula(`(T${r}*${f}/(1-${f}))`, l.tributosCentavos / 100, FMT_MOEDA),
    );
    // V = T + U
    celula(ws, ref("V", r), formula(`T${r}+U${r}`, l.valorFaturarCentavos / 100, FMT_MOEDA));
    celula(ws, ref("W", r), txt(l.fiscal));

    celula(ws, ref(col(COL_EXTRA), r), num(l.qtVa));
    celula(ws, ref(col(COL_EXTRA + 1), r), txt(l.id));
    celula(ws, ref(col(COL_EXTRA + 2), r), txt(STATUS_SOLICITACAO[l.status].label));
    celula(ws, ref(col(COL_EXTRA + 3), r), txt(l.solicitante));
  });

  const ULTIMA = PRIMEIRA + Math.max(linhas.length, 1) - 1;
  const faixa = (c: string) => `${c}${PRIMEIRA}:${c}${ULTIMA}`;

  // ── Totalizadores ──
  const rTot = ULTIMA + 1;
  const soma = (pegar: (l: DiariaUfrgs) => number) => linhas.reduce((a, l) => a + pegar(l), 0);
  celula(ws, ref("A", rTot), txt("Totalizadores"));
  for (const [c, pegar] of [
    ["N", (l: DiariaUfrgs) => l.qtHospedagem],
    ["O", (l: DiariaUfrgs) => l.qtCafe],
    ["P", (l: DiariaUfrgs) => l.qtAlmoco],
    ["Q", (l: DiariaUfrgs) => l.qtJanta],
  ] as const) {
    celula(ws, ref(c, rTot), formula(`SUM(${faixa(c)})`, soma(pegar)));
  }
  for (const [c, pegar] of [
    ["R", (l: DiariaUfrgs) => l.valorTotalCentavos],
    ["S", (l: DiariaUfrgs) => l.valorVaCentavos],
    ["T", (l: DiariaUfrgs) => l.valorLiquidoCentavos],
    ["U", (l: DiariaUfrgs) => l.tributosCentavos],
    ["V", (l: DiariaUfrgs) => l.valorFaturarCentavos],
  ] as const) {
    celula(ws, ref(c, rTot), formula(`SUM(${faixa(c)})`, soma(pegar) / 100, FMT_MOEDA));
  }
  celula(
    ws,
    ref(col(COL_EXTRA), rTot),
    formula(`SUM(${faixa(col(COL_EXTRA))})`, soma((l) => l.qtVa)),
  );

  // ── Tabela de referência do contrato + resumos de tributos ──
  // Mesmos blocos e os mesmos deslocamentos relativos do arquivo original
  // (lá: Totalizadores em 136, "RESUMO DOS TRIBUTOS" em 139).
  const base = rTot + 3;
  const L = (n: number) => base + n; // L(0) = a linha do primeiro bloco

  celula(ws, ref("P", L(0)), txt("RESUMO DOS TRIBUTOS"));
  merge(`P${L(0)}:T${L(0)}`);

  celula(
    ws,
    ref("C", L(1)),
    txt(`TABELA DE REFERÊNCIA PARA O PAGAMENTO DE DIÁRIAS CONFORME ${opcoes.contrato || "O CONTRATO"}`),
  );
  merge(`C${L(1)}:K${L(1)}`);
  celula(ws, ref("P", L(1)), txt("DESCRIÇÃO"));
  merge(`P${L(1)}:Q${L(1)}`);
  celula(ws, ref("R", L(1)), txt("ALÍQUOTA"));
  merge(`R${L(1)}:T${L(1)}`);

  celula(ws, ref("C", L(2)), txt("DATA BASE"));
  celula(ws, ref("D", L(2)), txt("SINDICATO"));
  celula(ws, ref("E", L(2)), txt("VALE ALIMENTAÇÃO"));
  celula(ws, ref("H", L(2)), txt("CAFÉ DA MANHÃ"));
  celula(ws, ref("I", L(2)), txt("ALMOÇO"));
  celula(ws, ref("J", L(2)), txt("JANTA"));
  celula(ws, ref("K", L(2)), txt("HOSPEDAGEM"));

  // Uma linha por sindicato, na ordem do relatório (SINDIRODOSUL primeiro,
  // como no original — a ordem das linhas 5/6 é a das FÓRMULAS, não desta
  // tabela de leitura).
  const paraTabela = [...SINDICATOS_UFRGS];
  paraTabela.forEach((sindicato, i) => {
    const r = L(3 + i);
    const t = cabecalho.get(sindicato) ?? null;
    celula(ws, ref("C", r), t ? (data(t.vigenciaInicio) ?? txt("")) : txt(""));
    celula(ws, ref("D", r), txt(sindicato));
    celula(ws, ref("E", r), dinheiro(t?.vaCentavos ?? 0));
    celula(ws, ref("H", r), dinheiro(t?.cafeCentavos ?? 0));
    celula(ws, ref("I", r), dinheiro(t?.almocoCentavos ?? 0));
    celula(ws, ref("J", r), dinheiro(t?.jantaCentavos ?? 0));
    celula(ws, ref("K", r), dinheiro(t?.hospedagemCentavos ?? 0));
  });

  // O resumo dos tributos usa a alíquota da tarifa em vigor. Vale a do
  // primeiro sindicato com tarifa: as três alíquotas são do serviço (PIS,
  // COFINS e ISS do município), não do sindicato.
  const tRef =
    cabecalho.get("SINDIRODOSUL/RS") ?? cabecalho.get("SINECARGA/RS") ?? null;
  const tributos: [string, number][] = [
    ["1 PIS", tRef?.aliquotaPis ?? 0],
    ["2 COFINS", tRef?.aliquotaCofins ?? 0],
    ["3 ISS          ", tRef?.aliquotaIss ?? 0],
  ];
  tributos.forEach(([nome, aliquota], i) => {
    const r = L(2 + i);
    celula(ws, ref("P", r), txt(nome));
    merge(`P${r}:Q${r}`);
    celula(ws, ref("R", r), num(aliquota));
    merge(`R${r}:T${r}`);
  });
  const rTotalTrib = L(5);
  celula(ws, ref("P", rTotalTrib), txt("Total (F)"));
  merge(`P${rTotalTrib}:Q${rTotalTrib}`);
  celula(
    ws,
    ref("R", rTotalTrib),
    formula(
      `SUM(R${L(2)}:T${L(4)})`,
      tributos.reduce((a, [, v]) => a + v, 0),
    ),
  );
  merge(`R${rTotalTrib}:T${rTotalTrib}`);

  // ── PLANILHA RESUMO - VIAGENS REALIZADAS ──
  const rResumo = L(4);
  celula(ws, ref("V", rResumo), txt("PLANILHA RESUMO - VIAGENS REALIZADAS"));
  merge(`V${rResumo}:W${rResumo}`);
  const resumo: [string, string, number][] = [
    ["Valor Total das Diárias ", `R${rTot}`, soma((l) => l.valorTotalCentavos)],
    ["Valor Total VA (D)", `S${rTot}`, soma((l) => l.valorVaCentavos)],
    ["Valor Líquido das Diárias (E)", `T${rTot}`, soma((l) => l.valorLiquidoCentavos)],
    ["Valor dos Tributos (G)", `U${rTot}`, soma((l) => l.tributosCentavos)],
    ["Valor da Fatura", `V${rTot}`, soma((l) => l.valorFaturarCentavos)],
  ];
  resumo.forEach(([rotulo, celOrigem, centavos], i) => {
    const r = rResumo + 1 + i;
    celula(ws, ref("V", r), txt(rotulo));
    celula(ws, ref("W", r), formula(celOrigem, centavos / 100, FMT_MOEDA));
  });

  // ── Resumo por sindicato ──
  const rSind = L(8);
  celula(ws, ref("D", rSind), txt("SINDICATOS"));
  celula(ws, ref("E", rSind), txt("VALOR À FATURAR"));
  celula(ws, ref("F", rSind), txt("QT HOSPEDAGEM"));
  celula(ws, ref("G", rSind), txt("QT CAFÉ"));
  celula(ws, ref("H", rSind), txt("QT ALMOÇO"));
  celula(ws, ref("I", rSind), txt("QT JANTAR"));
  paraTabela.forEach((sindicato, i) => {
    const r = rSind + 1 + i;
    const delas = linhas.filter((l) => l.sindicato === sindicato);
    celula(ws, ref("D", r), txt(sindicato));
    celula(
      ws,
      ref("E", r),
      formula(
        `SUMIF($E$${PRIMEIRA}:$E$${ULTIMA},$D$${r},$V$${PRIMEIRA}:$V$${ULTIMA})`,
        delas.reduce((a, l) => a + l.valorFaturarCentavos, 0) / 100,
        FMT_MOEDA,
      ),
    );
    for (const [c, origem, pegar] of [
      ["F", "N", (l: DiariaUfrgs) => l.qtHospedagem],
      ["G", "O", (l: DiariaUfrgs) => l.qtCafe],
      ["H", "P", (l: DiariaUfrgs) => l.qtAlmoco],
      ["I", "Q", (l: DiariaUfrgs) => l.qtJanta],
    ] as const) {
      celula(
        ws,
        ref(c, r),
        formula(
          `SUMIF($E$${PRIMEIRA}:$E$${ULTIMA},$D$${r},$${origem}$${PRIMEIRA}:$${origem}$${ULTIMA})`,
          delas.reduce((a, l) => a + pegar(l), 0),
        ),
      );
    }
  });
  const rSindTotal = rSind + 1 + paraTabela.length;
  celula(ws, ref("D", rSindTotal), txt("TOTAL"));
  celula(
    ws,
    ref("E", rSindTotal),
    formula(
      `SUM(E${rSind + 1}:E${rSindTotal - 1})`,
      soma((l) => l.valorFaturarCentavos) / 100,
      FMT_MOEDA,
    ),
  );
  for (const [c, pegar] of [
    ["F", (l: DiariaUfrgs) => l.qtHospedagem],
    ["G", (l: DiariaUfrgs) => l.qtCafe],
    ["H", (l: DiariaUfrgs) => l.qtAlmoco],
    ["I", (l: DiariaUfrgs) => l.qtJanta],
  ] as const) {
    celula(
      ws,
      ref(c, rSindTotal),
      formula(`SUM(${c}${rSind + 1}:${c}${rSindTotal - 1})`, soma(pegar)),
    );
  }

  // ── POSTO/CARGO, agrupado por localidade ──
  let r = rSindTotal + 2;
  celula(ws, ref("R", r), txt("POSTO/CARGO"));
  celula(ws, ref("U", r), txt("Total a Faturar"));
  celula(ws, ref("V", r), txt("Preço por Posto"));
  r += 1;

  const porLocalidade = new Map<string, PostoUfrgs[]>();
  for (const p of [...opcoes.postos].sort((a, b) => a.ordem - b.ordem)) {
    porLocalidade.set(p.localidade, [...(porLocalidade.get(p.localidade) ?? []), p]);
  }
  const linhasTotalLocalidade: number[] = [];
  for (const [localidade, lista] of porLocalidade) {
    const primeira = r;
    for (const p of lista) {
      const delas = linhas.filter((l) => l.posto === p.codigo);
      celula(ws, ref("P", r), txt(p.codigo));
      celula(ws, ref("R", r), txt(p.descricao));
      celula(
        ws,
        ref("U", r),
        formula(
          `SUMIF($L$${PRIMEIRA}:$L$${ULTIMA},P${r},$V$${PRIMEIRA}:$V$${ULTIMA})`,
          delas.reduce((a, l) => a + l.valorFaturarCentavos, 0) / 100,
          FMT_MOEDA,
        ),
      );
      // "Preço por Posto" é o valor do posto com variável, quando lançado.
      const comVariavel = delas.find((l) => l.valorPostoVariavelCentavos > 0);
      if (comVariavel) {
        celula(ws, ref("V", r), dinheiro(comVariavel.valorPostoVariavelCentavos));
      }
      r += 1;
    }
    const ultima = r - 1;
    celula(ws, ref("R", r), txt(`TOTAL - ${localidade}`));
    merge(`R${r}:T${r}`);
    celula(
      ws,
      ref("U", r),
      formula(
        `SUM(U${primeira}:U${ultima})`,
        linhas
          .filter((l) => lista.some((p) => p.codigo === l.posto))
          .reduce((a, l) => a + l.valorFaturarCentavos, 0) / 100,
        FMT_MOEDA,
      ),
    );
    linhasTotalLocalidade.push(r);
    r += 2; // linha em branco entre os blocos, como no original
  }

  celula(ws, ref("R", r), txt("TOTAL DO CONTRATO"));
  merge(`R${r}:T${r}`);
  celula(
    ws,
    ref("U", r),
    formula(
      `SUM(${linhasTotalLocalidade.map((n) => `U${n}`).join("+")})`,
      linhas
        .filter((l) => opcoes.postos.some((p) => p.codigo === l.posto))
        .reduce((a, l) => a + l.valorFaturarCentavos, 0) / 100,
      FMT_MOEDA,
    ),
  );

  ws["!cols"] = LARGURAS.map((wch) => ({ wch }));
  ws["!merges"] = merges;
  fecharFolha(ws);
  return ws;
}

/** Nome da aba, no formato da original: "DIARIAS 09.2025". */
function nomeAba(diarias: DiariaUfrgs[]) {
  const competencia = [...new Set(diarias.map((d) => d.competencia).filter(Boolean))].sort()[0];
  if (!competencia) return "DIARIAS";
  return `DIARIAS ${competencia.slice(5, 7)}.${competencia.slice(0, 4)}`;
}

export function exportarDiariasUfrgs(
  diarias: DiariaUfrgs[],
  opcoes: OpcoesExportacaoUfrgs,
) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, montarFolhaUfrgs(diarias, opcoes), nomeAba(diarias));
  XLSX.writeFile(wb, `${opcoes.nomeArquivo}.xlsx`);
}

// ── O relatório das diárias de diarista ──────────────────────────────

/**
 * A diária de diarista NÃO tem o layout da planilha da UFRGS — são outras
 * colunas (faltante, diarista, CPF, PIX, turno, VT) e outro destinatário: a
 * planilha anexada é o relatório que vai PARA A UFRGS, e não existe
 * equivalente dela do lado do diarista.
 *
 * Então os dois botões de exportar existem nas três rotas, como pedido, e
 * cada um exporta o tipo que está selecionado no filtro: em "Diárias UFRGS"
 * sai o relatório reconstruído acima; em "Diárias de diaristas" sai a lista
 * conferível — uma linha por DIA de diária, que é como a tela mostra e como
 * o pagamento acontece.
 */
export function exportarDiariasDiaristas(
  solicitacoes: SolicitacaoDiaria[],
  nomeArquivo: string,
) {
  const aoa: (string | number)[][] = [
    [
      "ID da Solicitação",
      "Contrato",
      "Cliente",
      "Empresa",
      "Posto",
      "Nome do Faltante",
      "CPF do Faltante",
      "Nome do Diarista",
      "CPF do Diarista",
      "Tipo da chave Pix",
      "Chave Pix",
      "Data da Diária",
      "Turno",
      "Qt VT",
      "Valor Unit VT (R$)",
      "Valor Diária (R$)",
      "Valor Total (R$)",
      "Status",
      "Solicitante",
      "Criada em",
      "Observações",
    ],
  ];
  for (const s of solicitacoes) {
    for (const l of s.diarias) {
      aoa.push([
        s.id,
        s.contratoNome,
        s.contratoCliente,
        s.contratoEmpresa,
        s.posto,
        s.faltanteNome,
        s.faltanteCpf,
        s.diaristaNome,
        s.diaristaCpf,
        labelTipoPix(s.pixTipo),
        s.pix,
        l.data ? l.data.split("-").reverse().join("/") : "",
        labelTurno(l.turno),
        l.qtVt,
        l.valorUnitVt,
        l.valorDiaria,
        valorTotalLinha(l),
        STATUS_DIARISTA[s.status].label,
        s.solicitante,
        s.criadoEm,
        s.observacoes,
      ]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 16 }, { wch: 26 }, { wch: 24 }, { wch: 24 }, { wch: 16 }, { wch: 28 },
    { wch: 16 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 26 }, { wch: 12 },
    { wch: 12 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 12 },
    { wch: 24 }, { wch: 18 }, { wch: 40 },
  ];
  // As quatro colunas de dinheiro saem no mesmo formato contábil da planilha
  // da UFRGS — é o mesmo financeiro conferindo os dois relatórios.
  for (let r = 1; r < aoa.length; r++) {
    for (const c of ["O", "P", "Q"]) {
      const cel = ws[`${c}${r + 1}`] as Celula | undefined;
      if (cel) cel.z = FMT_MOEDA;
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Diárias de diaristas");
  XLSX.writeFile(wb, `${nomeArquivo}.xlsx`);
}

/** Sufixo do nome do arquivo: "2026-09-17". */
export const hojeIso = () => new Date().toISOString().slice(0, 10);
