import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { useMeuNome } from "@/hooks/useMeuNome";
import {
  BUCKET_ANEXOS, caminhoAnexo, ehImagem, erroDoAnexo, fmtTamanho, type AnexoSolicitacao,
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
  const [subindo, setSubindo] = useState(false);
  const [erro, setErro] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const carregar = useCallback(async () => {
    if (entidadeId == null) { setItens([]); return; }
    const { data } = await db.from("SISTEMA_SOLICITACOES_ANEXOS").select("*")
      .eq("modulo", modulo).eq("entidade_id", String(entidadeId)).order("id");
    // A coluna é storage_path; o tipo compartilhado (AnexoRef) fala em `path`.
    setItens(((data ?? []) as (AnexoSolicitacao & { storage_path: string })[]).map(r => ({ ...r, path: r.storage_path })));
  }, [modulo, entidadeId]);
  useEffect(() => { carregar(); }, [carregar]);

  const abrir = async (a: AnexoSolicitacao) => {
    const { data, error } = await supabase.storage.from(BUCKET_ANEXOS).createSignedUrl(a.path, 3600);
    if (error || !data?.signedUrl) { setErro("Não consegui abrir o arquivo."); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

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

  if (!podeAnexar && itens.length === 0) return null;

  return (
    <div style={{ marginTop: compacto ? 8 : 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px" }}>
          📎 {titulo}{itens.length ? ` (${itens.length})` : ""}
        </div>
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
      {itens.length === 0 ? (
        <div style={{ fontSize: 13, color: "#64748b" }}>Nenhum anexo. {podeAnexar ? "Opcional — foto, documento, print…" : ""}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {itens.map(a => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #e2e8f0", borderRadius: 9, padding: "6px 10px", background: "#fff" }}>
              <span style={{ fontSize: 14 }}>{ehImagem(a.tipo, a.nome) ? "🖼️" : "📄"}</span>
              <button onClick={() => abrir(a)} title="Abrir" style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none", color: "#0f3171", fontWeight: 700, fontSize: 12.5, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: 0 }}>
                {a.nome}
              </button>
              <span style={{ fontSize: 12.5, color: "#64748b", whiteSpace: "nowrap" }}>{fmtTamanho(a.tamanho)}{a.autor_nome ? ` · ${a.autor_nome}` : ""}</span>
              {a.autor_id === user?.id && (
                <button onClick={() => excluir(a)} title="Excluir" style={{ border: "none", background: "none", color: "#64748b", cursor: "pointer", fontSize: 13 }}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}
      {erro && <div style={{ fontSize: 12.5, color: "#dc2626", marginTop: 6 }}>{erro}</div>}
    </div>
  );
}
