import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { useMeuNome } from "@/hooks/useMeuNome";
import {
  BUCKET_ANEXOS, arquivosDaColagem, caminhoAnexo, ehImagem, erroDoAnexo, fmtTamanho, nomeDeColagem, type AnexoRef,
} from "@/lib/solicitacoes/anexos";

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
//
// ARQUIVOS E IMAGENS (17/09/2026, mig 175): a mensagem pode levar anexos
// (SISTEMA_COMENTARIOS.anexos, bucket solicitacoes-anexos). Imagem aparece
// inline; o resto vira um chip que abre por URL assinada. Cola com Ctrl+V
// (print da área de transferência vira anexo na hora) e copia com Ctrl+C:
// clica na imagem pra selecionar e Ctrl+C põe o PNG na área de
// transferência — ou o botão "Copiar" da própria imagem.
// =====================================================================

const db = supabase as unknown as SupabaseClient;

/** Os módulos que usam o feed para conversar sobre uma solicitação. */
export type ModuloConversa = "ferias" | "advertencia" | "demissao" | "troca_funcao";

interface Comentario {
  id: number;
  texto: string;
  autor_nome: string | null;
  autor_cpf: string | null;
  created_at: string;
  anexos?: AnexoRef[] | null;
}

const fmt = (s?: string | null) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(+d) ? "" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

