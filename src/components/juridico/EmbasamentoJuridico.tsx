import { useState } from "react";
import type { Duvida } from "@/lib/juridico/duvidas";

// =====================================================================
// Embasamento jurídico da resposta (28/09/2026, mig 253).
// A resposta simples fica sempre à vista; a fundamentação (leis, normas,
// cláusulas) fica recolhida atrás de "Visualizar embasamento jurídico" —
// pedido do Pablo pra tela não pesar. Quem vê a resposta vê o embasamento;
// o que é gerenciado (Acesso por Usuário) é só quem ESCREVE.
// Usado no Parecer Jurídico e nas Orientações Jurídicas (Central/Encarregados
// e Operacional).
// =====================================================================

const fmtDt = (s?: string | null) => { if (!s) return ""; const d = new Date(s); return isNaN(+d) ? s : d.toLocaleDateString("pt-BR"); };

export function EmbasamentoJuridico({ duvida }: { duvida: Pick<Duvida, "embasamento" | "embasamento_por" | "embasamento_em"> }) {
  const [aberto, setAberto] = useState(false);
  if (!(duvida.embasamento ?? "").trim()) return null;
  return (
    <div>
      <button type="button" onClick={() => setAberto(v => !v)} aria-expanded={aberto}
        style={{ border: "1px solid #c7d2fe", background: aberto ? "#eef2ff" : "#fff", color: "#3730a3", borderRadius: 999, fontSize: 12.5, fontWeight: 800, padding: "6px 13px", cursor: "pointer", fontFamily: "inherit" }}>
        📚 {aberto ? "Ocultar embasamento jurídico" : "Visualizar embasamento jurídico"}
      </button>
      {aberto && (
        <div style={{ marginTop: 8, background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 14, padding: "13px 15px" }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#3730a3", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 5 }}>
            📚 Embasamento jurídico
            {(duvida.embasamento_por || duvida.embasamento_em) && (
              <span style={{ fontWeight: 600, textTransform: "none", letterSpacing: 0, color: "#4f46e5" }}>
                {" · "}{duvida.embasamento_por || "Jurídico"}{duvida.embasamento_em ? " · " + fmtDt(duvida.embasamento_em) : ""}
              </span>
            )}
          </div>
          <div style={{ fontSize: 13.5, color: "#1e1b4b", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{duvida.embasamento}</div>
        </div>
      )}
    </div>
  );
}
