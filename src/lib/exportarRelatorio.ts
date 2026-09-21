// Exportar dados — o motor comum (21/09/2026).
//
// Nasceu no Patrimônio e foi separado quando os Processos pediram o mesmo
// botão: as duas telas têm a mesma forma — uma FICHA por registro (campos
// agrupados por assunto) + BLOCOS de listas (contas, parcelas, motivos,
// audiências…). Cada tela descreve o seu conteúdo num `ModeloRelatorio` e
// este arquivo desenha as duas saídas:
//
//   • Excel: planilha pra TRABALHAR. "Um só": ficha vertical (Campo | Valor)
//     + uma aba por bloco. "Todos": aba Resumo + uma linha por registro +
//     uma aba por bloco com as colunas que dizem de qual registro é a linha.
//     R$ sai como número (soma e filtro funcionam), data como data, filtro
//     no cabeçalho, largura pelo conteúdo, e coluna 100% vazia não sai.
//   • HTML: relatório pra LER e imprimir. Autocontido (CSS dentro, nenhum
//     arquivo externo), índice clicável quando são todos, impressão paginada
//     com um registro por página.
//
// Nada aqui sabe de Patrimônio ou Processo — e nada aqui toca no banco.

import * as XLSX from "xlsx";

export type Linha = Record<string, unknown>;
export type TipoCampo = "texto" | "moeda" | "data" | "datahora" | "inteiro";

export interface Coluna<T = Linha> {
  rotulo: string;
  tipo?: TipoCampo;
  valor: (l: T) => unknown;
  /** Desenha o valor como selo colorido no HTML (status, situação…). */
  selo?: boolean;
  /** HTML próprio da célula (já escapado por quem escreve). */
  html?: (l: T) => string;
}
export interface GrupoFicha<T> { grupo: string; campos: Coluna<T>[] }
export interface Bloco<T> {
  titulo: string;
  /** Nome da aba no Excel (até 31 caracteres). */
  aba: string;
  colunas: Coluna[];
  linhas: (item: T) => Linha[];
  /** Linha de totais acima da tabela, no HTML. */
  resumoHtml?: (linhas: Linha[]) => string;
}

export interface ModeloRelatorio<T> {
  /** "Jurídico · Processos" — a linha pequena do topo. */
  modulo: string;
  itens: T[];
  /** Nome do registro no singular e plural: "patrimônio"/"patrimônios". */
  nome: { um: string; varios: string };
  tituloTodos: string;
  tituloUm: (item: T) => string;
  ancora: (item: T) => string;
  cabecalho: (item: T) => { eyebrow: string; titulo: string; sub?: string; selos?: unknown[] };
  /** Números em destaque no topo da ficha (só os que têm valor aparecem). */
  destaques?: (item: T) => [string, string][];
  ficha: GrupoFicha<T>[];
  blocos: Bloco<T>[];
  /** Todos: cartões do topo e linhas da aba Resumo. */
  resumo: { rotulo: string; valor: number | string; tipo?: TipoCampo }[];
  /** Todos: colunas do índice no HTML. */
  indice: Coluna<T>[];
  /** Todos: colunas que dizem de qual registro é cada linha dos blocos. */
  identificacao: Coluna<T>[];
  /** Explicações extras na aba Resumo: [assunto, texto]. */
  notas?: [string, string][];
  rodape?: string;
  autor: string;
}

// ── Formatação ──────────────────────────────────────────────────────
export const txt = (v: unknown) => (v == null ? "" : String(v));
export const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};
export const moeda = (v: unknown) => {
  const n = num(v);
  return n == null ? "" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};
/** "2026-09-21" ou timestamp → Date local (sem o fuso empurrar pro dia anterior). */
export const paraData = (v: unknown): Date | null => {
  const s = txt(v);
  if (!s) return null;
  const d = s.length <= 10 ? new Date(`${s}T12:00:00`) : new Date(s);
  return isNaN(+d) ? null : d;
};
export const dataBr = (v: unknown) => paraData(v)?.toLocaleDateString("pt-BR") ?? "";
export const dataHoraBr = (v: unknown) => {
  const d = paraData(v);
  return d ? d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
};
export const simNao = (v: unknown) => (v === true ? "Sim" : v === false ? "Não" : "");

