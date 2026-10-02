import type { ItemCalculado } from "./calculos";

// SIS-2026-0578: a descrição padrão do modelo de NF aceita variáveis entre
// chaves ({glosas}, {va}...) que a analista preenche num clique, a partir dos
// valores lançados na própria nota. Nunca roda sozinho: cada nota tem a sua
// particularidade de texto (mapeado com o Ruan), então só substitui quando a
// analista pede e o resultado continua editável.

export interface VariavelDescricao {
  chave: string;
  rotulo: string;
  tipo: "dinheiro" | "texto";
}

export const VARIAVEIS_DESCRICAO: VariavelDescricao[] = [
  { chave: "competencia", rotulo: "Competência (MM/AAAA)", tipo: "texto" },
  { chave: "valor_exec", rotulo: "Valor do contrato executado", tipo: "dinheiro" },
  { chave: "valor_bruto", rotulo: "Valor bruto da NF", tipo: "dinheiro" },
  { chave: "mao_obra", rotulo: "Mão de obra", tipo: "dinheiro" },
  { chave: "va", rotulo: "Vale alimentação", tipo: "dinheiro" },
  { chave: "vt", rotulo: "Vale transporte", tipo: "dinheiro" },
  { chave: "materiais", rotulo: "Materiais", tipo: "dinheiro" },
  { chave: "faltas", rotulo: "Desconto de faltas", tipo: "dinheiro" },
  { chave: "posto_nao_implementado", rotulo: "Posto não implementado", tipo: "dinheiro" },
  { chave: "multas", rotulo: "Multas", tipo: "dinheiro" },
  { chave: "glosas", rotulo: "Glosas", tipo: "dinheiro" },
  { chave: "outros_descontos", rotulo: "Outros descontos", tipo: "dinheiro" },
  { chave: "total_descontos", rotulo: "Total de descontos", tipo: "dinheiro" },
  { chave: "motivo_multas", rotulo: "Motivo das multas", tipo: "texto" },
  { chave: "motivo_glosas", rotulo: "Motivo das glosas", tipo: "texto" },
  { chave: "motivo_outros", rotulo: "Motivo de outros descontos", tipo: "texto" },
  { chave: "inss_base", rotulo: "Base da retenção previdenciária", tipo: "dinheiro" },
  { chave: "inss_retido", rotulo: "Valor retido de INSS", tipo: "dinheiro" },
  { chave: "codigo_servico", rotulo: "Código de Serviço", tipo: "texto" },
  { chave: "cnae", rotulo: "CNAE", tipo: "texto" },
  { chave: "nbs", rotulo: "Código NBS", tipo: "texto" },
];

export interface ContextoDescricao {
  competencia: string; // yyyy-mm-dd (ou yyyy-mm)
  itens: (Pick<ItemCalculado, "valor_contrato_exec" | "vlr_va" | "vlr_vt" | "vlr_materiais" | "faltas" | "posto_nao_implementado" | "multas" | "glosas" | "outros_descontos" | "multas_pos_emissao" | "glosas_pos_emissao" | "outros_descontos_pos_emissao" | "vlr_bruto" | "vlr_mao_obra" | "inss" | "total_descontos"> & {
    justificativa_multas?: string | null;
    justificativa_glosas?: string | null;
    justificativa_outros_descontos?: string | null;
  })[];
  codigo_servico?: string | null;
  cnae?: string | null;
  nbs?: string | null;
}

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n).replace(/ /g, " ");

function formatarCompetencia(c: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(c ?? "");
  return m ? `${m[2]}/${m[1]}` : "";
}

function juntarMotivos(textos: (string | null | undefined)[]): string {
  const vistos: string[] = [];
  for (const t of textos) {
    const v = (t ?? "").trim();
    if (v && !vistos.includes(v)) vistos.push(v);
  }
  return vistos.join("; ");
}

// Valor de cada variável: número (formatado como moeda na hora de escrever)
// ou texto. Variável desconhecida não entra no mapa.
export function valoresDasVariaveis(ctx: ContextoDescricao): Record<string, number | string> {
  const soma = (f: (it: ContextoDescricao["itens"][number]) => number) =>
    Math.round(ctx.itens.reduce((s, it) => s + (f(it) || 0), 0) * 100) / 100;
  return {
    competencia: formatarCompetencia(ctx.competencia),
    valor_exec: soma((i) => i.valor_contrato_exec),
    valor_bruto: soma((i) => i.vlr_bruto),
    mao_obra: soma((i) => i.vlr_mao_obra),
    va: soma((i) => i.vlr_va),
    vt: soma((i) => i.vlr_vt),
    materiais: soma((i) => i.vlr_materiais),
    faltas: soma((i) => i.faltas),
    posto_nao_implementado: soma((i) => i.posto_nao_implementado),
    multas: soma((i) => i.multas + (i.multas_pos_emissao || 0)),
    glosas: soma((i) => i.glosas + (i.glosas_pos_emissao || 0)),
    outros_descontos: soma((i) => i.outros_descontos + (i.outros_descontos_pos_emissao || 0)),
    total_descontos: soma((i) => i.total_descontos),
    motivo_multas: juntarMotivos(ctx.itens.map((i) => i.justificativa_multas)),
    motivo_glosas: juntarMotivos(ctx.itens.map((i) => i.justificativa_glosas)),
    motivo_outros: juntarMotivos(ctx.itens.map((i) => i.justificativa_outros_descontos)),
    inss_base: soma((i) => i.vlr_mao_obra),
    inss_retido: soma((i) => i.inss),
    codigo_servico: (ctx.codigo_servico ?? "").trim(),
    cnae: (ctx.cnae ?? "").trim(),
    nbs: (ctx.nbs ?? "").trim(),
  };
}

const RE_VARIAVEL = /\{([a-z_]+)\}/g;

const vazio = (v: number | string) => (typeof v === "number" ? v === 0 : v === "");
const escrever = (v: number | string) => (typeof v === "number" ? fmtBRL(v) : v);

// Troca cada {variavel} pelo valor da nota. Regras:
// - variável que não existe fica como está (aparece pra analista corrigir);
// - linha em que TODAS as variáveis conhecidas estão vazias/zeradas some
//   inteira (ex.: "DESCONTO DE {faltas} REFERENTE A FALTAS" sem faltas);
// - linha mista mantém as demais e escreve R$ 0,00 / vazio nas zeradas.
export function preencherVariaveis(texto: string, ctx: ContextoDescricao): string {
  const valores = valoresDasVariaveis(ctx);
  const linhas = texto.split(/\r?\n/);
  const saida: string[] = [];
  for (const linha of linhas) {
    const usadas = [...linha.matchAll(RE_VARIAVEL)].map((m) => m[1]).filter((k) => k in valores);
    if (usadas.length > 0 && usadas.every((k) => vazio(valores[k]))) continue;
    saida.push(
      linha.replace(RE_VARIAVEL, (cru, k: string) => (k in valores ? escrever(valores[k]) : cru))
    );
  }
  return saida.join("\n");
}

export function temVariaveis(texto: string): boolean {
  return /\{[a-z_]+\}/.test(texto);
}
