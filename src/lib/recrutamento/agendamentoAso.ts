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
