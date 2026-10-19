// =====================================================================
// Recrutamento › SST + COMPRAS — o agendamento do ASO admissional como o
// Recrutamento precisa dele (16/10/2026). Com teste em
// src/test/recrutamento-agendamento-aso.test.ts.
//
// Pedido do Pablo: "toda vez que o SST agenda um aso o recrutamento tem que
// saber todas informações de agendamento pra passar pro colaborador. e tem
// que ter um botão pra copiar o link do mapa e tudo sobre o agendamento."
// O SST grava em WA_CURRICULOS (sst_data_exame, sst_hora_exame,
// sst_local_exame, sst_maps_url — ver src/pages/sst/AsoCandidatos.tsx);
// aqui só se lê e se monta o texto para colar no WhatsApp do candidato.
// =====================================================================

export interface AgendamentoAso {
  nome?: string | null;
  sst_ok?: boolean | null;
  sst_obs?: string | null;
  sst_visto_em?: string | null;
  sst_visto_por?: string | null;
  sst_data_exame?: string | null;
  sst_hora_exame?: string | null;
  sst_local_exame?: string | null;
  sst_maps_url?: string | null;
  sst_agendado_em?: string | null;
  sst_agendado_por?: string | null;
}

export type SituacaoSst = "A receber" | "Recebido — a agendar" | "Agendado" | "Reprovado pelo SST";

/** A mesma régua da tela do SST (AsoCandidatos.situacaoDe). */
export function situacaoSst(c: AgendamentoAso): SituacaoSst {
  if (c.sst_ok === false) return "Reprovado pelo SST";
  if (c.sst_agendado_em || c.sst_data_exame || c.sst_ok === true) return "Agendado";
  return c.sst_visto_em ? "Recebido — a agendar" : "A receber";
}

/** "2026-10-20" → "20/10/2026"; vazio → "". */
export const dataBr = (s?: string | null) => (!s ? "" : String(s).slice(0, 10).split("-").reverse().join("/"));

const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
/** Dia da semana da data do exame (sem fuso: a data é só AAAA-MM-DD). */
export function diaDaSemana(s?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ""));
  if (!m) return "";
  return DIAS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
}

