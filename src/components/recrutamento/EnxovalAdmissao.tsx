import { forwardRef, useCallback, useEffect, useImperativeHandle, useState, type CSSProperties } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useContratosCatalogo, useFuncoes, usePostos } from "@/hooks/useSupCatalogo";
import { NAO_PRECISA, faltandoTamanho, resumoLivre, type ItemEnxoval } from "@/lib/recrutamento/enxoval";
import { enviarFotoCracha } from "@/hooks/useSupPedidos";
import { BUCKET_CRACHAS } from "@/lib/suprimentos/fotoCracha";

// =====================================================================
// Enxoval da função ao mandar o candidato pra SST + COMPRAS
// (25/09/2026, mig 20260930000246).
//
// Os itens vêm do Catálogo (Suprimentos › Catálogo de Materiais) pela vaga:
// contrato → posto → função. O Recrutamento só informa os TAMANHOS — na
// grade que o Catálogo tem pra cada item; item sem grade (óculos, máscara)
// não pede. "Não precisa" tira o item (a função tem peça feminina e
// masculina; cada candidato leva uma).
//
// Vaga antiga, sem o Catálogo: escolhe-se contrato/posto/função aqui (a RPC
// grava de volta na vaga). Função sem enxoval cadastrado: volta o campo de
// texto livre de antes, pra o pedido não chegar vazio no Compras.
//
// O pai (modal de mover candidato) chama `enviar()` no Confirmar: grava via
// rec_enxoval_informar e recebe o resumo que vai para compras_necessidades.
//
// 14/10/2026 (mig 20261014000045, Pablo: "tem que ser anexado a imagem do
// candidato pro crachá e a quantidade de itens"): FOTO DO CRACHÁ obrigatória
// (bucket sup-crachas, vai junto no pedido de materiais) e QUANTIDADE de cada
// item — antes todo item ia com 1.
// =====================================================================

const db = supabase as unknown as SupabaseClient;

interface Preview {
  vaga_id: number | null; cargo: string | null; contrato_texto: string | null; vaga_tem_catalogo: boolean;
  contrato_id: string | null; posto_id: string | null; funcao_id: string | null;
  contrato_nome: string | null; posto_nome: string | null; funcao_nome: string | null;
  itens: ItemEnxoval[]; observacoes: string | null; ja_informado: boolean; tem_pedido: boolean;
  foto_cracha_path?: string | null;
}

export interface EnxovalAdmissaoHandle {
  /** Grava o enxoval. `resumo` vai para compras_necessidades (null = não mexer). */
  // Sem união discriminada: o projeto roda sem strict, e o TS não estreita por `ok`.
  enviar: () => Promise<{ ok: boolean; resumo?: string | null; erro?: string; foto?: string | null }>;
}

