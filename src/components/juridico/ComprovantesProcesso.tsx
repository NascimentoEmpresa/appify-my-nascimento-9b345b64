import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUCKET_COMPROVANTES, BUCKET_MALOTE, caminhoComprovante, comprovantesDaDespesa, resumoPagamentos, rotuloStatusMalote,
  type PagamentosDoProcesso,
} from "@/lib/juridico/comprovantes";

// =====================================================================
// COMPROVANTES DE PAGAMENTO DO PROCESSO (18/09/2026, mig 193)
// Três fontes, numa lista só:
//   1. Malote, automático — despesas cujo nome traz o número CNJ do processo
//      (é assim que o Financeiro lança: "ACORDO PARCELA 6 DE 8 … PROCESSO
//      0020268-73…"). Nada a fazer: aparece sozinho.
//   2. Malote, manual — a despesa existe mas não cita o número: o Jurídico
//      informa o "DM-2026-0921" e o vínculo fica gravado.
//   3. Arquivo avulso — quando não há nada no Malote. Sobe pro bucket
//      juridico-comprovantes.
// O comprovante do Malote é aberto por URL assinada do bucket dele — não
// se sobe o mesmo arquivo de novo.
// =====================================================================

const db = supabase as unknown as SupabaseClient;
const money = (v: unknown) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDt = (s?: string | null) => { if (!s) return "—"; const d = new Date(String(s).length <= 10 ? s + "T12:00:00" : s); return isNaN(+d) ? String(s) : d.toLocaleDateString("pt-BR"); };

