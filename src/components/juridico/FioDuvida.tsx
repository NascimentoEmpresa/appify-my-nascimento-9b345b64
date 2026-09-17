import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AVALIACOES, COMPLEMENTO_MIN, complementoPendente, infoAvaliacao, podeAvaliar, podeComplementar,
  type Avaliacao, type Complemento, type Duvida,
} from "@/lib/juridico/duvidas";

// =====================================================================
// O que acontece DEPOIS da resposta do Jurídico (17/09/2026):
//   • quem perguntou AVALIA a resposta (resolveu / em parte / não resolveu,
//     com comentário opcional) — RPC jur_duvida_avaliar;
//   • quem perguntou CONTINUA PERGUNTANDO no mesmo fio, e o Jurídico
//     responde ali, complementando — JUR_DUVIDAS_COMPLEMENTOS.
// Usado nas duas telas: Orientações Jurídicas (autor) e Parecer Jurídico
// (Jurídico). Quem pode o quê vem por props; a RLS repete a regra.
// =====================================================================

const db = supabase as unknown as SupabaseClient;

const fmtDtHora = (s?: string | null) => { if (!s) return ""; const d = new Date(s); return isNaN(+d) ? s : d.toLocaleDateString("pt-BR") + " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };

export function FioDuvida({ duvida, fio, userId, autorNome, podeResponder, mostrarNomes, onMudou, toast }: {
  duvida: Duvida;
  fio: Complemento[];
  userId?: string | null;
  /** Nome gravado em quem escreve (autor da dúvida ou do Jurídico). */
  autorNome: string;
  /** Quem responde dúvidas (setor JURIDICO / responsáveis) — responde os complementos. */
  podeResponder: boolean;
  /** Biblioteca pública esconde o nome de quem perguntou; o Parecer mostra. */
  mostrarNomes: boolean;
  onMudou: () => void;
  toast: (msg: string, t?: string) => void;
}) {
  const souAutor = podeComplementar(duvida, userId);
  const pendente = complementoPendente(fio);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [avaliando, setAvaliando] = useState(false);
  const [comentario, setComentario] = useState(duvida.avaliacao_comentario ?? "");
  const [escolha, setEscolha] = useState<Avaliacao | null>(duvida.avaliacao ?? null);
  const av = infoAvaliacao(duvida.avaliacao);

  const enviar = async (tipo: Complemento["tipo"]) => {
    if (texto.trim().length < COMPLEMENTO_MIN) { toast(tipo === "pergunta" ? "Escreva a pergunta complementar." : "Escreva a resposta.", "err"); return; }
    setSalvando(true);
    const { error } = await db.from("JUR_DUVIDAS_COMPLEMENTOS").insert({ duvida_id: duvida.id, tipo, texto: texto.trim(), autor_id: userId ?? null, autor_nome: autorNome });
    setSalvando(false);
    if (error) { toast("Erro ao enviar: " + error.message, "err"); return; }
    setTexto("");
    toast(tipo === "pergunta" ? "Pergunta enviada ao Jurídico." : "Complemento publicado.", "ok");
    onMudou();
  };

  const avaliar = async () => {
    if (!escolha) { toast("Escolha uma das opções.", "err"); return; }
    setSalvando(true);
    const { error } = await db.rpc("jur_duvida_avaliar", { p_id: duvida.id, p_avaliacao: escolha, p_comentario: comentario.trim() || null });
    setSalvando(false);
    if (error) { toast("Erro ao avaliar: " + error.message, "err"); return; }
    setAvaliando(false);
    toast("Obrigado — avaliação registrada.", "ok");
    onMudou();
  };

  const excluirItem = async (c: Complemento) => {
    if (!confirm("Excluir este complemento?")) return;
    const { error } = await db.from("JUR_DUVIDAS_COMPLEMENTOS").delete().eq("id", c.id);
    if (error) { toast("Erro ao excluir: " + error.message, "err"); return; }
    onMudou();
  };

  const nome = (c: Complemento) => c.tipo === "resposta" ? (c.autor_nome || "Jurídico") : (mostrarNomes ? (c.autor_nome || "Quem perguntou") : "Quem perguntou");

  return (
    <div style={{ marginTop: 10 }}>
      {/* ── Avaliação de quem perguntou ─────────────────────────────── */}
      {(av || souAutor) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          {av && !avaliando && (
            <span style={{ fontSize: 11.5, fontWeight: 800, padding: "3px 10px", borderRadius: 20, background: av.bg, color: av.cor }}>
              {av.emoji} {mostrarNomes ? "Quem perguntou: " : ""}{av.rotulo}
            </span>
          )}
          {av && !avaliando && duvida.avaliacao_comentario && (
            <span style={{ fontSize: 12, color: "#64748b", fontStyle: "italic" }}>“{duvida.avaliacao_comentario}”</span>
          )}
          {souAutor && podeAvaliar(duvida, userId) && !avaliando && (
            <button onClick={() => setAvaliando(true)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 20, fontSize: 11.5, fontWeight: 700, color: "#475569", padding: "4px 11px", cursor: "pointer" }}>
              {av ? "Alterar avaliação" : "⭐ Avaliar a resposta"}
            </button>
          )}
        </div>
      )}
      {souAutor && avaliando && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 11, padding: "11px 13px", marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#92400e", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>A resposta resolveu sua dúvida?</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {AVALIACOES.map(a => (
              <button key={a.valor} onClick={() => setEscolha(a.valor)}
                style={{ border: `2px solid ${escolha === a.valor ? a.cor : "#e2e8f0"}`, background: escolha === a.valor ? a.bg : "#fff", color: escolha === a.valor ? a.cor : "#475569", borderRadius: 20, fontSize: 12, fontWeight: 700, padding: "6px 12px", cursor: "pointer" }}>
                {a.emoji} {a.rotulo}
              </button>
            ))}
          </div>
          <input value={comentario} onChange={e => setComentario(e.target.value)} placeholder="Comentário (opcional) — o que faltou, o que ajudou…"
            style={{ width: "100%", height: 38, border: "1px solid #cbd5e1", borderRadius: 9, padding: "0 11px", fontSize: 13, boxSizing: "border-box", background: "#fff" }} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 8 }}>
            <button onClick={() => { setAvaliando(false); setEscolha(duvida.avaliacao ?? null); setComentario(duvida.avaliacao_comentario ?? ""); }} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 9, fontSize: 12, fontWeight: 700, color: "#475569", padding: "7px 12px", cursor: "pointer" }}>Cancelar</button>
            <button onClick={avaliar} disabled={salvando} style={{ border: "none", background: "#0f3171", borderRadius: 9, fontSize: 12, fontWeight: 700, color: "#fff", padding: "7px 14px", cursor: "pointer" }}>Enviar avaliação</button>
          </div>
        </div>
      )}

      {/* ── O fio de complementos ───────────────────────────────────── */}
      {fio.length > 0 && (
        <div style={{ borderLeft: "3px solid #e2e8f0", paddingLeft: 12, display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {fio.map(c => {
            const resp = c.tipo === "resposta";
            return (
              <div key={c.id} style={{ background: resp ? "#f0fdf4" : "#f8fafc", border: `1px solid ${resp ? "#bbf7d0" : "#e2e8f0"}`, borderRadius: 10, padding: "9px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: resp ? "#15803d" : "#0f3171", textTransform: "uppercase", letterSpacing: ".4px" }}>
                    {resp ? "↩ Complemento do Jurídico" : "❓ Pergunta complementar"}
                  </div>
                  {(podeResponder || c.autor_id === userId) && (
                    <button onClick={() => excluirItem(c)} title="Excluir" style={{ border: "none", background: "none", color: "#94a3b8", cursor: "pointer", fontSize: 12 }}>✕</button>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "#0f172a", whiteSpace: "pre-wrap", marginTop: 3 }}>{c.texto}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{nome(c)}{c.created_at ? " · " + fmtDtHora(c.created_at) : ""}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Quem escreve agora ──────────────────────────────────────── */}
      {podeResponder && pendente && (
        <div style={{ background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 11, padding: "10px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#7c3aed", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>Quem perguntou pediu um complemento — responda aqui</div>
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3} placeholder="Complemento da resposta (fica público na biblioteca, junto da resposta principal)."
            style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 9, padding: "9px 11px", fontSize: 13, boxSizing: "border-box", background: "#fff", resize: "vertical" }} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
            <button onClick={() => enviar("resposta")} disabled={salvando} style={{ border: "none", background: "#7c3aed", borderRadius: 9, fontSize: 12, fontWeight: 700, color: "#fff", padding: "7px 14px", cursor: "pointer" }}>Publicar complemento</button>
          </div>
        </div>
      )}
      {souAutor && !pendente && (
        <div style={{ background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 11, padding: "10px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>Ficou alguma dúvida? Pergunte mais</div>
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={2} placeholder="Pergunta complementar — vai direto ao Jurídico, sem nova aprovação."
            style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 9, padding: "9px 11px", fontSize: 13, boxSizing: "border-box", background: "#fff", resize: "vertical" }} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
            <button onClick={() => enviar("pergunta")} disabled={salvando} style={{ border: "none", background: "#0f3171", borderRadius: 9, fontSize: 12, fontWeight: 700, color: "#fff", padding: "7px 14px", cursor: "pointer" }}>Enviar pergunta</button>
          </div>
        </div>
      )}
      {souAutor && pendente && !podeResponder && (
        <div style={{ fontSize: 12, color: "#7c3aed", fontWeight: 700 }}>⏳ Sua pergunta complementar está com o Jurídico.</div>
      )}
    </div>
  );
}
