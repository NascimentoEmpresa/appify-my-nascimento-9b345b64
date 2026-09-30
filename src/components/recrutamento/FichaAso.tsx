import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CAMPOS_ASO, EDITAVEIS_ASO, dataBrDaFicha, faltandoNaFicha, rotuloAso, type FichaAso as Ficha } from "@/lib/recrutamento/fichaAso";
import { createPortal } from "react-dom";
import { ChevronRight, Stethoscope, X } from "lucide-react";

// =====================================================================
// FICHA DO ASO ADMISSIONAL (chamado do SST, 18/09/2026)
// O SST pediu pra receber SÓ os 15 dados da solicitação do exame — nada de
// salário, benefícios, requisitos, perfil. O banco monta a ficha
// (rec_ficha_aso, mig 191), automático; o que ele não acha aparece em
// vermelho e o Recrutamento preenche no kanban (`editar`), gravando em
// WA_CURRICULOS. No SST (`editar` = false) é só leitura, com o mesmo aviso.
//
// Kanban (30/09/2026): a ficha abria DENTRO do card (~150px de largura) —
// o grid de 230px estourava, o texto cortava e virava um card dentro do
// card. No `compacto` o card mostra só o selo e a ficha abre num modal.
// Modal próprio (portal, zIndex 1000) e não o Dialog do shadcn: o kanban já
// é um overlay em zIndex 800, e o Dialog (z-50) abriria ATRÁS dele.
// =====================================================================

const db = supabase as unknown as SupabaseClient;

const Icone = () => <Stethoscope size={12} strokeWidth={2} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5, flexShrink: 0 }} />;

