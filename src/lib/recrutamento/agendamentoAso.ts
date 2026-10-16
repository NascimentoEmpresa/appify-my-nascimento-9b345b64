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