const fi: CSSProperties = { width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", fontSize: 13 };
const chip = (on: boolean, cor = "#0f3171"): CSSProperties => ({
  minWidth: 34, padding: "4px 8px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer",
  border: `1.5px solid ${on ? cor : "#cbd5e1"}`, background: on ? cor : "#fff", color: on ? "#fff" : "#334155",
});

export const EnxovalAdmissao = forwardRef<EnxovalAdmissaoHandle, { candidatoId: number }>(function EnxovalAdmissao({ candidatoId }, ref) {
  const [prev, setPrev] = useState<Preview | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [escolha, setEscolha] = useState({ contrato_id: "", posto_id: "", funcao_id: "" });
  const [tamanhos, setTamanhos] = useState<Record<string, string>>({});
  const [obs, setObs] = useState("");
  const [livre, setLivre] = useState("");
  const [qtds, setQtds] = useState<Record<string, number>>({});
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);

  const { data: contratos = [] } = useContratosCatalogo(!!prev && !prev.vaga_tem_catalogo);
  const { data: postos = [] } = usePostos(escolha.contrato_id || null);
  const { data: funcoes = [], isSuccess: funcoesCarregadas } = useFuncoes(escolha.posto_id || null);

  const carregar = useCallback(async (ids?: { contrato_id: string; posto_id: string; funcao_id: string }) => {
    setCarregando(true); setErro(null);
    const { data, error } = await db.rpc("rec_enxoval_preview", {
      p_candidato_id: candidatoId,
      p_contrato_id: ids?.contrato_id || null, p_posto_id: ids?.posto_id || null, p_funcao_id: ids?.funcao_id || null,
    });
    setCarregando(false);
    if (error) { setErro(error.message); return; }
    const p = data as Preview;
    setPrev(p);
    setEscolha({ contrato_id: p.contrato_id ?? "", posto_id: p.posto_id ?? "", funcao_id: p.funcao_id ?? "" });
    setTamanhos(Object.fromEntries((p.itens ?? []).filter((i) => i.tamanho).map((i) => [i.item_id, i.tamanho as string])));
    setQtds(Object.fromEntries((p.itens ?? []).map((i) => [i.item_id, Math.max(1, Number(i.quantidade) || 1)])));
    setObs(p.observacoes ?? "");
  }, [candidatoId]);
  useEffect(() => { carregar(); }, [carregar]);

  // Prévia da foto: a nova escolhida agora, senão a que já estava anexada.
  useEffect(() => {
    if (foto) { const u = URL.createObjectURL(foto); setFotoUrl(u); return () => URL.revokeObjectURL(u); }
    const caminho = prev?.foto_cracha_path;
    if (!caminho) { setFotoUrl(null); return; }
    let vivo = true;
    db.storage.from(BUCKET_CRACHAS).createSignedUrl(caminho, 600)
      .then(({ data }) => { if (vivo) setFotoUrl(data?.signedUrl ?? null); });
    return () => { vivo = false; };
  }, [foto, prev?.foto_cracha_path]);

  const itens = prev?.itens ?? [];
  const semEnxoval = !!prev?.funcao_id && itens.length === 0;

  useImperativeHandle(ref, () => ({
    enviar: async () => {
      if (!prev) return { ok: false, erro: erro ?? "O enxoval ainda está carregando." };
      if (prev.tem_pedido) return { ok: true, resumo: null };
      if (!escolha.contrato_id || !escolha.posto_id || !escolha.funcao_id) {
        return { ok: false, erro: "Escolha o contrato, o posto e a função do Catálogo para puxar o enxoval." };
      }
      if (!foto && !prev.foto_cracha_path) return { ok: false, erro: "Anexe a foto do candidato para o crachá." };
      if (semEnxoval && !livre.trim()) return { ok: false, erro: "A função não tem enxoval no Catálogo — descreva os materiais/EPIs para o Compras." };
      const faltam = semEnxoval ? [] : faltandoTamanho(itens, tamanhos);
      if (faltam.length) return { ok: false, erro: `Informe o tamanho de: ${faltam.join(", ")}.` };
      if (!semEnxoval && itens.every((i) => tamanhos[i.item_id] === NAO_PRECISA)) return { ok: false, erro: "Marque ao menos um item do enxoval." };
      // A foto sobe só depois de tudo validado — senão cada tentativa deixava um arquivo solto no bucket.
      let caminhoFoto = prev.foto_cracha_path ?? null;
      if (foto) {
        try { caminhoFoto = await enviarFotoCracha(foto); }
        catch (e) { return { ok: false, erro: "Não consegui enviar a foto do crachá: " + ((e as Error)?.message ?? e) }; }
      }
      if (semEnxoval) return { ok: true, resumo: resumoLivre(prev.funcao_nome, livre), foto: caminhoFoto };
      const { data, error } = await db.rpc("rec_enxoval_informar", {
        p_candidato_id: candidatoId, p_contrato_id: escolha.contrato_id, p_posto_id: escolha.posto_id, p_funcao_id: escolha.funcao_id,
        p_itens: itens.map((i) => ({ item_id: i.item_id, tamanho: tamanhos[i.item_id] ?? null, quantidade: qtds[i.item_id] ?? 1 })),
        // A observação para o Compras vem do modal (rec_enxoval_gerar_pedido, 15/10/2026).
        p_obs: null,
        p_foto_path: caminhoFoto,
      });
      if (error) return { ok: false, erro: error.message };
      return { ok: true, resumo: (data as { resumo?: string } | null)?.resumo ?? null, foto: caminhoFoto };
    },
  }), [prev, erro, escolha, semEnxoval, livre, itens, tamanhos, qtds, foto, obs, candidatoId]);

  if (carregando && !prev) return <div style={{ padding: 16, textAlign: "center", color: "#64748b", fontSize: 13 }}>Carregando o enxoval da função…</div>;
  if (erro && !prev) return <div style={{ padding: 12, color: "#b91c1c", fontSize: 13, background: "#fef2f2", borderRadius: 8 }}>Não consegui carregar o enxoval: {erro}</div>;
  if (!prev) return null;

  return (
    <div style={{ border: "1px solid #fed7aa", background: "#fffbf5", borderRadius: 12, padding: 12, marginBottom: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: "#9a3412", textTransform: "uppercase", letterSpacing: ".4px" }}>🦺 Enxoval da função — para o Compras</div>

      {prev.vaga_tem_catalogo ? (
        <div style={{ fontSize: 12.5, color: "#7c2d12", marginTop: 4 }}>
          {prev.contrato_nome} › {prev.posto_nome} › <b>{prev.funcao_nome}</b>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          <div style={{ fontSize: 12, color: "#9a3412" }}>
            Esta vaga é anterior ao Catálogo{prev.contrato_texto ? ` (${prev.contrato_texto})` : ""}. Escolha contrato, posto e função para puxar o enxoval:
          </div>
          <select style={fi} value={escolha.contrato_id} onChange={(e) => { const v = { contrato_id: e.target.value, posto_id: "", funcao_id: "" }; setEscolha(v); setPrev((p) => p && { ...p, itens: [], funcao_id: null }); }}>
            <option value="">Contrato…</option>
            {contratos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <select style={fi} value={escolha.posto_id} disabled={!escolha.contrato_id} onChange={(e) => { setEscolha((s) => ({ ...s, posto_id: e.target.value, funcao_id: "" })); setPrev((p) => p && { ...p, itens: [], funcao_id: null }); }}>
            <option value="">Posto…</option>
            {postos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
          <select style={fi} value={escolha.funcao_id} disabled={!escolha.posto_id}
            onChange={(e) => { const v = { ...escolha, funcao_id: e.target.value }; setEscolha(v); if (v.funcao_id) carregar(v); }}>
            <option value="">Função…</option>
            {funcoes.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
          {/* 15/10/2026: posto sem função no Catálogo deixava o select vazio, sem explicar nada. */}
          {escolha.posto_id && funcoesCarregadas && funcoes.length === 0 && (
            <div style={{ fontSize: 12, color: "#9a3412", background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: "7px 10px" }}>
              Este posto não tem função cadastrada no Catálogo (Suprimentos), então não há enxoval para puxar.
              Se a função não usa EPI/uniforme, marque <b>"Não precisa de pedido do Compras"</b> acima e diga o motivo.
            </div>
          )}
        </div>
      )}

      {prev.tem_pedido && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: "#15803d", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: "7px 10px" }}>
          ✓ O Compras já gerou o pedido de materiais deste candidato — os tamanhos não mudam mais por aqui.
        </div>
      )}

      {/* Foto do crachá (14/10/2026): obrigatória — vai no pedido de materiais. */}
      {!prev.tem_pedido && (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, background: "#fff", border: `1px solid ${fotoUrl ? "#e2e8f0" : "#fdba74"}`, borderRadius: 10, padding: "8px 10px" }}>
          <div style={{ width: 52, height: 64, flexShrink: 0, borderRadius: 8, overflow: "hidden", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
            {fotoUrl ? <img src={fotoUrl} alt="Foto do crachá" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "🪪"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Foto do candidato para o crachá *</div>
            <div style={{ fontSize: 11.5, color: "#64748b" }}>{foto ? foto.name : prev.foto_cracha_path ? "Foto já anexada — troque se precisar." : "Foto de rosto, fundo claro (JPG ou PNG)."}</div>
          </div>
          <label style={{ ...chip(false), padding: "6px 10px", display: "inline-flex", alignItems: "center", cursor: "pointer" }}>
            {fotoUrl ? "Trocar" : "Anexar foto"}
            <input type="file" accept="image/*" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) setFoto(f); e.target.value = ""; }} />
          </label>
        </div>
      )}

      {carregando && <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>Atualizando…</div>}

      {!prev.tem_pedido && itens.length > 0 && (
        <div style={{ marginTop: 10, display: "grid", gap: 8, maxHeight: "44vh", overflowY: "auto", paddingRight: 2 }}>
          {itens.map((it) => {
            const t = tamanhos[it.item_id] ?? "";
            const naoPrecisa = t === NAO_PRECISA;
            const temGrade = it.grade.length > 0;
            const pendente = temGrade && !t;
            return (
              <div key={it.item_id} style={{ background: "#fff", border: `1px solid ${pendente ? "#fdba74" : "#e2e8f0"}`, borderRadius: 10, padding: "8px 10px", opacity: naoPrecisa ? .55 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", textDecoration: naoPrecisa ? "line-through" : "none" }}>{it.nome}</div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>{it.tipo}{!temGrade && !naoPrecisa ? " · sem tamanho" : ""}</div>
                  </div>
                  {!naoPrecisa && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto" }} title="Quantidade">
                      <button type="button" style={{ ...chip(false), minWidth: 26, padding: "2px 6px" }}
                        onClick={() => setQtds((q) => ({ ...q, [it.item_id]: Math.max(1, (q[it.item_id] ?? 1) - 1) }))}>−</button>
                      <input type="number" min={1} max={99} value={qtds[it.item_id] ?? 1} aria-label={`Quantidade de ${it.nome}`}
                        onChange={(e) => { const v = Math.max(1, Math.min(99, Number(e.target.value) || 1)); setQtds((q) => ({ ...q, [it.item_id]: v })); }}
                        style={{ width: 44, padding: "3px 4px", textAlign: "center", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 13, fontWeight: 700 }} />
                      <button type="button" style={{ ...chip(false), minWidth: 26, padding: "2px 6px" }}
                        onClick={() => setQtds((q) => ({ ...q, [it.item_id]: Math.min(99, (q[it.item_id] ?? 1) + 1) }))}>+</button>
                    </div>
                  )}
                  <button type="button" onClick={() => setTamanhos((s) => { const n = { ...s }; if (naoPrecisa) delete n[it.item_id]; else n[it.item_id] = NAO_PRECISA; return n; })}
                    style={{ ...chip(naoPrecisa, "#64748b"), fontWeight: 600, fontSize: 11 }} title="Este candidato não leva este item">
                    Não precisa
                  </button>
                </div>
                {temGrade && !naoPrecisa && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
                    {it.grade.map((g) => (
                      <button key={g} type="button" style={chip(t === g)} onClick={() => setTamanhos((s) => ({ ...s, [it.item_id]: g }))}>{g}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {semEnxoval && !prev.tem_pedido && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: "#9a3412", marginBottom: 4 }}>A função <b>{prev.funcao_nome}</b> ainda não tem enxoval no Catálogo. Descreva o que o Compras deve providenciar *</div>
          <textarea rows={3} style={{ ...fi, resize: "vertical" }} value={livre} onChange={(e) => setLivre(e.target.value)}
            placeholder="Ex.: 2 uniformes tam. M, botina 42, luva de raspa…" />
        </div>
      )}

      {/* A observação para o Compras está no modal (15/10/2026) — vai no pedido. */}
      <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 6 }}>Ao enviar, o pedido de materiais é gerado na hora em Suprimentos › Pedidos de Materiais.</div>
    </div>
  );
});
