// SIS-2026-0653: regras da cobrança automática. Funções puras (sem banco, sem rede, sem Deno.*): a edge function
// `cobranca-automatica` e os testes importam daqui. Porta, do sistema de cobranças antigo (Flask, main.py), a régua de
// faixas, a escolha do modelo pela maior faixa do contrato e a montagem dos textos.
//
// REGRA QUE NÃO PODE QUEBRAR: o automático só envia faixas do Financeiro (aviso, verde, amarela, laranja e vermelha
// administrativas). Contrato cuja nota mais atrasada já está na faixa roxa ou preta fica FORA do envio automático, por
// inteiro: o Jurídico analisa o histórico e envia à mão. Isso vale mesmo que o contrato nunca tenha recebido a 1ª
// cobrança; o sistema não presume etapa cumprida nem "recupera" etapa anterior.

export type Faixa = "aviso" | "verde" | "amarela" | "laranja" | "vermelha" | "roxa" | "preta";

export const ORDEM_FAIXAS: Faixa[] = ["aviso", "verde", "amarela", "laranja", "vermelha", "roxa", "preta"];

// Faixas que a rotina pode enviar sozinha. Roxa e preta ficam de fora de propósito, sem configuração que as inclua.
export const FAIXAS_AUTOMATICAS: readonly Faixa[] = ["aviso", "verde", "amarela", "laranja", "vermelha"];

export const PRAZO_PAGAMENTO_DIAS = 30; // a empresa dá 30 dias depois da emissão; só depois a nota está vencida

export const ROTULO_FAIXA: Record<Faixa, string> = {
  aviso: "Aviso amigável (pré-vencimento)",
  verde: "Faixa verde (até 15 dias)",
  amarela: "Faixa amarela (16 a 30 dias)",
  laranja: "Faixa laranja (31 a 60 dias)",
  vermelha: "Faixa vermelha (61 a 90 dias)",
  roxa: "Faixa roxa (91 a 120 dias)",
  preta: "Faixa preta (+120 dias)",
};

// Código do modelo (template_mensagem.codigo) de cada faixa automática. Roxa/preta não têm modelo aqui.
export const TEMPLATE_DA_FAIXA: Record<string, string> = {
  aviso: "cobranca_auto_aviso",
  verde: "cobranca_auto_verde",
  amarela: "cobranca_auto_amarela",
  laranja: "cobranca_auto_laranja",
  vermelha: "cobranca_auto_vermelha",
};

// Mesmo mapa do sistema antigo (main.py, rz_map): a razão social que sai no texto da cobrança.
export const RAZAO_SOCIAL_POR_EMPRESA: Record<string, string> = {
  SN: "SN Serviços de Limpeza e Zeladoria Predial Ltda",
  HAGG: "Nascimento Serviços de Limpeza Ltda",
  NH: "NH Prestação de Serviços Ltda",
  "CANAÃ": "INSTITUTO DE ENSINO CANAA",
  CANAA: "INSTITUTO DE ENSINO CANAA",
};

export const CC_SEM_COPIA_NO_AVISO: Faixa = "aviso";

/** Faixa pelos dias corridos desde a emissão (atraso real = dias − 30). Mesma régua do `definir_parecer` do Flask. */
export function faixaDeDias(diasDesdeEmissao: number): Faixa {
  const atraso = diasDesdeEmissao - PRAZO_PAGAMENTO_DIAS;
  if (atraso <= 0) return "aviso";
  if (atraso <= 15) return "verde";
  if (atraso <= 30) return "amarela";
  if (atraso <= 60) return "laranja";
  if (atraso <= 90) return "vermelha";
  if (atraso <= 120) return "roxa";
  return "preta";
}

export function ehFaixaAutomatica(f: Faixa): boolean {
  return FAIXAS_AUTOMATICAS.includes(f);
}

