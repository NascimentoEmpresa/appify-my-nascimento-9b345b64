import { montarEmail, type Faixa, type PlanoContrato } from "../../../supabase/functions/_shared/cobranca-automatica";

// SIS-2026-0653: regras puras das abas "Modelos de e-mail" e "Destinatários" da tela Cobranças.

// ── Modelos ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const MODELOS_COBRANCA: { codigo: string; faixa: Faixa; rotulo: string }[] = [
  { codigo: "cobranca_auto_aviso", faixa: "aviso", rotulo: "Aviso amigável (pré-vencimento)" },
  { codigo: "cobranca_auto_verde", faixa: "verde", rotulo: "Faixa verde (até 15 dias)" },
  { codigo: "cobranca_auto_amarela", faixa: "amarela", rotulo: "Faixa amarela (16 a 30 dias)" },
  { codigo: "cobranca_auto_laranja", faixa: "laranja", rotulo: "Faixa laranja (Anexo I administrativo)" },
  { codigo: "cobranca_auto_vermelha", faixa: "vermelha", rotulo: "Faixa vermelha (Anexo III administrativo)" },
];

// As mesmas variáveis de variaveisDoEmail() (supabase/functions/_shared/cobranca-automatica.ts).
export const VARIAVEIS_MODELO: { nome: string; descricao: string }[] = [
  { nome: "cliente", descricao: "Nome do contrato / órgão" },
  { nome: "lista_html", descricao: "Lista das notas em aberto (número, emissão, competência e valor)" },
  { nome: "valor_total", descricao: "Soma das notas em aberto" },
  { nome: "dias_max", descricao: "Dias de atraso da nota mais antiga" },
  { nome: "data_lim", descricao: "Data limite para regularizar (hoje + 5 dias)" },
  { nome: "ass_emp", descricao: "Razão social da empresa emitente" },
  { nome: "t_nota", descricao: "“à Nota Fiscal” ou “às Notas Fiscais”" },
  { nome: "t_da_nota", descricao: "“da Nota Fiscal” ou “das Notas Fiscais”" },
  { nome: "t_num", descricao: "“ nº 123” (1 nota) ou “ detalhadas abaixo”" },
  { nome: "t_comp", descricao: "Período de competência (só com 1 nota)" },
  { nome: "t_emi", descricao: "“emitida pela empresa …”" },
  { nome: "t_venc", descricao: "Vencimento programado (só com 1 nota)" },
  { nome: "t_com_venc", descricao: "Data de emissão (só com 1 nota)" },
];

export function variaveisDesconhecidas(texto: string | null | undefined): string[] {
  const conhecidas = new Set(VARIAVEIS_MODELO.map((v) => v.nome));
  const achadas = new Set<string>();
  for (const m of (texto ?? "").matchAll(/\{\{(\w+)\}\}/g)) if (!conhecidas.has(m[1])) achadas.add(m[1]);
  return [...achadas];
}

/** Chaves com espaço ({{ nome }}) não são trocadas pelo envio: o texto sairia com a chave crua no e-mail do cliente. */
export function chavesComEspaco(texto: string | null | undefined): string[] {
  return [...new Set([...(texto ?? "").matchAll(/\{\{(?:\s+\w+\s*|\w+\s+)\}\}/g)].map((m) => m[0]))];
}

export interface ProblemaModelo {
  bloqueia: boolean;
  texto: string;
}

export function validarModelo(assunto: string, corpo: string): ProblemaModelo[] {
  const p: ProblemaModelo[] = [];
  if (!assunto.trim()) p.push({ bloqueia: true, texto: "O assunto não pode ficar vazio." });
  if (!corpo.trim()) p.push({ bloqueia: true, texto: "O corpo do e-mail não pode ficar vazio." });
  if (!/\{\{lista_html\}\}/.test(corpo)) {
    p.push({ bloqueia: true, texto: "O corpo precisa conter {{lista_html}}: é ela que lista as notas cobradas. Sem ela o cliente recebe uma cobrança sem nota." });
  }
  const espaco = [...chavesComEspaco(assunto), ...chavesComEspaco(corpo)];
  if (espaco.length) p.push({ bloqueia: true, texto: `Variável com espaço dentro das chaves (${espaco.join(", ")}): escreva sem espaço, como {{cliente}}.` });
  const desconhecidas = [...variaveisDesconhecidas(assunto), ...variaveisDesconhecidas(corpo)];
  if (desconhecidas.length) {
    p.push({ bloqueia: true, texto: `Variável desconhecida: ${[...new Set(desconhecidas)].map((v) => `{{${v}}}`).join(", ")}. Ela sairia em branco no e-mail.` });
  }
  return p;
}

/** Prévia com dados de exemplo (mesma montagem do envio real). */
export function previaDoModelo(faixa: Faixa, assunto: string, corpo: string, assinaturaHtml: string, nNotas: 1 | 2 = 2): { assunto: string; corpo: string } {
  const notas = [
    { id: "1", numero: "1234", contratoId: "x", dataEmissao: "2026-09-10", competencia: "2026-08-01", valor: 18450.9 },
    { id: "2", numero: "1301", contratoId: "x", dataEmissao: "2026-09-24", competencia: "2026-09-01", valor: 17230.15 },
  ].slice(0, nNotas);
  const plano: PlanoContrato = {
    contratoId: "x",
    contrato: "ÓRGÃO EXEMPLO - 000/2026",
    empresaCodigo: "HAGG",
    faixa,
    diasMax: 20,
    notas,
    valorTotal: notas.reduce((s, n) => s + n.valor, 0),
    decisao: "enviar",
    motivo: "",
    destinatarios: [],
    ultimoEnvio: null,
    proximoEnvio: null,
  };
  return montarEmail(plano, { assunto, corpo }, "2026-10-26", assinaturaHtml);
}

// ── Destinatários ─────────────────────────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]{2,}$/;

export function emailValido(e: string): boolean {
  return EMAIL_RE.test(e.trim());
}

/** Aceita vários e-mails colados (separados por ; , espaço ou quebra de linha). Devolve válidos únicos e os recusados. */
export function lerEmails(texto: string): { validos: string[]; invalidos: string[] } {
  const vistos = new Set<string>();
  const validos: string[] = [];
  const invalidos: string[] = [];
  for (const bruto of texto.split(/[;,\s]+/)) {
    const e = bruto.trim();
    if (!e) continue;
    if (!emailValido(e)) {
      invalidos.push(e);
      continue;
    }
    const k = e.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    validos.push(e);
  }
  return { validos, invalidos };
}

export function semDuplicados(novos: string[], existentes: string[]): { adicionar: string[]; jaExistiam: string[] } {
  const tem = new Set(existentes.map((e) => e.trim().toLowerCase()));
  const adicionar: string[] = [];
  const jaExistiam: string[] = [];
  for (const e of novos) (tem.has(e.trim().toLowerCase()) ? jaExistiam : adicionar).push(e);
  return { adicionar, jaExistiam };
}
