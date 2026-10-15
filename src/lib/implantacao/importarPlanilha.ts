// IMPORTADOR DAS PLANILHAS DE INÍCIO DE CONTRATO — SIS-2026-0599.
//
// Os formatos abaixo não são suposição: foram medidos nos dois arquivos que o
// Yuri anexou ao chamado. As armadilhas, todas reais:
//
//  * "DADOS PARA INICIO DE CONTRATO": o cabeçalho está na LINHA 4 (índice 3),
//    não na 1 — as três primeiras são título e espaço em branco.
//  * "UNIFORMES": são DOIS blocos lado a lado na mesma aba — uniformes em
//    A:C e materiais em E:G — e o cargo só aparece na primeira linha do
//    grupo (célula mesclada), então herda da linha de cima.
//  * "LOCAIS DE TRABALHO": mesmo caso de célula mesclada em local/cidade/
//    endereço; a coluna POSTO muda a cada linha.
//  * Valores monetários vêm como texto no formato AMERICANO (" R$ 1,605.33 "):
//    vírgula é milhar e ponto é decimal, apesar de a planilha ser brasileira.
//    Ler com parseFloat direto dá 1,60 em vez de 1605,33.
import * as XLSX from "xlsx";

export interface LinhaPostoImportada {
  tipo_posto: string | null;
  tipo_servico: string;
  cbo: string | null;
  escala: string | null;
  carga_horaria: string | null;
  dias_turno: string | null;
  qt_postos: number;
  qt_funcionarios: number;
  salario_base: number | null;
  total_remuneracao: number | null;
  sindicato: string | null;
  vt_dia: number | null;
  vt_desconto: number | null;
  va_dia: string | null;
  insalubridade: number | null;
}

export interface LinhaLocalImportada {
  local_nome: string;
  cidade: string | null;
  endereco: string | null;
  posto: string | null;
  qt_postos: number;
  qt_funcionarios: number;
}

export interface LinhaItemImportada {
  cargo: string;
  descricao: string;
  tipo: "uniforme" | "material";
  quantidade: number;
}

export interface ResultadoImportacao {
  postos: LinhaPostoImportada[];
  locais: LinhaLocalImportada[];
  itens: LinhaItemImportada[];
  avisos: string[];
}

/**
 * " R$ 1,605.33 " → 1605.33 · " R$ 10,60 POR DIA TRABALHADO" → 10.6 ·
 * "19%" → 19 · "NÃO" → null
 *
 * A MESMA planilha mistura os dois formatos, e isso não é descuido de quem a
 * montou: as células de valor saíram de uma exportação em formato americano
 * (vírgula de milhar, ponto decimal), enquanto os textos escritos à mão usam
 * o português (vírgula decimal). Tratar tudo como americano transforma
 * "R$ 10,60 por dia" em R$ 1.060,00 — foi o que aconteceu no primeiro teste
 * contra o anexo real. Por isso o separador é decidido por linha, pelo que
 * vem DEPOIS do último separador.
 */
export function moeda(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return valor;
  const bruto = String(valor).trim();
  if (!bruto || /^(n[ãa]o|-|—)$/i.test(bruto)) return null;

  // Primeiro número da string — o resto costuma ser a frase ("POR DIA ...").
  const achado = bruto.replace(/R\$/gi, "").match(/-?\d[\d.,]*/);
  if (!achado) return null;
  let n = achado[0];

  const ultimaVirgula = n.lastIndexOf(",");
  const ultimoPonto = n.lastIndexOf(".");
  const separador = ultimaVirgula > ultimoPonto ? "," : ultimoPonto > -1 ? "." : "";

  if (separador) {
    const decimais = n.length - n.lastIndexOf(separador) - 1;
    // 2 casas depois do separador = decimal; 3 casas = milhar.
    if (decimais === 3) n = n.split(separador).join("");
    else {
      const [inteira, fracao] = [n.slice(0, n.lastIndexOf(separador)), n.slice(n.lastIndexOf(separador) + 1)];
      n = `${inteira.replace(/[.,]/g, "")}.${fracao}`;
    }
  }

  const num = Number.parseFloat(n);
  return Number.isFinite(num) ? num : null;
}

export function inteiro(valor: unknown): number {
  const n = moeda(valor);
  return n === null ? 0 : Math.round(n);
}

const texto = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s && !/^(n[ãa]o|-|—)$/i.test(s) ? s : null;
};

type Grade = unknown[][];

/**
 * Normaliza para Uint8Array antes de entregar ao xlsx. Não é preciosismo:
 * passar o ArrayBuffer cru funciona no navegador, mas sob jsdom (os testes)
 * o xlsx devolve um workbook falso com uma única aba "Sheet1" e nenhum erro —
 * a leitura "funciona" e vem vazia. Envolver em Uint8Array vale nos dois.
 */
function abrir(dado: ArrayBuffer | Uint8Array): XLSX.WorkBook {
  const bytes = dado instanceof Uint8Array ? dado : new Uint8Array(dado);
  return XLSX.read(bytes, { type: "array" });
}

function aba(wb: XLSX.WorkBook, nome: string): Grade | null {
  const ws = wb.Sheets[nome];
  if (!ws) return null;
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as Grade;
}