export function maiorFaixa(faixas: Faixa[]): Faixa | null {
  let maior: Faixa | null = null;
  for (const f of faixas) if (maior === null || ORDEM_FAIXAS.indexOf(f) > ORDEM_FAIXAS.indexOf(maior)) maior = f;
  return maior;
}

// ── Datas (sempre no calendário de São Paulo; a edge function roda em UTC) ─────────────────────────────────────────

/** "YYYY-MM-DD" do dia de São Paulo. */
export function hojeEmSaoPaulo(agora: Date): string {
  return agora.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

function diaParaMs(iso: string): number {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

export function diasEntre(inicioIso: string, fimIso: string): number {
  return Math.floor((diaParaMs(fimIso) - diaParaMs(inicioIso)) / 86_400_000);
}

export function somarDias(iso: string, dias: number): string {
  const d = new Date(diaParaMs(iso) + dias * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const competenciaCurta = (iso: string | null) => (iso ? `${MESES[Number(iso.slice(5, 7)) - 1] ?? "?"}/${iso.slice(2, 4)}` : "");
export const moeda = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

export interface JanelaEnvio {
  somente_dias_uteis: boolean;
  hora_inicio: number; // inclusive, hora de Brasília
  hora_fim: number; // exclusivo
}

/** Dia útil (seg–sex) e hora de Brasília dentro da janela. Feriado não é tratado: o Financeiro pausa pelo modo. */
export function dentroDaJanela(agora: Date, j: JanelaEnvio): boolean {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(agora);
  const dia = partes.find((p) => p.type === "weekday")?.value ?? "";
  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? "0");
  if (j.somente_dias_uteis && (dia === "Sat" || dia === "Sun")) return false;
  return hora >= j.hora_inicio && hora < j.hora_fim;
}

// ── Planejamento ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface NotaAberta {
  id: string;
  numero: string;
  contratoId: string;
  dataEmissao: string; // YYYY-MM-DD
  competencia: string | null;
  valor: number;
}

export interface ContratoInfo {
  id: string;
  nome: string;
  empresaCodigo: string;
}

export interface EnvioAnterior {
  contratoId: string;
  faixa: string;
  enviadoEm: string; // ISO
}

export interface ConfigCobranca {
  // dias entre reenvios dentro da mesma faixa; 0 = não repete (só o primeiro)
  intervalo_dias: Record<string, number>;
  // quantos dias antes do vencimento o aviso amigável passa a sair
  aviso_dias_antes: number;
}

export type Decisao = "enviar" | "aguardar" | "judicial" | "manual" | "sem_destinatario";

export interface PlanoContrato {
  contratoId: string;
  contrato: string;
  empresaCodigo: string;
  faixa: Faixa;
  diasMax: number;
  notas: NotaAberta[];
  valorTotal: number;
  decisao: Decisao;
  motivo: string;
  destinatarios: string[];
  ultimoEnvio: string | null;
  proximoEnvio: string | null;
}

export interface EntradaPlano {
  notas: NotaAberta[];
  contratos: Map<string, ContratoInfo>;
  emailsPorContrato: Map<string, string[]>;
  contratosSoManual: Set<string>;
  enviosAnteriores: EnvioAnterior[];
  config: ConfigCobranca;
  agora: Date;
}

export function planejarCobrancas(e: EntradaPlano): PlanoContrato[] {
  const hoje = hojeEmSaoPaulo(e.agora);
  const diasDe = (n: NotaAberta) => diasEntre(n.dataEmissao, hoje);

  // Só entra na cobrança a nota que já chegou na janela do aviso (a partir de `aviso_dias_antes` antes do vencimento).
  const limiteDias = PRAZO_PAGAMENTO_DIAS - e.config.aviso_dias_antes;
  const porContrato = new Map<string, NotaAberta[]>();
  for (const n of e.notas) {
    if (diasDe(n) < limiteDias) continue;
    const arr = porContrato.get(n.contratoId) ?? [];
    arr.push(n);
    porContrato.set(n.contratoId, arr);
  }

  const planos: PlanoContrato[] = [];
  for (const [contratoId, notas] of porContrato) {
    const info = e.contratos.get(contratoId);
    const ordenadas = [...notas].sort((a, b) => a.dataEmissao.localeCompare(b.dataEmissao) || a.numero.localeCompare(b.numero));
    const diasMax = Math.max(...ordenadas.map(diasDe));
    // A maior faixa do contrato é a da nota mais atrasada (mesma escolha do Flask: o modelo segue a maior severidade).
    const faixa = maiorFaixa(ordenadas.map((n) => faixaDeDias(diasDe(n)))) as Faixa;
    const destinatarios = e.emailsPorContrato.get(contratoId) ?? [];
    const doContrato = e.enviosAnteriores.filter((x) => x.contratoId === contratoId);
    const ultimoDaFaixa = doContrato.filter((x) => x.faixa === faixa).map((x) => x.enviadoEm).sort().pop() ?? null;

    const base = {
      contratoId,
      contrato: info?.nome ?? "(contrato não encontrado)",
      empresaCodigo: info?.empresaCodigo ?? "",
      faixa,
      diasMax,
      notas: ordenadas,
      valorTotal: Math.round(ordenadas.reduce((s, n) => s + n.valor, 0) * 100) / 100,
      destinatarios,
      ultimoEnvio: ultimoDaFaixa,
      proximoEnvio: null as string | null,
    };

    // 1) Judicial/roxa e acima: nunca automático, e nada de e-mail "atrasado" das faixas anteriores.
    if (!ehFaixaAutomatica(faixa)) {
      planos.push({ ...base, decisao: "judicial", motivo: `${ROTULO_FAIXA[faixa]}: envio exclusivamente manual pelo Jurídico.` });
      continue;
    }
    // 2) Contrato marcado como "só manual" pelo Financeiro/Jurídico.
    if (e.contratosSoManual.has(contratoId)) {
      planos.push({ ...base, decisao: "manual", motivo: "Contrato marcado para cobrança somente manual." });
      continue;
    }
    // 3) Sem e-mail do tomador cadastrado não há para quem enviar.
    if (destinatarios.length === 0) {
      planos.push({ ...base, decisao: "sem_destinatario", motivo: "Nenhum e-mail do tomador cadastrado para este contrato." });
      continue;
    }
    // 4) Cadência: 1º envio ao entrar na faixa; depois só se houver intervalo > 0 e ele já passou.
    const intervalo = e.config.intervalo_dias[faixa] ?? 0;
    if (ultimoDaFaixa === null) {
      planos.push({ ...base, decisao: "enviar", motivo: `Primeira cobrança desta faixa (${ROTULO_FAIXA[faixa]}).` });
      continue;
    }
    const diasDesdeUltimo = diasEntre(ultimoDaFaixa.slice(0, 10), hoje);
    if (intervalo > 0 && diasDesdeUltimo >= intervalo) {
      planos.push({ ...base, decisao: "enviar", motivo: `Reenvio: último e-mail desta faixa há ${diasDesdeUltimo} dia(s) (intervalo de ${intervalo}).` });
    } else {
      const proximo = intervalo > 0 ? somarDias(ultimoDaFaixa.slice(0, 10), intervalo) : null;
      planos.push({
        ...base,
        decisao: "aguardar",
        proximoEnvio: proximo,
        motivo: intervalo > 0 ? `Já cobrado nesta faixa em ${dataBr(ultimoDaFaixa)}; próximo em ${dataBr(proximo as string)}.` : `Já cobrado nesta faixa em ${dataBr(ultimoDaFaixa)}; esta faixa não repete.`,
      });
    }
  }

  const peso: Record<Decisao, number> = { enviar: 0, sem_destinatario: 1, judicial: 2, manual: 3, aguardar: 4 };
  return planos.sort((a, b) => peso[a.decisao] - peso[b.decisao] || ORDEM_FAIXAS.indexOf(b.faixa) - ORDEM_FAIXAS.indexOf(a.faixa) || a.contrato.localeCompare(b.contrato, "pt-BR"));
}

// ── Texto do e-mail ───────────────────────────────────────────────────────────────────────────────────────────────

export function renderizar(texto: string | null, vars: Record<string, string>): string {
  if (!texto) return "";
  return texto.replace(/\{\{(\w+)\}\}/g, (_, chave) => vars[chave] ?? "");
}

/** Variáveis dos modelos: as mesmas do Flask (t_nota, lista_html, ...), agora no formato {{variavel}}. */
export function variaveisDoEmail(p: PlanoContrato, hoje: string): Record<string, string> {
  const qtd = p.notas.length;
  const primeira = p.notas[0];
  const razao = RAZAO_SOCIAL_POR_EMPRESA[p.empresaCodigo.toUpperCase()] ?? `${p.empresaCodigo} - GRUPO NASCIMENTO`;
  const lista = p.notas
    .map((n) => `<li>Nota <b>${n.numero}</b> (Emissão: ${dataBr(n.dataEmissao)}${n.competencia ? ` - Comp: ${competenciaCurta(n.competencia)}` : ""}) - ${moeda(n.valor)}</li>`)
    .join("");
  // Vencimento real = emissão + 30 dias. (O sistema antigo escrevia a data de EMISSÃO como "vencimento programado".)
  const venc = primeira ? dataBr(somarDias(primeira.dataEmissao, PRAZO_PAGAMENTO_DIAS)) : "";
  return {
    cliente: p.contrato,
    lista_html: `<ul>${lista}</ul>`,
    valor_total: moeda(p.valorTotal),
    dias_max: String(p.diasMax),
    data_lim: dataBr(somarDias(hoje, 5)),
    ass_emp: razao,
    t_nota: qtd === 1 ? "à Nota Fiscal" : "às Notas Fiscais",
    t_da_nota: qtd === 1 ? "da Nota Fiscal" : "das Notas Fiscais",
    t_num: qtd === 1 ? ` nº ${primeira.numero}` : " detalhadas abaixo",
    t_comp: qtd === 1 && primeira.competencia ? ` relativas aos serviços prestados no período de ${competenciaCurta(primeira.competencia)},` : "",
    t_emi: qtd === 1 ? `emitida pela empresa <b>${razao}</b>,` : `emitidas pela empresa <b>${razao}</b>,`,
    t_venc: qtd === 1 ? ` cujo vencimento está programado para o dia ${venc},` : "",
    t_com_venc: qtd === 1 ? ` com emissão em ${dataBr(primeira.dataEmissao)},` : "",
  };
}

export interface ModeloEmail {
  assunto: string | null;
  corpo: string;
}

export function montarEmail(p: PlanoContrato, modelo: ModeloEmail, hoje: string, assinaturaHtml = ""): { assunto: string; corpo: string } {
  const vars = variaveisDoEmail(p, hoje);
  const nfs = p.notas.map((n) => n.numero).join(", ");
  const assunto = `${renderizar(modelo.assunto, vars)} (NFs: ${nfs})`;
  const corpo = `<div style="font-family:Calibri; font-size:11pt;">${renderizar(modelo.corpo, vars)}</div>${assinaturaHtml}`;
  return { assunto, corpo };
}

/** Cópia do e-mail: a Gerência Operacional vai em todas, menos no aviso amigável (regra do sistema antigo). */
export function copiaDoEmail(faixa: Faixa, ccFixo: string[]): string[] {
  return faixa === CC_SEM_COPIA_NO_AVISO ? [] : [...new Set(ccFixo.map((e) => e.trim()).filter(Boolean))];
}

/** Última barreira antes de enviar: nunca deixa passar faixa judicial, mesmo que o plano venha errado. */
export function garantirEnvioPermitido(faixa: Faixa): void {
  if (!ehFaixaAutomatica(faixa)) throw new Error(`Faixa "${faixa}" não pode ser enviada automaticamente (envio exclusivo do Jurídico).`);
}