/** Copia uma imagem (por URL) pra área de transferência como PNG — o único tipo que os navegadores aceitam. */
async function copiarImagem(url: string): Promise<boolean> {
  try {
    const blob = await (await fetch(url)).blob();
    const png = blob.type === "image/png" ? blob : await paraPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch { return false; }
}
function paraPng(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d")?.drawImage(img, 0, 0);
      c.toBlob(b => b ? resolve(b) : reject(new Error("canvas")), "image/png");
    };
    img.onerror = () => reject(new Error("imagem"));
    img.src = URL.createObjectURL(blob);
  });
}

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
  const [pendentes, setPendentes] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso2, setAviso2] = useState("");
  // URLs assinadas por path (bucket privado) — 1h, renovadas a cada carga.
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fimRef = useRef<HTMLDivElement | null>(null);

  // O nome vai GRAVADO em cada mensagem — errar aqui deixa e-mail no feed
  // para sempre. useMeuNome tira do profile (ver o hook).
  const nome = useMeuNome() || "Usuário";

  const carregar = useCallback(async () => {
    if (entidadeId == null) { setMsgs([]); return; }
    const { data } = await db.from("SISTEMA_COMENTARIOS")
      .select("id, texto, autor_nome, autor_cpf, created_at, anexos")
      .eq("modulo", modulo).eq("entidade_id", String(entidadeId))
      .order("created_at");
    const lista = (data ?? []) as Comentario[];
    setMsgs(lista);
    const paths = lista.flatMap(m => (m.anexos ?? []).map(a => a.path)).filter(Boolean);
    if (paths.length) {
      const { data: assinadas } = await supabase.storage.from(BUCKET_ANEXOS).createSignedUrls(paths, 3600);
      const m: Record<string, string> = {};
      (assinadas ?? []).forEach((s, i) => { if (s.signedUrl) m[paths[i]] = s.signedUrl; });
      setUrls(m);
    }
  }, [modulo, entidadeId]);

  useEffect(() => {
    carregar();
    // O outro lado responde com a tela aberta; sem isto a resposta só
    // apareceria no próximo F5.
    const t = setInterval(carregar, 8000);
    return () => clearInterval(t);
  }, [carregar]);

  useEffect(() => { fimRef.current?.scrollIntoView({ block: "nearest" }); }, [msgs.length]);

  const juntar = (files: File[]) => {
    setErro("");
    for (const f of files) { const e = erroDoAnexo(f); if (e) { setErro(e); return; } }
    setPendentes(p => [...p, ...files]);
  };

  // Ctrl+V com imagem na área de transferência: vira anexo pendente. Texto
  // colado continua caindo no input normalmente.
  const aoColar = (e: ClipboardEvent) => {
    const files = arquivosDaColagem(e.clipboardData?.items).map(f => new File([f], nomeDeColagem(f), { type: f.type }));
    if (files.length) { e.preventDefault(); juntar(files); }
  };

  // Ctrl+C com uma imagem selecionada no fio: copia o PNG.
  const aoTeclar = async (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "c" || !selecionada) return;
    if (window.getSelection()?.toString()) return; // texto marcado tem prioridade
    e.preventDefault();
    const ok = await copiarImagem(urls[selecionada] ?? "");
    setAviso2(ok ? "Imagem copiada." : "Não consegui copiar a imagem.");
    setTimeout(() => setAviso2(""), 2500);
  };

  const enviar = async () => {
    const t = texto.trim();
    if ((!t && pendentes.length === 0) || enviando || entidadeId == null) return;
    setEnviando(true);
    setErro("");
    const anexos: AnexoRef[] = [];
    for (const f of pendentes) {
      const path = caminhoAnexo(modulo, entidadeId, f.name);
      const { error: up } = await supabase.storage.from(BUCKET_ANEXOS).upload(path, f, { upsert: false, contentType: f.type || undefined });
      if (up) { setEnviando(false); setErro(`Falha ao subir "${f.name}": ${up.message}`); return; }
      anexos.push({ nome: f.name, path, tipo: f.type || null, tamanho: f.size });
    }
    const { error } = await db.from("SISTEMA_COMENTARIOS").insert({
      modulo, entidade_id: String(entidadeId), texto: t,
      autor_nome: nome, autor_cpf: user?.email ?? "", anexos,
    });
    setEnviando(false);
    if (error) { setErro(error.message); return; }
    setTexto(""); setPendentes([]);
    carregar();
  };

  const podeEnviar = !!texto.trim() || pendentes.length > 0;

  return (
    <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16 }} onKeyDown={aoTeclar} tabIndex={-1}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: aviso ? 4 : 10 }}>
        💬 Conversa
      </div>
      {aviso && <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 10 }}>{aviso}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12, maxHeight: 320, overflowY: "auto" }}>
        {msgs.length === 0 ? (
          <div style={{ fontSize: 12, color: "#64748b", textAlign: "center", padding: "12px 0" }}>
            Nenhuma mensagem ainda.
          </div>
        ) : msgs.map((m) => {
          const minha = !!user?.email && m.autor_cpf === user.email;
          const anexos = m.anexos ?? [];
          return (
            <div key={m.id} style={{ alignSelf: minha ? "flex-end" : "flex-start", maxWidth: "75%" }}>
              <div style={{ fontSize: 13, color: "#64748b", padding: "0 2px", textAlign: minha ? "right" : "left" }}>
                {m.autor_nome}
              </div>
              <div style={{
                background: minha ? "#0f3171" : "#f1f5f9", color: minha ? "#fff" : "#0f172a",
                borderRadius: 12, padding: "8px 12px", fontSize: 13,
                whiteSpace: "pre-wrap", overflowWrap: "anywhere",
              }}>
                {m.texto}
                {anexos.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: m.texto ? 6 : 0 }}>
                    {anexos.map(a => {
                      const url = urls[a.path];
                      if (ehImagem(a.tipo, a.nome)) {
                        const sel = selecionada === a.path;
                        return (
                          <div key={a.path} style={{ position: "relative" }}>
                            {url ? (
                              <img src={url} alt={a.nome} title={`${a.nome} — clique e Ctrl+C para copiar`}
                                onClick={() => setSelecionada(sel ? null : a.path)}
                                style={{ maxWidth: "100%", maxHeight: 260, borderRadius: 8, display: "block", cursor: "pointer", outline: sel ? "3px solid #f59e0b" : "none" }} />
                            ) : <span style={{ fontSize: 12.5, opacity: .7 }}>carregando imagem…</span>}
                            <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                              <button onClick={async () => { const ok = await copiarImagem(url ?? ""); setAviso2(ok ? "Imagem copiada." : "Não consegui copiar a imagem."); setTimeout(() => setAviso2(""), 2500); }}
                                style={{ border: "none", borderRadius: 6, background: minha ? "rgba(255,255,255,.18)" : "#e2e8f0", color: "inherit", fontSize: 13.5, fontWeight: 700, padding: "2px 8px", cursor: "pointer" }}>📋 Copiar</button>
                              {url && <a href={url} target="_blank" rel="noopener noreferrer" style={{ borderRadius: 6, background: minha ? "rgba(255,255,255,.18)" : "#e2e8f0", color: "inherit", fontSize: 13.5, fontWeight: 700, padding: "2px 8px", textDecoration: "none" }}>Abrir</a>}
                            </div>
                          </div>
                        );
                      }
                      return (
                        <a key={a.path} href={url ?? "#"} target="_blank" rel="noopener noreferrer"
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, padding: "5px 9px", background: minha ? "rgba(255,255,255,.14)" : "#fff", border: minha ? "none" : "1px solid #e2e8f0", color: "inherit", textDecoration: "none", fontSize: 12, fontWeight: 700 }}>
                          📎 {a.nome}<span style={{ fontWeight: 500, opacity: .7 }}>{fmtTamanho(a.tamanho)}</span>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 13, color: "#64748b", padding: "0 2px", textAlign: minha ? "right" : "left" }}>
                {fmt(m.created_at)}
              </div>
            </div>
          );
        })}
        <div ref={fimRef} />
      </div>

      {pendentes.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {pendentes.map((f, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#eef4ff", border: "1px solid #dbe4f0", borderRadius: 8, padding: "4px 8px", fontSize: 13, color: "#0f3171", fontWeight: 700 }}>
              {ehImagem(f.type, f.name) ? "🖼️" : "📎"} {f.name} <span style={{ fontWeight: 500, color: "#64748b" }}>{fmtTamanho(f.size)}</span>
              <button onClick={() => setPendentes(p => p.filter((_, j) => j !== i))} title="Remover" style={{ border: "none", background: "none", color: "#64748b", cursor: "pointer", padding: 0 }}>✕</button>
            </span>
          ))}
        </div>
      )}
      {erro && <div style={{ fontSize: 12.5, color: "#dc2626", marginBottom: 8 }}>{erro}</div>}
      {aviso2 && <div style={{ fontSize: 12.5, color: "#15803d", marginBottom: 8 }}>{aviso2}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <input ref={inputRef} type="file" multiple style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.length) juntar(Array.from(e.target.files)); e.target.value = ""; }} />
        <button onClick={() => inputRef.current?.click()} title="Anexar arquivo ou foto (ou cole uma imagem com Ctrl+V)"
          style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 14, cursor: "pointer" }}>📎</button>
        <input
          value={texto} onChange={(e) => setTexto(e.target.value)}
          onPaste={aoColar}
          onKeyDown={(e) => { if (e.key === "Enter") enviar(); }}
          placeholder="Escreva uma mensagem… (Ctrl+V cola uma imagem)"
          style={{ flex: 1, border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 12px", fontSize: 13, outline: "none", fontFamily: "inherit" }}
        />
        <button onClick={enviar} disabled={enviando || !podeEnviar}
          style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: podeEnviar ? "#0f3171" : "#cbd5e1", color: "#fff", fontSize: 13, fontWeight: 700, cursor: podeEnviar ? "pointer" : "default", fontFamily: "inherit" }}>
          {enviando ? "..." : "Enviar"}
        </button>
      </div>
    </div>
  );
}
