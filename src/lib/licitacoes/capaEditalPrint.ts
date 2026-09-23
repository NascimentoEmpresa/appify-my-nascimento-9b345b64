// SIS-2026-0449 — Impressão da Capa de Edital.
// Gera um HTML A4 com as informações preenchidas da capa e abre a janela de
// impressão. Mesmo padrão do declaracaoPrint.ts (Suprimentos): janela nova +
// window.print(), sem @media print no app.
import type { CapaEdital } from "@/hooks/useCapaEdital";

function escapar(valor: unknown) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// "—" quando vazio; booleano vira Sim/Não; array (reajuste) vira lista.
function val(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (Array.isArray(v)) return v.length ? v.map((x) => escapar(x)).join(", ") : "—";
  return escapar(v);
}

type Campo = [label: string, valor: unknown];

function secaoHtml(titulo: string, campos: Campo[]) {
  const linhas = campos
    .map(
      ([l, v]) =>
        `<tr><td class="rot">${escapar(l)}</td><td class="dado">${val(v)}</td></tr>`,
    )
    .join("");
  return `
    <section class="secao">
      <h2>${escapar(titulo)}</h2>
      <table class="kv">${linhas}</table>
    </section>`;
}

export function gerarHtmlCapaEdital(c: CapaEdital, empresaNome?: string): string {
  const geradoEm = new Date().toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const titulo = c.objeto || c.cidade || "Capa de Edital";

  const identificacao: Campo[] = [
    ["Empresa", empresaNome],
    ["Status", c.status],
    ["Cidade", c.cidade],
    ["UF", c.uf],
    ["Cliente / Órgão", c.cliente],
    ["Modalidade", c.modalidade],
    ["Responsável", c.responsavel],
    ["Forma de julgamento", c.forma_julgamento],
    ["Escritório", c.escritorio],
    ["Local", c.local],
    ["Atestado cap. técnica", c.atestado_cap_tecnica],
  ];

  const datas: Campo[] = [
    ["Abertura", c.abertura],
    ["Prazo impugnação", c.prazo_impugnacao],
    ["Prazo recurso", c.prazo_recurso],
    ["Validade proposta", c.validade_proposta],
    ["Prazo contrato", c.prazo_contrato],
    ["Visita técnica", c.visita_tecnica],
    ["Data início", c.data_inicio],
  ];

  const dimensionamento: Campo[] = [
    ["Qtd. postos", c.qtd_postos],
    ["Carga horária", c.carga_horaria],
    ["Valor estimado", c.valor_estimado],
    ["ISSQN", c.issqn],
    ["Vale transporte (valor)", c.vale_transporte_valor],
    ["Garantia da Proposta", c.garantia_proposta],
    ["Garantia Contratual", c.garantia_contratual],
    ["Garantia", c.garantia],
    ["Material", c.material],
    ["Material (tipo)", c.material_tipo],
    ["Reajuste", c.reajuste],
  ];

  const operacionais: Campo[] = [
    ["Trabalho escolar", c.trabalho_escolar],
    ["Emergencial", c.emergencial],
    ["Diluição de verbas (meses)", c.diluicao_meses],
    ["Conta vinculada", c.conta_vinculada],
    ["Conta vinculada — quem abre", c.conta_vinculada_quem_abre],
  ];

  const resultado: Campo[] = [
    ["Data de homologação", c.data_homologacao],
    ["Reunião de alinhamento", c.reuniao_alinhamento],
  ];

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${escapar(titulo)}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111; font-family: Arial, Helvetica, sans-serif; font-size: 12px; }
    header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
    header .doc { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #555; }
    header h1 { margin: 4px 0 2px; font-size: 18px; }
    header .sub { font-size: 11px; color: #555; }
    .secao { margin-bottom: 14px; break-inside: avoid; }
    .secao h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .5px; background: #eee; padding: 5px 8px; margin: 0 0 6px; border-left: 3px solid #111; }
    table.kv { width: 100%; border-collapse: collapse; }
    table.kv td { border: 1px solid #ddd; padding: 5px 8px; vertical-align: top; }
    td.rot { width: 40%; font-weight: 700; color: #333; background: #fafafa; }
    td.dado { width: 60%; }
    .obs { border: 1px solid #ddd; padding: 8px; white-space: pre-wrap; }
    footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #ccc; font-size: 10px; color: #777; text-align: right; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <header>
    <div class="doc">Capa de Edital — Licitações</div>
    <h1>${escapar(titulo)}</h1>
    <div class="sub">${escapar([c.cidade, c.uf].filter(Boolean).join(" / ") || "")} ${c.cliente ? "· " + escapar(c.cliente) : ""}</div>
  </header>

  ${secaoHtml("Identificação", identificacao)}
  ${secaoHtml("Datas e Prazos", datas)}
  ${secaoHtml("Dimensionamento", dimensionamento)}
  ${secaoHtml("Condições Operacionais", operacionais)}
  ${secaoHtml("Resultado", resultado)}
  ${c.observacoes ? `<section class="secao"><h2>Observações</h2><div class="obs">${escapar(c.observacoes)}</div></section>` : ""}

  <footer>Gerado em ${escapar(geradoEm)}</footer>
  <script>setTimeout(() => window.print(), 300);</script>
</body>
</html>`;
}

export function imprimirCapaEdital(c: CapaEdital, empresaNome?: string) {
  const janela = window.open("", "_blank", "width=900,height=700");
  if (!janela) throw new Error("O navegador bloqueou a janela de impressão.");
  janela.document.write(gerarHtmlCapaEdital(c, empresaNome));
  janela.document.close();
}