export function FichaAso({ candidatoId, editar, compacto, onMudou }: {
  candidatoId: number;
  /** Recrutamento: mostra os campos vazios como inputs e salva. */
  editar?: boolean;
  /** No card do kanban: só o selo (completa / faltam N); a ficha abre num modal. */
  compacto?: boolean;
  onMudou?: () => void;
}) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto] = useState(false);

  const carregar = useCallback(async () => {
    const { data, error } = await db.rpc("rec_ficha_aso", { _candidato_id: candidatoId });
    if (error) { setErro(error.message); return; }
    setFicha(data as Ficha); setErro(null);
  }, [candidatoId]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aberto]);

  const faltando = faltandoNaFicha(ficha);

  const salvar = async () => {
    const patch: Record<string, string | null> = {};
    for (const e of EDITAVEIS_ASO) {
      const v = (form[e.key] ?? "").trim();
      if (v) patch[e.coluna] = v;
    }
    if (!Object.keys(patch).length) return;
    setSalvando(true);
    const { error } = await db.from("WA_CURRICULOS").update(patch).eq("id", candidatoId);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setForm({}); await carregar(); onMudou?.();
  };

  if (erro) return <div style={{ fontSize: 11, color: "#b91c1c", overflowWrap: "anywhere" }}>Ficha do ASO: {erro}</div>;
  if (!ficha) return <div style={{ fontSize: 11, color: "#94a3b8" }}>Montando a ficha do ASO…</div>;

  const completa = faltando.length === 0;
  const cor = completa ? "#15803d" : "#b91c1c";
  const statusLongo = completa
    ? <span style={{ fontSize: 11, fontWeight: 800, color: cor }}><Icone />Ficha do ASO completa</span>
    : <span style={{ fontSize: 11, fontWeight: 800, color: cor }}><Icone />Falta{faltando.length > 1 ? "m" : ""}: {faltando.map(rotuloAso).join(", ")}</span>;

  const mostrar = (key: string): string => {
    const v = ficha[key as keyof Ficha];
    if (key === "nascimento") return dataBrDaFicha(v as string | null);
    return v == null ? "" : String(v);
  };

  const corpo = (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "10px 18px" }}>
        {CAMPOS_ASO.map(c => {
          const valor = mostrar(c.key);
          const falta = !valor;
          const edit = editar && falta ? EDITAVEIS_ASO.find(e => e.key === c.key) : undefined;
          return (
            <div key={c.key} style={{ fontSize: 12.5, minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: falta ? "#b91c1c" : "#94a3b8", textTransform: "uppercase", letterSpacing: ".3px", marginBottom: 2 }}>{c.label}</div>
              {edit ? (
                <input type={edit.tipo ?? "text"} value={form[c.key] ?? ""} onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))}
                  placeholder="Preencher…"
                  style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid #fca5a5", borderRadius: 8, padding: "6px 9px", fontSize: 12.5, fontFamily: "inherit", background: "#fff5f5" }} />
              ) : (
                <div style={{ color: falta ? "#b91c1c" : "#0f172a", fontWeight: falta ? 800 : 600, overflowWrap: "anywhere" }}>
                  {falta ? "— não encontrado · o Recrutamento preenche no kanban" : valor}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editar && faltando.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center", borderTop: "1px solid #f1f5f9", paddingTop: 10 }}>
          <span style={{ fontSize: 11.5, color: "#64748b" }}>Função, contrato e cidade vêm da vaga — corrige-se lá.</span>
          <button type="button" onClick={salvar} disabled={salvando || !Object.values(form).some(v => v.trim())}
            style={{ border: "none", borderRadius: 9, background: "#0f3171", color: "#fff", fontWeight: 800, fontSize: 12.5, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit", opacity: salvando || !Object.values(form).some(v => v.trim()) ? .5 : 1 }}>
            {salvando ? "Salvando…" : "Salvar na ficha"}
          </button>
        </div>
      )}
    </div>
  );

  // ── Kanban: selo curto no card + ficha no modal ──
  if (compacto) {
    return (
      <>
        <button type="button" onClick={() => setAberto(true)} title={completa ? "Ver a ficha que vai pro SST" : `Faltam: ${faltando.map(rotuloAso).join(", ")}`}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 4, textAlign: "left", background: completa ? "#f0fdf4" : "#fef2f2",
                   border: `1px solid ${completa ? "#bbf7d0" : "#fecaca"}`, borderRadius: 8, padding: "5px 7px", cursor: "pointer", fontFamily: "inherit",
                   fontSize: 10.5, fontWeight: 800, color: cor, lineHeight: 1.25 }}>
          <Stethoscope size={12} strokeWidth={2} aria-hidden style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0 }}>{completa ? "Ficha do ASO completa" : `Ficha do ASO: falta${faltando.length > 1 ? `m ${faltando.length}` : " 1"}`}</span>
          <ChevronRight size={12} aria-hidden style={{ flexShrink: 0, opacity: .7 }} />
        </button>
        {aberto && createPortal(
          <div role="dialog" aria-modal="true" aria-label="Ficha do ASO admissional"
            onClick={e => { if (e.target === e.currentTarget) setAberto(false); }}
            style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.5)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 24px 60px rgba(15,23,42,.3)", width: "100%", maxWidth: 720, maxHeight: "85vh", overflowY: "auto", padding: "18px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#0f3171", display: "flex", alignItems: "center", gap: 7 }}>
                    <Stethoscope size={17} strokeWidth={2} aria-hidden /> Ficha do ASO admissional
                  </div>
                  <div style={{ marginTop: 4 }}>{statusLongo}</div>
                </div>
                <button type="button" onClick={() => setAberto(false)} aria-label="Fechar"
                  style={{ border: "none", background: "#f1f5f9", borderRadius: 8, width: 30, height: 30, display: "grid", placeItems: "center", cursor: "pointer", color: "#475569", flexShrink: 0 }}>
                  <X size={16} />
                </button>
              </div>
              {corpo}
            </div>
          </div>,
          document.body,
        )}
      </>
    );
  }

  // ── Página do SST (largura cheia): a ficha inline ──
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px", display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px" }}><Icone />Ficha do ASO admissional</div>
        {statusLongo}
      </div>
      {corpo}
    </div>
  );
}
