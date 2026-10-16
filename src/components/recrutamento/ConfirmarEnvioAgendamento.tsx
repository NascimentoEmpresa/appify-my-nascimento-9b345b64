// =====================================================================
// Recrutamento › SST + COMPRAS — confirmação do "Enviar agendamento"
// (16/10/2026). Pablo: "ao clicar Enviar agendamento tem que pedir pra
// confirmar". Janela própria (não o confirm() do navegador): mostra para quem
// vai, em qual número e o texto exato que o candidato recebe — mensagem no
// WhatsApp não se desfaz.
// Camada 1200: acima do kanban (800) e do diálogo do SST (1100), de onde
// também se pode enviar.
// =====================================================================
import { useEffect } from "react";
import { Loader2, X } from "lucide-react";
import { previaTemplateAgendamento, type AgendamentoAso } from "@/lib/recrutamento/agendamentoAso";
import { IconeWhatsApp } from "@/components/recrutamento/QuadrosSstCompras";

export function ConfirmarEnvioAgendamento({ candidato, cargo, enviando, onConfirmar, onCancelar }: {
  candidato: AgendamentoAso & { telefone?: string | null };
  cargo?: string | null;
  enviando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !enviando) onCancelar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [enviando, onCancelar]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Confirmar envio do agendamento"
      onClick={(e) => { if (e.target === e.currentTarget && !enviando) onCancelar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 460, maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 60px rgba(15,23,42,.3)" }}>
        <div style={{ height: 4, background: "#25d366", borderRadius: "16px 16px 0 0" }} />
        <div style={{ padding: "16px 20px 18px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>Enviar o agendamento no WhatsApp?</div>
              <div style={{ fontSize: 12.5, color: "#475569", marginTop: 3 }}>
                Para <b>{candidato.nome || "o candidato"}</b>{candidato.telefone ? <> · {candidato.telefone}</> : null}
              </div>
            </div>
            <button onClick={onCancelar} disabled={enviando} aria-label="Fechar" style={{ border: "none", background: "transparent", cursor: "pointer", color: "#64748b", padding: 4 }}><X size={18} /></button>
          </div>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 14 }}>O candidato vai receber</div>
          <pre style={{ marginTop: 6, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit", fontSize: 12.5, color: "#0f172a", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 12px" }}>
            {previaTemplateAgendamento(candidato, cargo)}
          </pre>
          <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 8 }}>A mensagem fica na Caixa de Entrada do WhatsApp, na conversa do candidato.</div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button onClick={onCancelar} disabled={enviando}
              style={{ padding: "8px 16px", borderRadius: 8, background: "#fff", border: "1px solid #e2e8f0", color: "#475569", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
            <button onClick={onConfirmar} disabled={enviando}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: "#25d366", border: "none", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: enviando ? "default" : "pointer" }}>
              {enviando ? <Loader2 size={14} className="animate-spin" /> : <IconeWhatsApp tamanho={14} />}{enviando ? "Enviando…" : "Sim, enviar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
