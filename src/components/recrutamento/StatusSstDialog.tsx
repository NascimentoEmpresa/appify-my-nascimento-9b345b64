// =====================================================================
// Recrutamento › SST + COMPRAS — "Status do SST" (16/10/2026).
//
// Pedido do Pablo: "quando estiver em SST + COMPRAS, tem que ter 1 botão no
// compras e um no SST pra ver como está o status da solicitação, toda vez
// que o SST agenda um aso o recrutamento tem que saber todas informações de
// agendamento pra passar pro colaborador. e tem que ter um botão pra copiar o
// link do mapa e tudo sobre o agendamento."
//
// O botão do Compras já existia (abre o pedido de materiais). Este é o do
// SST: em que passo está (a receber / recebido / agendado / reprovado), quem
// recebeu e quem agendou, e o agendamento inteiro com "Copiar link do mapa" e
// "Copiar agendamento" (texto pronto para o WhatsApp do candidato).
// Só lê o que o card já tem (WA_CURRICULOS.sst_*) — sem consulta nova.
// Camada 1100, como os outros diálogos da Gestão Recrutamento.
// =====================================================================
import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, Check, Copy, MapPin, Stethoscope, X } from "lucide-react";
import { dataBr, diaDaSemana, linkMapaAso, situacaoSst, textoAgendamentoAso, type AgendamentoAso } from "@/lib/recrutamento/agendamentoAso";

const COR: Record<string, { cor: string; fundo: string; borda: string }> = {
  "A receber": { cor: "#b45309", fundo: "#fffbeb", borda: "#fde68a" },
  "Recebido — a agendar": { cor: "#0369a1", fundo: "#f0f9ff", borda: "#bae6fd" },
  "Agendado": { cor: "#15803d", fundo: "#f0fdf4", borda: "#bbf7d0" },
  "Reprovado pelo SST": { cor: "#b91c1c", fundo: "#fef2f2", borda: "#fecaca" },
};

const dataHora = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

async function copiar(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; } catch {
    // Navegador sem clipboard API (http na rede interna): o jeito antigo.
    try {
      const t = document.createElement("textarea");
      t.value = texto; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(t);
      return ok;
    } catch { return false; }
  }
}

