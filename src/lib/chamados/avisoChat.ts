// =====================================================================
// CHAMADOS — tradução dos avisos do histórico para a linha do chat
//
// Saiu de ChatChamado.tsx no SIS-2026-0923 (16/11/2026) sem mudar a regra:
// o Acompanhamento de Chamados da Presidência mostra a mesma conversa (só
// leitura) e precisa da mesma tradução — uma regra só, nos dois lugares.
// =====================================================================
import type { Evento } from "@/pages/chamados/types";
import { fraseEventoReabertura } from "@/lib/chamados/reabertura";

// ---- Aviso do sistema x mensagem de gente ---------------------------
// Só mensagem de verdade ganha balão com nome em cima. O resto — mudança de
// status, direcionamento, log de robô — é linha de aviso no meio da conversa,
// escrita em português de gente e já com QUEM fez a ação dentro da frase
// ("Iury designou o chamado para Pablo"), que é como o WhatsApp faz.
//
// O texto vem gravado no banco desde sempre, então a tradução acontece aqui na
// leitura: assim as conversas antigas também ficam legíveis, sem migrar dados.
export interface Aviso { texto: string; interno: boolean }

export function descreverAviso(e: Evento, nomeDe: (uid: string | null) => string): Aviso | null {
  const meta = (e.meta ?? {}) as Record<string, unknown>;
  const t = (e.texto ?? "").trim();

  // Log de robô: gravado como observação interna, mas não é alguém falando.
  if (meta.canal === "whatsapp") {
    const para = meta.destinatario_id ? nomeDe(String(meta.destinatario_id)) : null;
    return {
      interno: true,
      texto: meta.sucesso === false
        ? `Falha ao enviar a notificação por WhatsApp${para ? ` para ${para}` : ""}`
        : `Notificação enviada por WhatsApp${para ? ` para ${para}` : ""}`,
    };
  }
  if (e.tipo !== "evento") return null;

  const quem = nomeDe(e.autor_id);
  const frase = (() => {
    let m: RegExpMatchArray | null;
    if (/^Chamado aberto$/i.test(t)) return `${quem} abriu o chamado`;
    if (/^Chamado conclu[ií]do$/i.test(t)) return `${quem} concluiu o chamado`;
    // Confirmação do solicitante (mig 20261028001300).
    if (/^Conclus[ãa]o confirmada pelo solicitante$/i.test(t)) return `${quem} confirmou a conclusão do chamado`;
    // Início do desenvolvimento / prazo (mig 20261028001400).
    if ((m = t.match(/^Desenvolvimento iniciado — (.+)$/i))) return `${quem} começou o desenvolvimento — ${m[1]}`;
    // Prazo em dias, travado (SIS-2026-0763, mig 20261028001410).
    if ((m = t.match(/^Prazo definido:\s*(.+)$/i))) return `${quem} definiu o prazo: ${m[1]}`;
    // Reunião ou Extra (mig 20261028001700).
    if ((m = t.match(/^Defini[çc][ãa]o da prioridade:\s*(.+)$/i))) return `${quem} registrou a prioridade como definida em ${m[1]}`;
    if ((m = t.match(/^Prazo redefinido para\s+(.+)$/i))) return `${quem} redefiniu o prazo para ${m[1]}`;
    // Ajuste quando a posição na fila muda (mig 20261028001900).
    if ((m = t.match(/^Prazo ajustado para\s+(.+)$/i))) return `${quem} ajustou o prazo para ${m[1]}`;
    // O direcionamento nem sempre trouxe a posição na fila (gravações antigas).
    if ((m = t.match(/^Chamado direcionado a (.+?)(?:\s*—\s*(\d+)º lugar na fila.*)?$/i)))
      return `${quem} designou o chamado para ${m[1]}${m[2] ? ` · ${m[2]}º na fila` : ""}`;
    if ((m = t.match(/^Chamado reprovado:\s*(.+)$/is))) return `${quem} reprovou o chamado — ${m[1]}`;
    // Pedido/negativa de reabertura e "Transferido para <dev>" (mig 20261112190000).
    const reabertura = fraseEventoReabertura(t, quem);
    if (reabertura) return reabertura;
    // Reabertura: com e sem motivo. O `:` do motivo é opcional, então o teste
    // sem motivo vem antes de qualquer coisa que aceite sufixo.
    if ((m = t.match(/^Chamado cancelado:\s*(.+)$/is))) return `${quem} cancelou o chamado — ${m[1]}`;
    if (/^Chamado reaberto$/i.test(t)) return `${quem} reabriu o chamado`;
    if ((m = t.match(/^Chamado reaberto:\s*(.+)$/is))) return `${quem} reabriu o chamado — ${m[1]}`;
    if ((m = t.match(/^Status alterado para\s+(.+)$/i))) return `${quem} mudou o status para ${m[1]}`;
    if ((m = t.match(/^Prioridade alterada para\s+(.+)$/i))) return `${quem} mudou a prioridade para ${m[1]}`;
    // Pedido da gestão aceito por Sistemas (SIS-2026-0923, mig 20261116230000).
    if ((m = t.match(/^Entrega devolvida para revis[ãa]o a pedido da gest[ãa]o:\s*(.+)$/is))) return `${quem} devolveu a entrega para revisão a pedido da gestão — ${m[1]}`;
    if ((m = t.match(/^Posi[çc][ãa]o na fila do respons[áa]vel alterada para\s+(.+)$/i))) return `${quem} mudou a posição do chamado na fila para ${m[1]}`;
    if (/^Solicitadas mais informa/i.test(t)) return `${quem} pediu mais informações ao solicitante`;
    if (/^Solicita[çc][ãa]o de informa[çc][õo]es cancelada/i.test(t)) return `${quem} retomou o chamado`;
    return t; // aviso que ainda não tem tradução: mostra como está, sem inventar
  })();

  return { texto: frase, interno: false };
}