/** Nome de arquivo seguro: "Prédio São José" → "predio-sao-jose". */
export const slug = (s: unknown, max = 40) =>
  txt(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, max);

/**
 * Só as colunas que têm dado em pelo menos uma linha. Conta de luz não tem
 * seguradora nem apólice: vinte colunas com metade vazia espremiam a
 * descrição e escondiam o que importa.
 */
const colunasComDado = <T,>(colunas: Coluna<T>[], linhas: T[]) =>
  colunas.filter(c => linhas.some(l => txt(c.valor(l)).trim() !== ""));

/** Colunas de texto corrido: quebram linha, mas não ficam estreitas. */
const TEXTO_LONGO = /descri|observa|detalhe|coment|o que aconteceu|onde pagar|link|motivo|propostas|reclamante|reclamada|nome/i;

// =====================================================================
// EXCEL
// =====================================================================
const FMT: Partial<Record<TipoCampo, string>> = {
  moeda: '"R$" #,##0.00;[Red]-"R$" #,##0.00',
  data: "dd/mm/yyyy",
  datahora: "dd/mm/yyyy hh:mm",
};

/** Valor da célula: número de verdade pra moeda, Date pra data. */
function celula(tipo: TipoCampo | undefined, v: unknown): unknown {
  if (tipo === "moeda" || tipo === "inteiro") return num(v);
  // Data que não dá pra ler (texto livre do sistema antigo) sai como veio —
  // melhor um texto do que uma célula vazia.
  if (tipo === "data" || tipo === "datahora") return paraData(v) ?? (txt(v).trim() || null);
  const s = txt(v);
  return s === "" ? null : s;
}
const larguraTexto = (v: unknown, tipo?: TipoCampo) =>
  v == null ? 0 : tipo === "moeda" ? 16 : tipo === "data" ? 12 : tipo === "datahora" ? 17 : String(v).length + 2;

/** Aba em forma de tabela: formato por coluna, filtro automático e largura pelo conteúdo. */
function abaTabela<T>(colunasBloco: Coluna<T>[], linhas: T[], prefixo: Coluna<T>[] = []): XLSX.WorkSheet {
  const cols = [...prefixo, ...colunasComDado(colunasBloco, linhas)];
  const aoa: unknown[][] = [cols.map(c => c.rotulo), ...linhas.map(l => cols.map(c => celula(c.tipo, c.valor(l))))];
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  cols.forEach((c, j) => {
    const z = c.tipo && FMT[c.tipo];
    if (!z) return;
    for (let i = 1; i < aoa.length; i++) {
      const cel = ws[XLSX.utils.encode_cell({ r: i, c: j })];
      if (cel) cel.z = z;
    }
  });
  ws["!cols"] = cols.map((c, j) => ({
    wch: Math.min(60, Math.max(c.rotulo.length + 2, ...aoa.slice(1, 400).map(r => larguraTexto(r[j], c.tipo)))),
  }));
  if (aoa.length > 1) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: cols.length - 1 } }) };
  return ws;
}

