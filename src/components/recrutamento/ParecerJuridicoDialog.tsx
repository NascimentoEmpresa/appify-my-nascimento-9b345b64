// =====================================================================
// Recrutamento › kanban — "Ver parecer do Jurídico" (16/10/2026).
//
// Pedido do Pablo: "aqui em recrutamento e seleção precisa ter um botão, pra
// ver as informações do JURIDICO". O card só mostra o selo e a observação
// cortada em 2 linhas (ex.: "Muitos processos · Ela possui alguns processos
// criminais antigos, mas não…"); o resto ficava no title, que ninguém acha.
// Esta janela mostra tudo o que o Jurídico deixou: nível (com a dica do que
// ele significa), observação inteira, quem deu e quando, e os processos que
// o candidato moveu contra a empresa (os mesmos do selo vermelho do card).
//
// Só lê o que o card já tem carregado — não faz consulta nova.
// Camada 1100, como os outros diálogos da Gestão Recrutamento.
// =====================================================================
import { useEffect } from "react";
import { Scale, X } from "lucide-react";
import { nivelJuridico, seloJuridico } from "@/lib/recrutamento/parecerJuridico";
import { AvisoProcessos, type ProcessoDoCandidato } from "@/components/recrutamento/AvisoProcessos";

export interface CandidatoJuridico {
  nome?: string | null;
  cpf?: string | null;
  juridico_ok?: boolean | null;
  juridico_obs?: string | null;
  juridico_nivel?: string | null;
  juridico_pulado?: boolean | null;
  juridico_por?: string | null;
  juridico_em?: string | null;
}

const dataHora = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function ParecerJuridicoDialog({ candidato, processos, onClose }: {
  candidato: CandidatoJuridico;
  processos: ProcessoDoCandidato[];
  onClose: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const selo = seloJuridico(candidato);
  const nivel = nivelJuridico(candidato.juridico_nivel);
  const quando = dataHora(candidato.juridico_em);
  const semParecer = !selo;

  return (
    <div role="dialog" aria-modal="true" aria-label="Parecer do Jurídico"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 60px rgba(15,23,42,.25)" }}>
        <div style={{ height: 4, background: selo?.cor ?? "#7c3aed", borderRadius: "16px 16px 0 0" }} />
        <div style={{ padding: "16px 20px 18px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".8px", textTransform: "uppercase", color: "#7c3aed" }}>
                <Scale size={13} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5 }} />Parecer do Jurídico
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{candidato.nome || "Sem nome"}</div>
              {candidato.cpf && <div style={{ fontSize: 12, color: "#94a3b8" }}>CPF {candidato.cpf}</div>}
            </div>
            <button onClick={onClose} aria-label="Fechar"
              style={{ border: "none", background: "transparent", cursor: "pointer", color: "#64748b", padding: 4 }}><X size={18} /></button>
          </div>

          {semParecer ? (
            <div style={{ marginTop: 14, fontSize: 13, color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" }}>
              O Jurídico ainda não deu parecer sobre este candidato.
            </div>
          ) : (
            <div style={{ marginTop: 14, background: selo.fundo, border: `1px solid ${selo.borda}`, borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: selo.cor }}>⚖ {selo.texto}</div>
              {nivel && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{nivel.dica}</div>}
              <div style={{ fontSize: 11, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: ".6px", marginTop: 12 }}>Observação</div>
              <div style={{ fontSize: 13.5, color: "#0f172a", marginTop: 3, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                {candidato.juridico_obs?.trim() || <span style={{ color: "#94a3b8" }}>Sem observação.</span>}
              </div>
              {(candidato.juridico_por || quando) && (
                <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 12 }}>
                  {candidato.juridico_por ? <>Por <b style={{ color: "#334155" }}>{candidato.juridico_por}</b></> : null}
                  {candidato.juridico_por && quando ? " · " : null}
                  {quando}
                </div>
              )}
            </div>
          )}

          {processos.length > 0 && <div style={{ marginTop: 12 }}><AvisoProcessos processos={processos} /></div>}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={onClose}
              style={{ padding: "8px 16px", borderRadius: 8, background: "#fff", border: "1px solid #e2e8f0", color: "#475569", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Fechar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