/** Célula mesclada: vazia herda o último valor preenchido da coluna. */
function herdar(grade: Grade, linha: number, coluna: number): string | null {
  for (let i = linha; i >= 0; i--) {
    const v = texto(grade[i]?.[coluna]);
    if (v) return v;
  }
  return null;
}

export function lerPlanilhaOperacional(buffer: ArrayBuffer | Uint8Array): ResultadoImportacao {
  const wb = abrir(buffer);
  const avisos: string[] = [];
  const postos: LinhaPostoImportada[] = [];
  const locais: LinhaLocalImportada[] = [];
  const itens: LinhaItemImportada[] = [];

  // ── Postos ────────────────────────────────────────────────────────────────
  const dados = aba(wb, "DADOS PARA INICIO DE CONTRATO");
  if (!dados) {
    avisos.push('Aba "DADOS PARA INICIO DE CONTRATO" não encontrada.');
  } else {
    const CABECALHO = 3; // linha 4 do Excel
    for (let i = CABECALHO + 1; i < dados.length; i++) {
      const l = dados[i] ?? [];
      const servico = texto(l[1]);
      if (!servico) continue;
      postos.push({
        tipo_posto: texto(l[0]),
        tipo_servico: servico,
        cbo: texto(l[2]),
        salario_base: moeda(l[3]),
        insalubridade: moeda(l[4]),
        total_remuneracao: moeda(l[21]),
        escala: texto(l[22]),
        carga_horaria: texto(l[23]),
        dias_turno: texto(l[24]),
        qt_postos: inteiro(l[25]),
        qt_funcionarios: inteiro(l[26]) || inteiro(l[25]),
        sindicato: texto(l[28]),
        vt_dia: moeda(l[29]),
        vt_desconto: moeda(l[30]),
        va_dia: texto(l[18]),
      });
    }
    if (!postos.length) avisos.push('Nenhum posto lido — confira se o cabeçalho continua na linha 4.');
  }

  // ── Locais ────────────────────────────────────────────────────────────────
  const gradeLocais = aba(wb, "LOCAIS DE TRABALHO");
  if (!gradeLocais) {
    avisos.push('Aba "LOCAIS DE TRABALHO" não encontrada.');
  } else {
    for (let i = 1; i < gradeLocais.length; i++) {
      const l = gradeLocais[i] ?? [];
      const posto = texto(l[3]);
      const local = herdar(gradeLocais, i, 0);
      if (!posto || !local) continue;
      locais.push({
        local_nome: local,
        cidade: herdar(gradeLocais, i, 1),
        endereco: herdar(gradeLocais, i, 2),
        posto,
        qt_postos: inteiro(l[4]),
        qt_funcionarios: inteiro(l[5]),
      });
    }
  }

  // ── Uniformes (A:C) e Materiais (E:G), dois blocos na mesma aba ───────────
  const gradeItens = aba(wb, "UNIFORMES");
  if (!gradeItens) {
    avisos.push('Aba "UNIFORMES" não encontrada.');
  } else {
    const blocos: { colCargo: number; colItem: number; colQtd: number; tipo: "uniforme" | "material" }[] = [
      { colCargo: 0, colItem: 1, colQtd: 2, tipo: "uniforme" },
      { colCargo: 4, colItem: 5, colQtd: 6, tipo: "material" },
    ];
    for (const b of blocos) {
      for (let i = 2; i < gradeItens.length; i++) {
        const l = gradeItens[i] ?? [];
        const descricao = texto(l[b.colItem]);
        if (!descricao) continue;
        const cargo = herdar(gradeItens, i, b.colCargo);
        if (!cargo) continue;
        itens.push({ cargo, descricao, tipo: b.tipo, quantidade: inteiro(l[b.colQtd]) });
      }
    }
  }

  return { postos, locais, itens, avisos };
}

/** Planilha do Financeiro: só o bloco de postos do "Resumo do Contrato". */
export function lerPlanilhaFinanceira(buffer: ArrayBuffer | Uint8Array): { postos: { posto: string; valor_posto: number | null; qt_postos: number }[]; avisos: string[] } {
  const wb = abrir(buffer);
  const grade = aba(wb, "Resumo do Contrato");
  if (!grade) return { postos: [], avisos: ['Aba "Resumo do Contrato" não encontrada.'] };

  // O bloco começa logo abaixo da linha cujo primeiro campo é "Posto".
  const inicio = grade.findIndex((l) => String(l?.[0] ?? "").trim().toLowerCase() === "posto");
  if (inicio < 0) return { postos: [], avisos: ['Cabeçalho "Posto" não encontrado na aba "Resumo do Contrato".'] };

  const postos: { posto: string; valor_posto: number | null; qt_postos: number }[] = [];
  for (let i = inicio + 1; i < grade.length; i++) {
    const l = grade[i] ?? [];
    const nome = texto(l[0]);
    if (!nome || /^total/i.test(nome)) continue;
    postos.push({ posto: nome, valor_posto: moeda(l[1]), qt_postos: inteiro(l[2]) });
  }
  return { postos, avisos: postos.length ? [] : ["Nenhum posto lido na planilha financeira."] };
}
