import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CAMPOS_ASO, EDITAVEIS_ASO, dataBrDaFicha, faltandoNaFicha, rotuloAso, type FichaAso as Ficha } from "@/lib/recrutamento/fichaAso";

// =====================================================================
// FICHA DO ASO ADMISSIONAL (chamado do SST, 18/09/2026)
// O SST pediu pra receber SÓ os 15 dados da solicitação do exame — nada de
// salário, benefícios, requisitos, perfil. O banco monta a ficha
// (rec_ficha_aso, mig 191), automático; o que ele não acha aparece em
// vermelho e o Recrutamento preenche no kanban (`editar`), gravando em
// WA_CURRICULOS. No SST (`editar` = false) é só leitura, com o mesmo aviso.
// =====================================================================

const db = supabase as unknown as SupabaseClient;

export function FichaAso({ candidatoId, editar, compacto, onMudou }: {
  candidatoId: number;
  /** Recrutamento: mostra os campos vazios como inputs e salva. */
  editar?: boolean;
  /** No card do kanban: só a linha de status (completa / faltam N). */
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

  if (erro) return <div style={{ fontSize: 12, color: "#b91c1c" }}>Ficha do ASO: {erro}</div>;
  if (!ficha) return <div style={{ fontSize: 12, color: "#94a3b8" }}>Montando a ficha do ASO…</div>;

  const statusLinha = faltando.length === 0
    ? <span style={{ fontSize: 10.5, fontWeight: 800, color: "#15803d" }}>🩺 Ficha do ASO completa</span>
    : <span style={{ fontSize: 10.5, fontWeight: 800, color: "#b91c1c" }}>🩺 Ficha do ASO: falta{faltando.length > 1 ? "m" : ""} {faltando.map(rotuloAso).join(", ")}</span>;

  if (compacto && !aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} title="Abrir a ficha que vai pro SST"
        style={{ width: "100%", textAlign: "left", background: faltando.length ? "#fef2f2" : "#f0fdf4", border: `1px solid ${faltando.length ? "#fecaca" : "#bbf7d0"}`, borderRadius: 8, padding: "5px 8px", cursor: "pointer", fontFamily: "inherit" }}>
        {statusLinha}
      </button>
    );
  }

  const mostrar = (key: string): string => {
    const v = ficha[key as keyof Ficha];
    if (key === "nascimento") return dataBrDaFicha(v as string | null);
    return v == null ? "" : String(v);
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px", display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px" }}>🩺 Ficha do ASO admissional</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {statusLinha}
          {compacto && <button type="button" onClick={() => setAberto(false)} style={{ border: "none", background: "none", color: "#64748b", cursor: "pointer", fontWeight: 800, fontFamily: "inherit" }}>✕</button>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "6px 14px" }}>
        {CAMPOS_ASO.map(c => {
          const valor = mostrar(c.key);
          const falta = !valor;
          const edit = editar && falta ? EDITAVEIS_ASO.find(e => e.key === c.key) : undefined;
          return (
            <div key={c.key} style={{ fontSize: 12.5, minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: falta ? "#b91c1c" : "#94a3b8", textTransform: "uppercase", letterSpacing: ".3px" }}>{c.label}</div>
              {edit ? (
                <input type={edit.tipo ?? "text"} value={form[c.key] ?? ""} onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))}
                  placeholder="Preencher…"
                  style={{ width: "100%", boxSizing: "border-box", border: "1.5px solid #fca5a5", borderRadius: 8, padding: "5px 8px", fontSize: 12.5, fontFamily: "inherit", background: "#fff5f5" }} />
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
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "#64748b" }}>Função, contrato e cidade vêm da vaga — corrige-se lá.</span>
          <button type="button" onClick={salvar} disabled={salvando || !Object.values(form).some(v => v.trim())}
            style={{ border: "none", borderRadius: 9, background: "#0f3171", color: "#fff", fontWeight: 800, fontSize: 12.5, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit" }}>
            {salvando ? "Salvando…" : "Salvar na ficha"}
          </button>
        </div>
      )}
    </div>
  );
}