/** O link do mapa: o que o SST colou; senão, uma busca pelo endereço. */
export function linkMapaAso(c: AgendamentoAso): string | null {
  const url = String(c.sst_maps_url ?? "").trim();
  if (url) return url;
  const local = String(c.sst_local_exame ?? "").trim();
  return local ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(local)}` : null;
}

/** "2026-10-19" + "11:00" → "19/10 (seg) · 11:00" — a linha curta do card. */
export function resumoAgendamentoAso(c: AgendamentoAso): string {
  if (!c.sst_data_exame) return "";
  const dia = diaDaSemana(c.sst_data_exame).slice(0, 3);
  return `${dataBr(c.sst_data_exame).slice(0, 5)}${dia ? ` (${dia})` : ""}${c.sst_hora_exame ? ` · ${c.sst_hora_exame}` : ""}`;
}

/** Nome do template da Meta do botão "Enviar agendamento" (mig 20261016000031). */
export const TEMPLATE_AGENDAMENTO_ASO = "recrutamento_agendamento_aso";

/**
 * Prévia do que o candidato vai receber pelo botão "Enviar agendamento": o
 * texto do template da Meta (mig 20261016000031) com as variáveis resolvidas
 * do mesmo jeito que a Edge recrutamento-mensagem (variável vazia vira "-").
 * Mostrada na confirmação antes de enviar.
 */
export function previaTemplateAgendamento(c: AgendamentoAso, cargo?: string | null): string {
  const primeiro = String(c.nome ?? "").trim().split(/\s+/)[0] ?? "";
  const nome = primeiro ? primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase() : "";
  const dia = diaDaSemana(c.sst_data_exame);
  const v = (s?: string | null) => String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim() || "-";
  return [
    `Olá ${v(nome)}! Seu exame admissional (ASO) para a vaga de ${v(cargo)} está agendado.`,
    "",
    `📅 Data: ${c.sst_data_exame ? `${dataBr(c.sst_data_exame)}${dia ? ` (${dia})` : ""}` : "-"}`,
    `⏰ Horário: ${v(c.sst_hora_exame)}`,
    `📍 Local: ${v(c.sst_local_exame)}`,
    `🗺 Mapa: ${v(linkMapaAso(c))}`,
    "",
    "Leve um documento oficial com foto. Qualquer dúvida, é só responder esta mensagem.",
  ].join("\n");
}

/**
 * Resposta da Edge recrutamento-mensagem (etapa AGENDAMENTO ASO) → o que dizer
 * ao recrutador. O caso que mais vai aparecer no começo é o template ainda não
 * aprovado na Meta (erro 132001): aí ensina onde mandar para aprovação e lembra
 * do "Copiar agendamento", que funciona já.
 */
export function mensagemEnvioAgendamento(
  r: { enviado?: boolean; motivo?: string; detalhe?: string } | null | undefined,
  nome?: string | null,
): { ok: boolean; texto: string } {
  const quem = String(nome ?? "").trim().split(/\s+/)[0] || "o candidato";
  if (r?.enviado) return { ok: true, texto: `Agendamento enviado no WhatsApp de ${quem}.` };
  switch (r?.motivo) {
    case "sem_agendamento": return { ok: false, texto: "O SST ainda não agendou o exame — não há o que enviar." };
    case "sem_telefone": return { ok: false, texto: `${quem} está sem telefone válido.` };
    case "sem_template": case "desligado":
      return { ok: false, texto: "A mensagem de agendamento não está configurada. Use \"Copiar agendamento\" por enquanto." };
    case "sem_conversa": return { ok: false, texto: `Não consegui abrir a conversa com ${quem}${r?.detalhe ? ` (${r.detalhe})` : ""}.` };
  }
  const detalhe = String(r?.detalhe ?? "");
  if (/132001|does not exist|template/i.test(detalhe)) {
    return {
      ok: false,
      texto: `O modelo "${TEMPLATE_AGENDAMENTO_ASO}" ainda não foi aprovado pela Meta. Em "Mensagens automáticas", clique em "Enviar textos para aprovação da Meta". Até lá, use "Copiar agendamento".`,
    };
  }
  return { ok: false, texto: `O WhatsApp não saiu${detalhe ? `: ${detalhe}` : ""}. Use "Copiar agendamento".` };
}

/** Texto pronto para mandar ao candidato. Sem agendamento → null. */
export function textoAgendamentoAso(c: AgendamentoAso): string | null {
  if (!c.sst_data_exame) return null;
  const primeiro = String(c.nome ?? "").trim().split(/\s+/)[0] ?? "";
  const nome = primeiro ? primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase() : "";
  const dia = diaDaSemana(c.sst_data_exame);
  const mapa = linkMapaAso(c);
  return [
    `Olá${nome ? `, ${nome}` : ""}! Seu exame admissional (ASO) está agendado:`,
    "",
    `📅 Data: ${dataBr(c.sst_data_exame)}${dia ? ` (${dia})` : ""}`,
    c.sst_hora_exame ? `⏰ Horário: ${c.sst_hora_exame}` : null,
    c.sst_local_exame ? `📍 Local: ${c.sst_local_exame}` : null,
    mapa ? `🗺 Mapa: ${mapa}` : null,
    c.sst_obs?.trim() ? `📝 Observação: ${c.sst_obs.trim()}` : null,
    "",
    "Leve um documento oficial com foto. Qualquer dúvida, é só responder esta mensagem.",
  ].filter((l): l is string => l !== null).join("\n");
}

// =====================================================================
// Card "ASOs Agendados" da Gestão Recrutamento (19/10/2026). Pablo: "Vai
// aparecer só as solicitações com os ASOs agendados e todos ASOs prontos pra
// copiar e colar ou pra enviar pros colaboradores." A lista vem da
// VW_RECRUTAMENTO_CANDIDATOS (o mesmo que o SST lê em AsoCandidatos); aqui
// fica só a régua de quem entra, o agrupamento por solicitação e o texto do
// "Copiar todos". Componente: src/components/recrutamento/AsosAgendados.tsx.
// =====================================================================

/** Linha da VW_RECRUTAMENTO_CANDIDATOS que o card usa. */
export interface AsoAgendadoLinha extends AgendamentoAso {
  candidato_id: number;
  vaga_id: number;
  telefone?: string | null;
  cpf?: string | null;
  cargo?: string | null;
  contrato?: string | null;
  cidade?: string | null;
  etapa_processo?: string | null;
  desistiu?: boolean | null;
  admitido_em?: string | null;
}

/** Hoje em São Paulo, "AAAA-MM-DD" (a data do exame não tem fuso). */
export const hojeSp = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

/**
 * Entra no card quem tem exame marcado e ainda vai fazê-lo: sem desistência,
 * sem reprovação (do SST ou do processo) e ainda não admitido. `proximos`
 * deixa só de hoje em diante; senão, também os que já passaram.
 */
export function asoEstaAgendado(c: AsoAgendadoLinha, hoje: string, proximos = true): boolean {
  if (!c.sst_data_exame) return false;
  if (c.desistiu || c.sst_ok === false || c.admitido_em) return false;
  if (/reprovad/i.test(String(c.etapa_processo ?? ""))) return false;
  return !proximos || String(c.sst_data_exame).slice(0, 10) >= hoje;
}

/** Data + hora para ordenar ("" no fim de cada dia). */
const chaveAso = (c: AsoAgendadoLinha) => `${String(c.sst_data_exame ?? "").slice(0, 10)} ${c.sst_hora_exame || "99:99"}`;

export interface SolicitacaoComAsos {
  vaga_id: number;
  cargo: string;
  contrato: string;
  cidade: string;
  asos: AsoAgendadoLinha[];
}

/**
 * Agrupa por solicitação (vaga), cada uma com os ASOs em ordem de data/hora;
 * as solicitações saem na ordem do exame mais próximo.
 */
export function agruparAsosPorSolicitacao(linhas: AsoAgendadoLinha[]): SolicitacaoComAsos[] {
  const mapa = new Map<number, SolicitacaoComAsos>();
  for (const c of linhas) {
    let g = mapa.get(c.vaga_id);
    if (!g) {
      g = { vaga_id: c.vaga_id, cargo: c.cargo ?? "", contrato: c.contrato ?? "", cidade: c.cidade ?? "", asos: [] };
      mapa.set(c.vaga_id, g);
    }
    g.asos.push(c);
  }
  const grupos = [...mapa.values()];
  grupos.forEach((g) => g.asos.sort((a, b) => chaveAso(a).localeCompare(chaveAso(b))));
  return grupos.sort((a, b) => chaveAso(a.asos[0]).localeCompare(chaveAso(b.asos[0])) || a.vaga_id - b.vaga_id);
}

/** Busca do card: nome, CPF, telefone, cargo, contrato, cidade, local ou nº da vaga. */
export function asoCasaBusca(c: AsoAgendadoLinha, busca: string): boolean {
  const q = busca.trim().toLowerCase();
  if (!q) return true;
  const dig = q.replace(/\D/g, "");
  if (dig && (String(c.vaga_id) === dig || String(c.cpf ?? "").replace(/\D/g, "").includes(dig)
    || String(c.telefone ?? "").replace(/\D/g, "").includes(dig))) return true;
  return [c.nome, c.cargo, c.contrato, c.cidade, c.sst_local_exame]
    .some((s) => String(s ?? "").toLowerCase().includes(q));
}

/**
 * "Copiar todos": um bloco por solicitação com, para cada candidato, nome,
 * telefone e o mesmo texto do "Copiar" individual — para colar num grupo ou
 * repassar de uma vez.
 */
export function textoTodosAsos(grupos: SolicitacaoComAsos[]): string {
  const blocos: string[] = [];
  for (const g of grupos) {
    const titulo = [`#${g.vaga_id}`, g.cargo, g.contrato, g.cidade].filter((s) => String(s).trim()).join(" · ");
    const itens = g.asos
      .map((c) => {
        const texto = textoAgendamentoAso(c);
        if (!texto) return null;
        const quem = [String(c.nome ?? "").trim() || "Candidato", String(c.telefone ?? "").trim()].filter(Boolean).join(" · ");
        return `👤 ${quem}\n${texto}`;
      })
      .filter((s): s is string => !!s);
    if (itens.length) blocos.push(`*${titulo}*\n\n${itens.join("\n\n")}`);
  }
  return blocos.join("\n\n──────────\n\n");
}