export function StatusSstDialog({ candidato, onClose }: { candidato: AgendamentoAso & { cpf?: string | null }; onClose: () => void }) {
  const [copiado, setCopiado] = useState<"" | "mapa" | "tudo" | "erro">("");
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const sit = situacaoSst(candidato);
  const cor = COR[sit];
  const mapa = linkMapaAso(candidato);
  const texto = textoAgendamentoAso(candidato);
  const dia = diaDaSemana(candidato.sst_data_exame);

  const acao = async (qual: "mapa" | "tudo", valor: string | null) => {
    if (!valor) return;
    setCopiado((await copiar(valor)) ? qual : "erro");
    setTimeout(() => setCopiado(""), 2500);
  };

  const linha = (rotulo: string, valor: ReactNode) => (
    <div style={{ display: "flex", gap: 10, fontSize: 13, padding: "5px 0", borderBottom: "1px dashed #e2e8f0" }}>
      <div style={{ width: 92, flexShrink: 0, color: "#64748b", fontWeight: 600 }}>{rotulo}</div>
      <div style={{ color: "#0f172a", minWidth: 0, overflowWrap: "anywhere" }}>{valor}</div>
    </div>
  );
  const bt = (ativo: boolean) => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 700,
    cursor: ativo ? "pointer" : "not-allowed", opacity: ativo ? 1 : 0.5, border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#15803d",
  } as const);

  return (
    <div role="dialog" aria-modal="true" aria-label="Status do SST"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 540, maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 60px rgba(15,23,42,.25)" }}>
        <div style={{ height: 4, background: cor.cor, borderRadius: "16px 16px 0 0" }} />
        <div style={{ padding: "16px 20px 18px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".8px", textTransform: "uppercase", color: "#b45309" }}>
                <Stethoscope size={13} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5 }} />Status do SST · ASO admissional
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{candidato.nome || "Sem nome"}</div>
              {candidato.cpf && <div style={{ fontSize: 12, color: "#94a3b8" }}>CPF {candidato.cpf}</div>}
            </div>
            <button onClick={onClose} aria-label="Fechar" style={{ border: "none", background: "transparent", cursor: "pointer", color: "#64748b", padding: 4 }}><X size={18} /></button>
          </div>

          <div style={{ marginTop: 12, display: "inline-block", fontSize: 12.5, fontWeight: 800, color: cor.cor, background: cor.fundo, border: `1px solid ${cor.borda}`, borderRadius: 20, padding: "4px 12px" }}>{sit}</div>

          <div style={{ marginTop: 10 }}>
            {linha("Recebido", candidato.sst_visto_em ? `${dataHora(candidato.sst_visto_em)}${candidato.sst_visto_por ? ` · ${candidato.sst_visto_por}` : ""}` : <span style={{ color: "#94a3b8" }}>O SST ainda não deu o visto.</span>)}
            {linha("Agendado", candidato.sst_agendado_em ? `${dataHora(candidato.sst_agendado_em)}${candidato.sst_agendado_por ? ` · ${candidato.sst_agendado_por}` : ""}` : <span style={{ color: "#94a3b8" }}>Ainda não agendado.</span>)}
            {sit === "Reprovado pelo SST" && candidato.sst_obs && linha("Motivo", candidato.sst_obs)}
          </div>

          {candidato.sst_data_exame ? (
            <div style={{ marginTop: 14, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#15803d", textTransform: "uppercase", letterSpacing: ".6px" }}>
                <CalendarDays size={12} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5 }} />Agendamento do exame
              </div>
              {linha("Data", `${dataBr(candidato.sst_data_exame)}${dia ? ` (${dia})` : ""}`)}
              {linha("Horário", candidato.sst_hora_exame || "—")}
              {linha("Local", candidato.sst_local_exame || "—")}
              {linha("Mapa", mapa ? <a href={mapa} target="_blank" rel="noopener noreferrer" style={{ color: "#0369a1", fontWeight: 600 }}><MapPin size={12} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px" }} /> Abrir no mapa</a> : "—")}
              {sit !== "Reprovado pelo SST" && candidato.sst_obs && linha("Observação", candidato.sst_obs)}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button onClick={() => acao("mapa", mapa)} disabled={!mapa} style={bt(!!mapa)} title="Copia só o link do mapa">
                  {copiado === "mapa" ? <Check size={14} /> : <MapPin size={14} />}{copiado === "mapa" ? "Link copiado!" : "Copiar link do mapa"}
                </button>
                <button onClick={() => acao("tudo", texto)} style={{ ...bt(true), background: "#15803d", color: "#fff", borderColor: "#15803d" }} title="Copia data, horário, local e mapa num texto pronto para o WhatsApp do candidato">
                  {copiado === "tudo" ? <Check size={14} /> : <Copy size={14} />}{copiado === "tudo" ? "Agendamento copiado!" : "Copiar agendamento"}
                </button>
              </div>
              {copiado === "erro" && <div style={{ fontSize: 11.5, color: "#b91c1c", marginTop: 6 }}>Não deu para copiar neste navegador — selecione o texto abaixo.</div>}
              {texto && (
                <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12, color: "#334155", background: "#fff", border: "1px solid #dcfce7", borderRadius: 8, padding: "8px 10px" }}>{texto}</pre>
              )}
            </div>
          ) : sit !== "Reprovado pelo SST" && (
            <div style={{ marginTop: 14, fontSize: 13, color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" }}>
              Quando o SST agendar o exame, a data, o horário, o local e o mapa aparecem aqui, prontos para copiar e mandar ao candidato.
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, background: "#fff", border: "1px solid #e2e8f0", color: "#475569", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Fechar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