/** Aba "ficha": Campo | Valor, com uma linha de título por grupo. */
function abaFicha<T>(titulo: string, ficha: GrupoFicha<T>[], item: T): XLSX.WorkSheet {
  const aoa: unknown[][] = [[titulo, null], [null, null]];
  const formatos: { r: number; z: string }[] = [];
  for (const g of ficha) {
    aoa.push([g.grupo.toUpperCase(), null]);
    for (const c of g.campos) {
      const v = celula(c.tipo, c.valor(item));
      const z = c.tipo && FMT[c.tipo];
      if (z && v != null) formatos.push({ r: aoa.length, z });
      aoa.push([c.rotulo, v ?? "—"]);
    }
    aoa.push([null, null]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  for (const f of formatos) { const cel = ws[XLSX.utils.encode_cell({ r: f.r, c: 1 })]; if (cel) cel.z = f.z; }
  ws["!cols"] = [{ wch: 30 }, { wch: 70 }];
  return ws;
}

const nomeAba = (s: string) => s.replace(/[\\/?*[\]:]/g, "-").slice(0, 31);

/** Os bytes do .xlsx (separado do Blob pra dar pra testar fora do navegador). */
export function montarExcel<T>(m: ModeloRelatorio<T>): ArrayBuffer {
  const umSo = m.itens.length === 1;
  const wb = XLSX.utils.book_new();
  const fichaCampos = m.ficha.flatMap(g => g.campos);

  if (umSo) {
    XLSX.utils.book_append_sheet(wb, abaFicha(m.tituloUm(m.itens[0]), m.ficha, m.itens[0]), nomeAba(cap(m.nome.um)));
  } else {
    const linhas: unknown[][] = [
      [m.tituloTodos], [],
      ["Gerado em", new Date().toLocaleString("pt-BR")],
      ["Gerado por", m.autor], [],
    ];
    const moedas: number[] = [];
    for (const r of m.resumo) {
      if (r.tipo === "moeda") moedas.push(linhas.length);
      linhas.push([r.rotulo, r.tipo === "moeda" ? num(r.valor) : r.valor]);
    }
    linhas.push([], ["Como ler esta planilha"],
      [cap(m.nome.varios), `Uma linha por ${m.nome.um}, com a ficha completa.`],
      ["Demais abas", `Cada linha traz as colunas que identificam o ${m.nome.um} — use o filtro do cabeçalho para ver um só.`],
      ...(m.notas ?? []));
    const capa = XLSX.utils.aoa_to_sheet(linhas);
    for (const r of moedas) { const cel = capa[XLSX.utils.encode_cell({ r, c: 1 })]; if (cel) cel.z = FMT.moeda!; }
    capa["!cols"] = [{ wch: 32 }, { wch: 95 }];
    XLSX.utils.book_append_sheet(wb, capa, "Resumo");
    XLSX.utils.book_append_sheet(wb, abaTabela(fichaCampos, m.itens), nomeAba(cap(m.nome.varios)));
  }

  // Todos: cada linha diz de qual registro é. Um só: a ficha já diz.
  type ComDono = Linha & { __dono: T };
  const prefixo: Coluna<ComDono>[] = umSo ? [] : m.identificacao.map(c => ({ ...c, valor: (l: ComDono) => c.valor(l.__dono) }));
  for (const b of m.blocos) {
    const linhas: ComDono[] = m.itens.flatMap(it => b.linhas(it).map(l => ({ ...l, __dono: it })));
    if (!linhas.length) continue; // aba vazia só atrapalha
    XLSX.utils.book_append_sheet(wb, abaTabela(b.colunas as Coluna<ComDono>[], linhas, prefixo), nomeAba(b.aba));
  }
  return XLSX.write(wb, { bookType: "xlsx", type: "array", cellDates: true }) as ArrayBuffer;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// =====================================================================
// HTML
// =====================================================================
export const esc = (v: unknown) =>
  txt(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Texto da célula no HTML: moeda formatada, data em pt-BR, link clicável. */
function htmlValor<T>(c: Coluna<T>, l: T): string {
  if (c.html) return c.html(l);
  const v = c.valor(l);
  if (c.selo) return selo(v);
  if (c.tipo === "moeda") return esc(moeda(v));
  if (c.tipo === "data") return esc(dataBr(v) || txt(v));
  if (c.tipo === "datahora") return esc(dataHoraBr(v) || txt(v));
  const s = txt(v);
  if (/^https?:\/\//i.test(s.trim())) return `<a href="${esc(s.trim())}" target="_blank" rel="noopener">${esc(s)}</a>`;
  return esc(s).replace(/\n/g, "<br>");
}

/** Cor do selo pela palavra do começo — a mesma régua para qualquer tela. */
const COR_SELO: [RegExp, string, string][] = [
  [/^(pago|quitad|procedente|provido|ativo|sim\b)/i, "#dcfce7", "#15803d"],
  [/^(pagando|em andamento|enviado)/i, "#dbeafe", "#1d4ed8"],
  [/^(vencid|improcedente|improvido)/i, "#fee2e2", "#b91c1c"],
  [/^(pendente|pend\.|aguard|parcialmente|indefinido)/i, "#fef9c3", "#a16207"],
  [/^(acordo)/i, "#ede9fe", "#6d28d9"],
];
export function selo(v: unknown): string {
  const s = txt(v).trim();
  if (!s) return "";
  const cor = COR_SELO.find(([re]) => re.test(s));
  const [bg, fg] = cor ? [cor[1], cor[2]] : ["#f1f5f9", "#475569"];
  return `<span class="selo" style="background:${bg};color:${fg}">${esc(s)}</span>`;
}

function htmlTabela<T>(todas: Coluna<T>[], linhas: T[]): string {
  const colunas = colunasComDado(todas, linhas);
  const cls = (c: Coluna<T>) =>
    c.tipo === "moeda" ? ' class="num"' : c.tipo === "data" || c.tipo === "datahora" ? ' class="dt"' : TEXTO_LONGO.test(c.rotulo) ? ' class="longo"' : "";
  const cab = colunas.map(c => `<th${c.tipo === "moeda" ? ' class="num"' : ""}>${esc(c.rotulo)}</th>`).join("");
  const corpo = linhas.map(l => `<tr>${colunas.map(c => `<td${cls(c)}>${htmlValor(c, l)}</td>`).join("")}</tr>`).join("");
  return `<div class="tab-wrap"><table><thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table></div>`;
}

function htmlItem<T>(m: ModeloRelatorio<T>, item: T, comIndice: boolean): string {
  const cab = m.cabecalho(item);
  const ficha = m.ficha.map(g => {
    const campos = g.campos.map(c => ({ c, v: htmlValor(c, item) })).filter(({ v }) => v !== "");
    if (!campos.length) return "";
    return `<div class="grupo"><h4>${esc(g.grupo)}</h4><dl>${campos.map(({ c, v }) =>
      `<div class="campo${/observa|anota|motivo/i.test(c.rotulo) ? " largo" : ""}"><dt>${esc(c.rotulo)}</dt><dd>${v}</dd></div>`).join("")}</dl></div>`;
  }).join("");
  const destaques = (m.destaques?.(item) ?? []).filter(([, v]) => v);
  const blocos = m.blocos.map(b => {
    const linhas = b.linhas(item);
    return `<section class="bloco"><h3>${esc(b.titulo)} <span class="qtd">${linhas.length}</span></h3>${
      linhas.length ? (b.resumoHtml?.(linhas) ?? "") + htmlTabela(b.colunas, linhas) : '<p class="vazio">Nenhum registro.</p>'}</section>`;
  }).join("");
  return `<article class="item" id="${esc(m.ancora(item))}">
    <header class="item-cab">
      <div>
        <div class="item-eyebrow">${esc(cab.eyebrow)}</div>
        <h2>${esc(cab.titulo)}</h2>
        ${cab.sub ? `<div class="item-sub">${esc(cab.sub)}</div>` : ""}
      </div>
      <div class="item-selos">${(cab.selos ?? []).map(selo).join(" ")}</div>
    </header>
    ${destaques.length ? `<div class="kpis">${destaques.map(([r, v]) => `<div class="kpi"><span>${esc(r)}</span><b>${esc(v)}</b></div>`).join("")}</div>` : ""}
    <div class="ficha">${ficha}</div>
    ${blocos}
    ${comIndice ? '<p class="voltar"><a href="#indice">↑ voltar ao índice</a></p>' : ""}
  </article>`;
}

/** O documento HTML inteiro, autocontido. */
export function montarHtml<T>(m: ModeloRelatorio<T>): string {
  const umSo = m.itens.length === 1;
  const titulo = umSo ? m.tituloUm(m.itens[0]) : m.tituloTodos;
  const valorResumo = (r: ModeloRelatorio<T>["resumo"][number]) => (r.tipo === "moeda" ? moeda(r.valor) : txt(r.valor));
  // A 2ª coluna do índice (o nome do registro) leva à ficha dele.
  const indiceComLink: Coluna<T>[] = m.indice.map((c, i) =>
    i === 1 ? { ...c, html: (it: T) => `<a href="#${esc(m.ancora(it))}">${esc(c.valor(it))}</a>` } : c);
  const indice = umSo ? "" : `
    <section class="capa">
      <div class="kpis">${m.resumo.map(r => `<div class="kpi"><span>${esc(r.rotulo)}</span><b>${esc(valorResumo(r))}</b></div>`).join("")}</div>
      <h3 id="indice">Índice <span class="qtd">${m.itens.length}</span></h3>
      ${htmlTabela(indiceComLink, m.itens)}
    </section>`;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f5f7fb;color:#0f172a;font:14px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif}
  .pagina{max-width:1100px;margin:0 auto;padding:28px 20px 60px}
  .topo{background:linear-gradient(135deg,#0f3171,#1e4fa8);color:#fff;border-radius:16px;padding:22px 26px;margin-bottom:22px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-end}
  .topo h1{margin:4px 0 0;font-size:22px}
  .topo .eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.8;font-weight:700}
  .topo .meta{font-size:12px;opacity:.85;text-align:right}
  .imprimir{margin-top:8px;border:1px solid rgba(255,255,255,.5);background:rgba(255,255,255,.12);color:#fff;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:0 0 16px}
  .kpi{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px 14px}
  .kpi span{display:block;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
  .kpi b{font-size:18px;color:#0f3171}
  .capa,.item{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:22px;margin-bottom:22px;box-shadow:0 6px 18px rgba(15,23,42,.05)}
  .item-cab{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:2px solid #0f3171;padding-bottom:12px;margin-bottom:16px}
  .item-eyebrow{font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
  .item h2{margin:2px 0;font-size:20px;color:#0f3171}
  .item-sub{font-size:13px;color:#475569}
  .item .kpis .kpi{background:#f8fbff}
  .ficha{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-bottom:8px}
  .grupo{border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px}
  .grupo h4{margin:0 0 8px;font-size:11px;color:#0f3171;text-transform:uppercase;letter-spacing:.06em}
  dl{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:8px 14px}
  .campo.largo{grid-column:1/-1}
  dt{font-size:11px;color:#64748b;font-weight:600}
  dd{margin:0;font-weight:600;word-break:break-word}
  h3{font-size:15px;margin:22px 0 8px;color:#0f172a;display:flex;align-items:center;gap:8px}
  .qtd{background:#eef4ff;color:#0f3171;border-radius:999px;padding:1px 9px;font-size:12px}
  .tab-wrap{overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px}
  table{border-collapse:collapse;width:100%;font-size:12.5px}
  th{background:#f1f5f9;text-align:left;padding:7px 9px;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#475569;white-space:nowrap}
  td{padding:7px 9px;border-top:1px solid #eef2f7;vertical-align:top}
  tbody tr:nth-child(even) td{background:#fafcff}
  .num{text-align:right;white-space:nowrap}
  .dt{white-space:nowrap}
  .longo{min-width:200px}
  .selo{display:inline-block;border-radius:999px;padding:1px 9px;font-size:11.5px;font-weight:700;white-space:nowrap}
  .vazio{color:#94a3b8;font-size:12.5px;margin:0}
  .tot{font-size:12.5px;color:#475569;margin:0 0 8px}
  .voltar{text-align:right;font-size:12px;margin:14px 0 0}
  a{color:#1d4ed8}
  .rodape{text-align:center;font-size:11px;color:#94a3b8}
  @media print{
    body{background:#fff}
    .pagina{padding:0;max-width:none}
    .imprimir,.voltar{display:none}
    .topo,.selo,.qtd,th{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .item,.capa{box-shadow:none;border:none;padding:0}
    .item{break-before:page}
    tr{break-inside:avoid}
  }
</style></head>
<body><div class="pagina">
  <div class="topo">
    <div><div class="eyebrow">${esc(m.modulo)}</div><h1>${esc(titulo)}</h1></div>
    <div class="meta">Gerado em ${esc(new Date().toLocaleString("pt-BR"))}<br>por ${esc(m.autor)}<br>
      <button class="imprimir" onclick="window.print()">Imprimir / salvar em PDF</button></div>
  </div>
  ${indice}
  ${m.itens.map(it => htmlItem(m, it, !umSo)).join("")}
  ${m.rodape ? `<p class="rodape">${esc(m.rodape)}</p>` : ""}
</div></body></html>`;
}

// ── Saída ───────────────────────────────────────────────────────────
export const excelBlob = (buf: ArrayBuffer) =>
  new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
export const htmlBlob = (html: string) => new Blob([html], { type: "text/html;charset=utf-8" });

/** Dispara o download no navegador. */
export function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
