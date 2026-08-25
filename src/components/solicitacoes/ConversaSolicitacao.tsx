import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { useMeuNome } from "@/hooks/useMeuNome";

// =====================================================================
// A CONVERSA DE UMA SOLICITAÇÃO — o mesmo fio dos dois lados
//
// Quem pede escreve em Encarregados › Minhas Solicitações; quem trata
// responde na tela do módulo dele. É o MESMO registro em
// SISTEMA_COMENTARIOS (modulo + entidade_id) — dois fios separados fariam
// os dois lados escreverem sem nunca se ver, que é exatamente o que existia
// antes de 21/08/2026.
//
// Por que componente e não copiar o bloco: este mesmo desenho já vivia
// copiado na tela de Férias, e as telas de Advertência e Demissão nasceriam
// com uma terceira e quarta cópia. Duas vezes hoje eu corrigi bug que era
// justamente cópia divergente (o botão do Malote, o statusObr do
// Patrimônio) — não vale repetir de propósito.
// =====================================================================

const db = supabase as unknown as SupabaseClient;

/** Os módulos que usam o feed para conversar sobre uma solicitação. */
export type ModuloConversa = "ferias" | "advertencia" | "demissao";

interface Comentario {
  id: number;
  texto: string;
  autor_nome: string | null;
  autor_cpf: string | null;
  created_at: string;
}

const fmt = (s?: string | null) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(+d) ? "" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

export function ConversaSolicitacao({ modulo, entidadeId, aviso }: {
  modulo: ModuloConversa;
  /** id da solicitação. Vai como texto — o feed é compartilhado por módulos
   *  cujas PKs nem sempre são do mesmo tipo. */
  entidadeId: number | string | null | undefined;
  /** Uma linha explicando a quem a mensagem chega. */
  aviso?: string;
}) {
  const { user } = useAuth();
  const [msgs, setMsgs] = useState<Comentario[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  // O nome vai GRAVADO em cada mensagem — errar aqui deixa e-mail no feed
  // para sempre. useMeuNome tira do profile (ver o hook).
  const nome = useMeuNome() || "Usuário";

  const carregar = useCallback(async () => {
    if (entidadeId == null) { setMsgs([]); return; }
    const { data } = await db.from("SISTEMA_COMENTARIOS")
      .select("id, texto, autor_nome, autor_cpf, created_at")
      .eq("modulo", modulo).eq("entidade_id", String(entidadeId))
      .order("created_at");
    setMsgs((data ?? []) as Comentario[]);
  }, [modulo, entidadeId]);

  useEffect(() => {
    carregar();
    // O outro lado responde com a tela aberta; sem isto a resposta só
    // apareceria no próximo F5.
    const t = setInterval(carregar, 8000);
    return () => clearInterval(t);
  }, [carregar]);

  const enviar = async () => {
    const t = texto.trim();
    if (!t || enviando || entidadeId == null) return;
    setEnviando(true);
    setErro("");
    const { error } = await db.from("SISTEMA_COMENTARIOS").insert({
      modulo, entidade_id: String(entidadeId), texto: t,
      autor_nome: nome, autor_cpf: user?.email ?? "",
    });
    setEnviando(false);
    if (error) { setErro(error.message); return; }
    setTexto("");
    carregar();
  };

  return (
    <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: aviso ? 4 : 10 }}>
        💬 Conversa
      </div>
      {aviso && <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>{aviso}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12, maxHeight: 260, overflowY: "auto" }}>
        {msgs.length === 0 ? (
          <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", padding: "12px 0" }}>
            Nenhuma mensagem ainda.
          </div>
        ) : msgs.map((m) => {
          const minha = !!user?.email && m.autor_cpf === user.email;
          return (
            <div key={m.id} style={{ alignSelf: minha ? "flex-end" : "flex-start", maxWidth: "75%" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", padding: "0 2px", textAlign: minha ? "right" : "left" }}>
                {m.autor_nome}
              </div>
              <div style={{
                background: minha ? "#0f3171" : "#f1f5f9", color: minha ? "#fff" : "#0f172a",
                borderRadius: 12, padding: "8px 12px", fontSize: 13,
                whiteSpace: "pre-wrap", overflowWrap: "anywhere",
              }}>
                {m.texto}
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8", padding: "0 2px", textAlign: minha ? "right" : "left" }}>
                {fmt(m.created_at)}
              </div>
            </div>
          );
        })}
      </div>

      {erro && <div style={{ fontSize: 11, color: "#dc2626", marginBottom: 8 }}>{erro}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={texto} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") enviar(); }}
          placeholder="Escreva uma mensagem..."
          style={{ flex: 1, border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 12px", fontSize: 13, outline: "none", fontFamily: "inherit" }}
        />
        <button onClick={enviar} disabled={enviando || !texto.trim()}
          style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: texto.trim() ? "#0f3171" : "#cbd5e1", color: "#fff", fontSize: 13, fontWeight: 700, cursor: texto.trim() ? "pointer" : "default", fontFamily: "inherit" }}>
          {enviando ? "..." : "Enviar"}
        </button>
      </div>
    </div>
  );
}
