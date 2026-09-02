// Painel Gerencial — chat lateral de IA (SIS-2026-0311).
//
// Drawer fixo à direita, disponível em TODAS as abas da rota /painel. Responde
// dúvida de navegação: onde está um colaborador, quais setores têm feedback,
// como gerar um diagnóstico. A busca por pessoa acontece no servidor, em
// código — a IA só redige o que foi achado, para não dizer que alguém não
// existe quando existe.
//
// Estilo inline como o resto da pasta painel/ (nada de shadcn aqui).
import { useEffect, useRef, useState } from "react";
import { usePainelChat, MAX_PERGUNTA_CHARS } from "@/hooks/usePainelChat";
import { btn } from "./ui";

const LARGURA = 380;

const SUGESTOES = [
  "Onde encontro o colaborador ",
  "Quais setores têm feedback?",
  "Como eu gero um diagnóstico?",
];

const caixaMsg = (minha: boolean): React.CSSProperties => ({
  alignSelf: minha ? "flex-end" : "flex-start",
  maxWidth: "88%",
  padding: "8px 11px",
  borderRadius: 12,
  fontSize: 12.5,
  lineHeight: 1.55,
  whiteSpace: "pre-wrap",
  background: minha ? "#0f3171" : "#f1f5f9",
  color: minha ? "#fff" : "#1e293b",
});

export default function ChatPainel({ dicaIds }: { dicaIds: Record<string, string[]> }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const { mensagens, pensando, erro, enviar, limpar } = usePainelChat(dicaIds);
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (aberto) fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens, pensando, aberto]);

  const mandar = async () => {
    const pergunta = texto.trim();
    if (!pergunta || pensando) return;
    setTexto("");
    await enviar(pergunta);
  };

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        title="Perguntar à IA sobre os formulários"
        style={{
          position: "fixed", right: 22, bottom: 22, zIndex: 60,
          width: 52, height: 52, borderRadius: "50%", border: "none",
          background: "#0f3171", color: "#fff", fontSize: 22, cursor: "pointer",
          boxShadow: "0 10px 26px rgba(15,49,113,.35)",
        }}
      >💬</button>
    );
  }

  return (
    <aside style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: LARGURA, maxWidth: "100vw",
      zIndex: 60, background: "#fff", borderLeft: "1px solid #e2e8f0",
      boxShadow: "-12px 0 34px rgba(15,23,42,.12)", display: "flex", flexDirection: "column",
    }}>
      <header style={{
        display: "flex", alignItems: "center", gap: 8, padding: "13px 15px",
        borderBottom: "1px solid #f1f5f9", flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>💬 Perguntar à IA</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Sobre os formulários que você enxerga</div>
        </div>
        {mensagens.length > 0 && (
          <button onClick={limpar} title="Limpar conversa"
            style={{ ...btn("#fff", "#64748b", "1px solid #e2e8f0"), padding: "5px 9px", fontSize: 11 }}>
            Limpar
          </button>
        )}
        <button onClick={() => setAberto(false)} title="Fechar"
          style={{ ...btn("#fff", "#64748b", "1px solid #e2e8f0"), padding: "5px 10px", fontSize: 14 }}>
          ✕
        </button>
      </header>

      <div style={{
        flex: 1, overflowY: "auto", padding: "14px 15px",
        display: "flex", flexDirection: "column", gap: 9,
      }}>
        {mensagens.length === 0 && (
          <div style={{ color: "#64748b", fontSize: 12.5, lineHeight: 1.6 }}>
            Pergunte onde está um colaborador, quais setores responderam ou como usar o painel.
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              {SUGESTOES.map((s) => (
                <button key={s} onClick={() => setTexto(s)}
                  style={{
                    textAlign: "left", padding: "8px 10px", borderRadius: 10,
                    border: "1px solid #e2e8f0", background: "#f8fafc", color: "#334155",
                    fontSize: 12, cursor: "pointer",
                  }}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {mensagens.map((m, i) => (
          <div key={i} style={caixaMsg(m.papel === "user")}>{m.texto}</div>
        ))}

        {pensando && (
          <div style={{ ...caixaMsg(false), color: "#64748b", fontStyle: "italic" }}>
            Consultando os formulários…
          </div>
        )}

        {erro && (
          <div role="alert" style={{
            padding: "10px 12px", border: "1px solid #fecaca", borderRadius: 11,
            background: "#fef2f2", color: "#b91c1c", fontSize: 12, lineHeight: 1.5,
          }}>{erro}</div>
        )}

        <div ref={fimRef} />
      </div>

      <div style={{ borderTop: "1px solid #f1f5f9", padding: "10px 12px 12px", flexShrink: 0 }}>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void mandar(); }
          }}
          placeholder="Ex.: não estou achando o colaborador FULANO DE TAL"
          maxLength={MAX_PERGUNTA_CHARS}
          rows={2}
          style={{
            width: "100%", resize: "none", border: "1px solid #e2e8f0", borderRadius: 10,
            padding: "8px 10px", fontSize: 12.5, outline: "none", color: "#0f172a",
            fontFamily: "inherit", lineHeight: 1.5,
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
          <div style={{ flex: 1, fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>
            A IA vê nomes, setores e quantidades — não lê o conteúdo dos feedbacks.
          </div>
          <button onClick={() => void mandar()} disabled={pensando || !texto.trim()}
            style={{
              ...btn("#0f3171"),
              opacity: pensando || !texto.trim() ? .5 : 1,
              cursor: pensando ? "wait" : texto.trim() ? "pointer" : "not-allowed",
            }}>
            {pensando ? "…" : "Perguntar"}
          </button>
        </div>
      </div>
    </aside>
  );
}