async function abrir(bucket: string, path: string, avisar: (m: string) => void) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) { avisar("Não consegui abrir o comprovante: " + (error?.message ?? "sem URL")); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

export function ComprovantesProcesso({ processoId, numeroProcesso, toast }: {
  processoId: number;
  numeroProcesso: string;
  toast: (msg: string, tipo?: string) => void;
}) {
  const [dados, setDados] = useState<PagamentosDoProcesso | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [vincNum, setVincNum] = useState("");
  const [vinculando, setVinculando] = useState(false);
  const [mostrarVinc, setMostrarVinc] = useState(false);
  const [subindo, setSubindo] = useState(false);
  const [descricao, setDescricao] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await db.rpc("jur_processo_pagamentos", { _processo_id: processoId });
    if (error) { setErro(error.message); return; }
    setErro(null); setDados(data as PagamentosDoProcesso);
  }, [processoId]);
  useEffect(() => { carregar(); }, [carregar]);

  const vincular = async () => {
    const n = vincNum.trim();
    if (!n) { toast("Informe o número da despesa do Malote (ex.: DM-2026-0921).", "err"); return; }
    setVinculando(true);
    const { data, error } = await db.rpc("jur_processo_vincular_despesa", { _processo_id: processoId, _numero_despesa: n });
    setVinculando(false);
    if (error) { toast(error.message, "err"); return; }
    const d = data as { numero: string; tem_comprovante: boolean };
    toast(`Despesa ${d.numero} vinculada ao processo${d.tem_comprovante ? "" : " (ainda sem comprovante no Malote)"}.`, "ok");
    setVincNum(""); setMostrarVinc(false); carregar();
  };

  const desvincular = async (vinculoId: number) => {
    const { error } = await db.from("JUR_PROCESSO_MALOTE_VINCULO").delete().eq("id", vinculoId);
    if (error) { toast(error.message, "err"); return; }
    toast("Vínculo removido.", "ok"); carregar();
  };

  const subir = async (files: FileList | null) => {
    if (!files?.length) return;
    setSubindo(true);
    for (const f of Array.from(files)) {
      if (f.size > 25 * 1024 * 1024) { toast(`"${f.name}" passa de 25 MB.`, "err"); continue; }
      const caminho = caminhoComprovante(processoId, f.name);
      const up = await supabase.storage.from(BUCKET_COMPROVANTES).upload(caminho, f);
      if (up.error) { toast(`Não consegui enviar "${f.name}": ${up.error.message}`, "err"); continue; }
      const { data: perfil } = await db.from("profiles").select("display_name, email").eq("id", (await supabase.auth.getUser()).data.user?.id ?? "").maybeSingle();
      const { error } = await db.from("JUR_PROCESSO_COMPROVANTE").insert({
        processo_id: processoId, nome: f.name, storage_path: caminho, tipo: f.type || null, tamanho: f.size,
        descricao: descricao.trim() || null, criado_por_nome: perfil?.display_name ?? perfil?.email ?? null,
      });
      if (error) { await supabase.storage.from(BUCKET_COMPROVANTES).remove([caminho]); toast(error.message, "err"); continue; }
    }
    setSubindo(false); setDescricao("");
    if (fileRef.current) fileRef.current.value = "";
    toast("Comprovante anexado ao processo.", "ok"); carregar();
  };

  const apagarAnexo = async (id: number, path: string) => {
    if (!confirm("Remover este comprovante do processo?")) return;
    const { error } = await db.from("JUR_PROCESSO_COMPROVANTE").delete().eq("id", id);
    if (error) { toast(error.message, "err"); return; }
    await supabase.storage.from(BUCKET_COMPROVANTES).remove([path]);
    toast("Comprovante removido.", "ok"); carregar();
  };

  const r = resumoPagamentos(dados);
  const avisar = (m: string) => toast(m, "err");

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", marginBottom: 14, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", background: "linear-gradient(90deg,#f8fafc,#fff)", borderBottom: "1px solid #eef2f7" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px" }}>💳 Pagamentos e comprovantes</div>
          <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>
            {dados ? <>{r.despesas} no Malote{r.pagos ? ` · ${r.pagos} pago${r.pagos > 1 ? "s" : ""} (${money(r.totalPago)})` : ""} · {r.anexos} anexado{r.anexos === 1 ? "" : "s"} à mão</> : erro ? <span style={{ color: "#b91c1c" }}>{erro}</span> : "Procurando no Malote…"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setMostrarVinc(v => !v)} style={{ padding: "6px 11px", borderRadius: 9, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#3730a3", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>🔗 Vincular despesa do Malote</button>
          <label style={{ padding: "6px 11px", borderRadius: 9, border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#15803d", fontSize: 12, fontWeight: 700, cursor: subindo ? "wait" : "pointer" }}>
            📎 {subindo ? "Enviando…" : "Anexar comprovante"}
            <input ref={fileRef} type="file" multiple accept=".pdf,image/*" style={{ display: "none" }} disabled={subindo} onChange={e => subir(e.target.files)} />
          </label>
        </div>
      </div>

      {mostrarVinc && (
        <div style={{ padding: "10px 14px", background: "#f5f7ff", borderBottom: "1px solid #e0e7ff", display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#3730a3", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>Nº da despesa no Malote</div>
            <input value={vincNum} onChange={e => setVincNum(e.target.value)} placeholder="Ex.: DM-2026-0921" onKeyDown={e => { if (e.key === "Enter") vincular(); }}
              style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid #a5b4fc", borderRadius: 9, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }} />
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Só precisa quando a despesa não cita o nº {numeroProcesso} no nome — as que citam já aparecem sozinhas.</div>
          </div>
          <button type="button" onClick={vincular} disabled={vinculando} style={{ padding: "9px 14px", borderRadius: 9, border: "none", background: "#3730a3", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{vinculando ? "Vinculando…" : "Vincular"}</button>
        </div>
      )}

      <div style={{ padding: "8px 14px 12px" }}>
        {!dados ? null : r.total === 0 ? (
          <div style={{ fontSize: 12.5, color: "#64748b", padding: "8px 0" }}>
            Nenhum pagamento encontrado no Malote para o nº <b>{numeroProcesso}</b>. Quando o Financeiro lançar a despesa com esse número no nome, ela aparece aqui sozinha; se já existe com outro texto, use “Vincular despesa do Malote”.
          </div>
        ) : (<>
          {dados.malote.map(d => {
            const st = rotuloStatusMalote(d.status);
            const comps = comprovantesDaDespesa(d);
            return (
              <div key={d.despesa_id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 12px", padding: "9px 0", borderTop: "1px solid #f1f5f9" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: "#0f3171" }}>{d.numero ?? "—"}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: st.bg, color: st.cor }}>{st.texto}</span>
                    <span title={d.origem === "malote_auto" ? "Casou pelo número do processo no nome da despesa" : "Vinculado à mão"} style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: d.origem === "malote_auto" ? "#ecfeff" : "#f5f3ff", color: d.origem === "malote_auto" ? "#0e7490" : "#6d28d9" }}>
                      {d.origem === "malote_auto" ? "⚡ automático" : "🔗 manual"}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "#0f172a", marginTop: 2, overflowWrap: "anywhere" }}>{d.nome}</div>
                  <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>
                    {d.pago_em ? `Pago em ${fmtDt(d.pago_em)}` : d.data_pagamento ? `Vencimento ${fmtDt(d.data_pagamento)}` : ""}
                    {d.forma_pagamento ? ` · ${d.forma_pagamento}` : ""}
                    {d.parcelas?.length ? ` · ${d.parcelas.length} parcela${d.parcelas.length > 1 ? "s" : ""}` : ""}
                  </div>
                  {comps.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                      {comps.map(c => (
                        <button key={c.path} type="button" onClick={() => abrir(BUCKET_MALOTE, c.path, avisar)}
                          style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#15803d", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                          🧾 {c.rotulo}
                        </button>
                      ))}
                    </div>
                  )}
                  {comps.length === 0 && <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>Sem comprovante no Malote ainda.</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap" }}>{money(d.valor_aprovado ?? d.valor_total)}</div>
                  {d.origem === "malote_manual" && d.vinculo_id && (
                    <button type="button" onClick={() => desvincular(d.vinculo_id!)} style={{ marginTop: 4, border: "none", background: "none", color: "#94a3b8", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>desvincular</button>
                  )}
                </div>
              </div>
            );
          })}
          {dados.anexos.map(a => (
            <div key={a.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 12px", padding: "9px 0", borderTop: "1px solid #f1f5f9" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fef3c7", color: "#b45309" }}>📎 anexado à mão</span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{fmtDt(a.created_at)}{a.criado_por_nome ? ` · ${a.criado_por_nome}` : ""}</span>
                </div>
                <button type="button" onClick={() => abrir(BUCKET_COMPROVANTES, a.storage_path, avisar)} style={{ marginTop: 3, border: "none", background: "none", padding: 0, color: "#0f3171", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textAlign: "left", overflowWrap: "anywhere" }}>🧾 {a.nome}</button>
                {a.descricao && <div style={{ fontSize: 11.5, color: "#64748b" }}>{a.descricao}</div>}
              </div>
              <div style={{ textAlign: "right" }}>
                {a.valor != null && <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0f172a" }}>{money(a.valor)}</div>}
                <button type="button" onClick={() => apagarAnexo(a.id, a.storage_path)} style={{ marginTop: 4, border: "none", background: "none", color: "#94a3b8", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>remover</button>
              </div>
            </div>
          ))}
        </>)}
        {dados && (
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
            <input value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descrição do próximo anexo (opcional) — ex.: guia de depósito recursal"
              style={{ flex: 1, border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 9px", fontSize: 12, fontFamily: "inherit" }} />
          </div>
        )}
      </div>
    </div>
  );
}
