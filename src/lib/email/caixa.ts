/**
 * Regras das caixas de e-mail do ERP — sem React, para dar para testar
 * (src/test/fornecedorEmail.test.ts e src/test/emailModulo.test.ts).
 *
 * Usadas pela caixa de Fornecedores (Suprimentos) e pelo módulo E-mail
 * (/app/email). O envio de verdade e a validação final ficam nas Edges
 * (_shared/caixa-email.ts); aqui é o que a tela precisa para montar os chips
 * de destinatário, sugerir endereços e avisar antes de mandar.
 *
 * "Dono" de um endereço = quem ele representa na sugestão: o fornecedor, o
 * colega do ERP etc. (era fornecedorId/fornecedorNome até virar genérico,
 * 06/11/2026).
 */

export const MAX_DESTINATARIOS = 50;
export const MAX_ANEXOS_BYTES = 20 * 1024 * 1024;

const RE_EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export function emailValido(v: string): boolean {
  return RE_EMAIL.test(v.trim());
}

/**
 * Quebra o que a pessoa colou/digitou em endereços: aceita vírgula, ponto e
 * vírgula, espaço e quebra de linha, e o formato "Nome <a@b>" do Outlook.
 */
export function separarEnderecos(texto: string): string[] {
  const saida: string[] = [];
  for (const parte of texto.split(/[,;\n\r\t]+/)) {
    const bruto = parte.trim();
    if (!bruto) continue;
    const m = bruto.match(/<([^>]+)>/);
    const pedacos = m ? [m[1]] : bruto.split(/\s+/);
    for (const p of pedacos) {
      const e = p.trim().toLowerCase();
      if (e && !saida.includes(e)) saida.push(e);
    }
  }
  return saida;
}

export interface SugestaoEndereco {
  email: string;
  donoId: string;
  donoNome: string;
  /** "Principal", "Financeiro", "Colega", "Fornecedor · principal"… */
  rotulo: string;
}

/** Linha de `email_contatos()` (módulo E-mail). */
export interface ContatoEmail {
  email: string;
  nome: string | null;
  origem: string;
  ref_id: string | null;
}

/**
 * Contatos do banco → sugestões. Sem nome (endereço que a pessoa já usou),
 * o dono é o próprio endereço. Um endereço que é colega E fornecedor aparece
 * uma vez por origem, como vem do banco.
 */
