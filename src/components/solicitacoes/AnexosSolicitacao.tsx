import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { useMeuNome } from "@/hooks/useMeuNome";
import {
  BUCKET_ANEXOS, caminhoAnexo, ehImagem, erroDoAnexo, fmtTamanho, type AnexoRef, type AnexoSolicitacao,
} from "@/lib/solicitacoes/anexos";

// =====================================================================
// Os ARQUIVOS de uma solicitação (17/09/2026): lista o que já foi anexado
// (abre por URL assinada — bucket privado) e, quando `podeAnexar`, deixa
// subir mais. Mesmo bloco nos dois lados (quem pediu e quem trata) — o
// registro é SISTEMA_SOLICITACOES_ANEXOS, chave modulo + entidade_id.
// =====================================================================

const db = supabase as unknown as SupabaseClient;

export function AnexosSolicitacao({ modulo, entidadeId, podeAnexar, titulo = "Anexos", compacto }: {
  modulo: string;
  entidadeId: number | string | null | undefined;
  /** Quem pode subir arquivo aqui (o solicitante, em regra). */
  podeAnexar: boolean;
  titulo?: string;
  compacto?: boolean;
}) {
  const { user } = useAuth();
  const nome = useMeuNome() || "Usuário";
  const [itens, setItens] = useState<AnexoSolicitacao[]>([]);
  // Os arquivos mandados na CONVERSA (SISTEMA_COMENTARIOS.anexos) também
  // acumulam aqui (17/09/2026): é o lugar único de "tudo que foi anexado".
  const [daConversa, setDaConversa] = useState<(AnexoRef & { chave: string; autor_nome?: string | null; created_at?: string })[]>([]);
  const [filtro, setFiltro] = useState<"todos" | "solicitacao" | "conversa">("todos");
  const [subindo, setSubindo] = useState(false);
  const [erro, setErro] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const carregar = useCallback(async () => {
    if (entidadeId == null) { setItens([]); setDaConversa([]); return; }
    const [{ data }, { data: coms }] = await Promise.all([
      db.from("SISTEMA_SOLICITACOES_ANEXOS").select("*").eq("modulo", modulo).eq("entidade_id", String(entidadeId)).order("id"),
      db.from("SISTEMA_COMENTARIOS").select("id, autor_nome, created_at, anexos").eq("modulo", modulo).eq("entidade_id", String(entidadeId)).order("created_at"),
    ]);
    // A coluna é storage_path; o tipo compartilhado (AnexoRef) fala em `path`.
    setItens(((data ?? []) as (AnexoSolicitacao & { storage_path: string })[]).map(r => ({ ...r, path: r.storage_path })));
    setDaConversa(((coms ?? []) as { id: number; autor_nome?: string | null; created_at?: string; anexos?: AnexoRef[] | null }[])
      .flatMap(c => (c.anexos ?? []).map((a, i) => ({ ...a, chave: `c-${c.id}-${i}`, autor_nome: c.autor_nome, created_at: c.created_at }))));
  }, [modulo, entidadeId]);
  useEffect(() => { carregar(); }, [carregar]);

  const abrirPath = async (path: string) => {
    const { data, error } = await supabase.storage.from(BUCKET_ANEXOS).createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) { setErro("Não consegui abrir o arquivo."); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };
  const abrir = (a: AnexoSolicitacao) => abrirPath(a.path);
  const subir = async (files: FileList | File[]) => {
    if (entidadeId == null) return;
    const lista = Array.from(files);
    if (!lista.length) return;
    setErro("");
    for (const f of lista) { const e = erroDoAnexo(f); if (e) { setErro(e); return; } }
    setSubindo(true);
    for (const f of lista) {
      const path = caminhoAnexo(modulo, entidadeId, f.name);
      const { error: up } = await supabase.storage.from(BUCKET_ANEXOS).upload(path, f, { upsert: false, contentType: f.type || undefined });
      if (up) { setErro(`Falha ao subir "${f.name}": ${up.message}`); break; }
      const { error } = await db.from("SISTEMA_SOLICITACOES_ANEXOS").insert({
        modulo, entidade_id: String(entidadeId), nome: f.name, storage_path: path,
        tipo: f.type || null, tamanho: f.size, autor_nome: nome, autor_email: user?.email ?? null, autor_id: user?.id ?? null,
      });
      if (error) { setErro(`Falha ao registrar "${f.name}": ${error.message}`); break; }
    }
    setSubindo(false);
    if (inputRef.current) inputRef.current.value = "";
    carregar();
  };

  const excluir = async (a: AnexoSolicitacao) => {
    if (!confirm(`Excluir o anexo "${a.nome}"?`)) return;
    await supabase.storage.from(BUCKET_ANEXOS).remove([a.path]);
    const { error } = await db.from("SISTEMA_SOLICITACOES_ANEXOS").delete().eq("id", a.id);
    if (error) { setErro(error.message); return; }
    carregar();
  };

  const total = itens.length + daConversa.length;
  if (!podeAnexar && total === 0) return null;
  const mostrarSol = filtro !== "conversa", mostrarConv = filtro !== "solicitacao";
  const chip = (k: typeof filtro, rotulo: string, n: number) => (
    <button key={k} onClick={() => setFiltro(k)} style={{ border: "1.5px solid", borderColor: filtro === k ? "#0f3171" : "#e2e8f0", background: filtro === k ? "#0f3171" : "#fff", color: filtro === k ? "#fff" : "#475569", borderRadius: 999, fontSize: 11.5, fontWeight: 800, padding: "3px 10px", cursor: "pointer" }}>
      {rotulo} <span style={{ opacity: .75 }}>{n}</span>
    </button>
  );
  const linha = (chave: string, nome: string, tipo: string | null | undefined, tamanho: number | null | undefined, autor: string | null | undefined, origem: "solicitacao" | "conversa", onAbrir: () => void, onExcluir?: () => void) => (
    <div key={chave} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #e2e8f0", borderRadius: 9, padding: "6px 10px", background: "#fff" }}>
      <span style={{ fontSize: 14 }}>{ehImagem(tipo, nome) ? "🖼️" : "📄"}</span>
      <button onClick={onAbrir} title="Abrir" style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none", color: "#0f3171", fontWeight: 700, fontSize: 13, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: 0 }}>
        {nome}
      </button>
      <span style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 7px", borderRadius: 999, background: origem === "conversa" ? "#ede9fe" : "#dcfce7", color: origem === "conversa" ? "#6d28d9" : "#15803d", whiteSpace: "nowrap" }}>{origem === "conversa" ? "💬 conversa" : "📝 solicitação"}</span>
      <span style={{ fontSize: 12.5, color: "#64748b", whiteSpace: "nowrap" }}>{fmtTamanho(tamanho)}{autor ? ` · ${autor}` : ""}</span>
      {onExcluir && <button onClick={onExcluir} title="Excluir" style={{ border: "none", background: "none", color: "#64748b", cursor: "pointer", fontSize: 13 }}>✕</button>}
    </div>
  );

  return (
    <div style={{ marginTop: compacto ? 8 : 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px" }}>
          📎 {titulo}{total ? ` (${total})` : ""}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {/* Filtro (17/09/2026): tudo que foi anexado, da solicitação ou mandado na conversa. */}
          {itens.length > 0 && daConversa.length > 0 && <>{chip("todos", "Todos", total)}{chip("solicitacao", "Da solicitação", itens.length)}{chip("conversa", "Da conversa", daConversa.length)}</>}
          {podeAnexar && (
            <>
              <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) subir(e.target.files); }} />
              <button onClick={() => inputRef.current?.click()} disabled={subindo}
                style={{ border: "1px solid #cbd5e1", background: "#fff", borderRadius: 9, fontSize: 13, fontWeight: 700, color: "#0f3171", padding: "5px 10px", cursor: "pointer" }}>
                {subindo ? "Enviando…" : "+ Anexar arquivo"}
              </button>
            </>
          )}
        </div>
      </div>
      {total === 0 ? (
        <div style={{ fontSize: 13, color: "#64748b" }}>Nenhum anexo. {podeAnexar ? "Opcional — foto, documento, print…" : ""}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {mostrarSol && itens.map(a => linha(`s-${a.id}`, a.nome, a.tipo, a.tamanho, a.autor_nome, "solicitacao", () => abrir(a), a.autor_id === user?.id ? () => excluir(a) : undefined))}
          {mostrarConv && daConversa.map(a => linha(a.chave, a.nome, a.tipo, a.tamanho, a.autor_nome, "conversa", () => abrirPath(a.path)))}
        </div>
      )}
      {erro && <div style={{ fontSize: 12.5, color: "#dc2626", marginTop: 6 }}>{erro}</div>}
    </div>
  );
}