export function sugestoesDosContatos(lista: ContatoEmail[]): SugestaoEndereco[] {
  const vistos = new Set<string>();
  const saida: SugestaoEndereco[] = [];
  for (const c of lista) {
    const email = (c.email ?? "").trim().toLowerCase();
    if (!emailValido(email)) continue;
    // "Enviado antes" só entra se o endereço não veio com nome por outra origem.
    const chave = `${email}|${c.origem}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push({ email, donoId: c.ref_id ?? email, donoNome: c.nome?.trim() || email, rotulo: c.origem });
  }
  const comNome = new Set(saida.filter((s) => s.rotulo !== "Enviado antes").map((s) => s.email));
  return saida.filter((s) => s.rotulo !== "Enviado antes" || !comNome.has(s.email));
}

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Sugestões para o que está sendo digitado num campo Para/Cc/Cco. */
export function filtrarSugestoes(
  todas: SugestaoEndereco[],
  termo: string,
  jaEscolhidos: string[],
  limite = 8,
): SugestaoEndereco[] {
  const t = semAcento(termo.trim());
  if (!t) return [];
  const usados = new Set(jaEscolhidos.map((e) => e.toLowerCase()));
  const comeca: SugestaoEndereco[] = [];
  const contem: SugestaoEndereco[] = [];
  for (const s of todas) {
    if (usados.has(s.email)) continue;
    const email = s.email;
    const nome = semAcento(s.donoNome);
    if (email.startsWith(t) || nome.startsWith(t)) comeca.push(s);
    else if (email.includes(t) || nome.includes(t)) contem.push(s);
    if (comeca.length >= limite) break;
  }
  return [...comeca, ...contem].slice(0, limite);
}

/** Fornecedores ligados à mensagem: os donos dos endereços em Para/Cc/Cco. */
export function donosDosEnderecos(todas: SugestaoEndereco[], enderecos: string[]): string[] {
  const alvo = new Set(enderecos.map((e) => e.toLowerCase()));
  const ids: string[] = [];
  for (const s of todas) if (alvo.has(s.email) && !ids.includes(s.donoId)) ids.push(s.donoId);
  return ids;
}

export interface ProblemaEnvio { campo: "para" | "cc" | "cco" | "assunto" | "anexos" | "corpo"; mensagem: string }

/** O que impede (ou deveria fazer pensar) antes de enviar. */
export function conferirAntesDeEnviar(m: {
  para: string[]; cc: string[]; cco: string[]; assunto: string; corpoTexto: string; anexosBytes: number;
}): ProblemaEnvio[] {
  const p: ProblemaEnvio[] = [];
  if (m.para.length === 0) p.push({ campo: "para", mensagem: "Informe ao menos um destinatário em Para." });
  for (const [campo, lista] of [["para", m.para], ["cc", m.cc], ["cco", m.cco]] as const) {
    const ruins = lista.filter((e) => !emailValido(e));
    if (ruins.length) p.push({ campo, mensagem: `Endereço inválido: ${ruins.join(", ")}` });
  }
  const total = new Set([...m.para, ...m.cc, ...m.cco]).size;
  if (total > MAX_DESTINATARIOS) p.push({ campo: "para", mensagem: `No máximo ${MAX_DESTINATARIOS} destinatários por mensagem.` });
  if (!m.assunto.trim()) p.push({ campo: "assunto", mensagem: "Informe o assunto." });
  if (m.anexosBytes > MAX_ANEXOS_BYTES) p.push({ campo: "anexos", mensagem: "Os anexos passam de 20 MB somados." });
  return p;
}

/** A mensagem fala em anexo mas não tem nenhum — o aviso clássico do Gmail. */
export function esqueceuAnexo(assunto: string, corpoTexto: string, qtdAnexos: number): boolean {
  if (qtdAnexos > 0) return false;
  return /\b(anexo|anexa|anexad[oa]s?|em anexo|segue[m]? (o|a|os|as) (arquivo|planilha|pdf|documento|cota[cç][aã]o|pedido))\b/i
    .test(semAcento(`${assunto} ${corpoTexto}`));
}

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** Data na lista: hora se for hoje, "5 de nov." se for este ano, senão dd/mm/aa. */
export function dataCurta(iso: string, agora = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === agora.toDateString()) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  if (d.getFullYear() === agora.getFullYear()) {
    return d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function textoDoHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6])>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Nome seguro para o caminho no Storage (sem barra, acento ou espaço). */
export function nomeArquivoSeguro(nome: string): string {
  const limpo = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_");
  return limpo.slice(-120) || "arquivo";
}

function escaparHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Bloco citado do "Encaminhar", como o Gmail monta. */
export function corpoEncaminhado(m: {
  de_nome: string | null; de_email: string | null; enviado_em: string | null;
  assunto: string; para: string[]; cc: string[]; corpo_html: string;
}): string {
  const quando = m.enviado_em ? new Date(m.enviado_em).toLocaleString("pt-BR") : "";
  const de = `${escaparHtml(m.de_nome ?? "")} &lt;${escaparHtml(m.de_email ?? "")}&gt;`;
  return `<p><br></p><p>---------- Mensagem encaminhada ---------<br>`
    + `De: ${de}<br>Data: ${escaparHtml(quando)}<br>Assunto: ${escaparHtml(m.assunto)}<br>`
    + `Para: ${escaparHtml(m.para.join(", "))}`
    + (m.cc.length ? `<br>Cc: ${escaparHtml(m.cc.join(", "))}` : "")
    + `</p><br>${m.corpo_html}`;
}
