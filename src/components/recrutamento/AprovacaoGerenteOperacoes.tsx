// Arquivo: src/components/recrutamento/AprovacaoGerenteOperacoes.tsx
//
// Fila do GERENTE DE OPERAÇÕES (chamado #0848, Fernanda, 11/11/2026): toda
// vaga de Admissão nova nasce "Pendente Gerente Operações" — dentro ou acima
// do quantitativo cotado — e só segue o fluxo normal depois da aprovação dele.
//
// Fica no topo da Gestão de Recrutamento (qualquer escopo), e só aparece para
// quem tem a capacidade "GERENTE DE OPERAÇÕES — APROVA ADMISSÕES" (Operacional,
// Administração › Acesso por Usuário). A lista e a decisão são RPCs do banco
// (rec_gerente_operacoes_pendentes / rec_gerente_operacoes_decidir, mig
// 20261111235500): não dependem do recorte de escopo da tela nem da RLS de
// vaga administrativa — o gerente aprova também a admissão do escritório.
import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";
import { MENU_GERENTE_APROVA_ADMISSAO } from "@/lib/recrutamento/vagaRegras";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";

const db = supabase as unknown as SupabaseClient;

export type AdmissaoPendente = {
  id: number;
  created_at: string;
  solicitante_nome: string | null;
  contrato: string | null;
  cargo: string | null;
  cidade: string | null;
  estado: string | null;
  quantidade_vagas: string | null;
  data_inicio_prevista: string | null;
  reserva_tecnica: boolean;
  administrativa: boolean;
  quantitativo_ativos: number | null;
  quantitativo_cotado: number | null;
  quantitativo_justificativa: string | null;
};

const fmtData = (v?: string | null) => {
  if (!v) return "—";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
};

export function AprovacaoGerenteOperacoes({ onToast, onDecidido }: {
  onToast: (msg: string, tipo?: string) => void;
  /** A tela recarrega a lista/estatísticas dela. */
  onDecidido?: () => void;
}) {
  const { can } = usePermissoes();
  const ehGerente = can("aprovar", undefined, MENU_GERENTE_APROVA_ADMISSAO);
  const [linhas, setLinhas] = useState<AdmissaoPendente[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [reprovando, setReprovando] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    if (!ehGerente) return;
    setCarregando(true);
    const { data, error } = await db.rpc("rec_gerente_operacoes_pendentes");
    setCarregando(false);
    if (error) { onToast("Admissões aguardando aprovação: " + error.message, "err"); return; }
    setLinhas((data ?? []) as AdmissaoPendente[]);
  }, [ehGerente, onToast]);
  useEffect(() => { carregar(); }, [carregar]);

  const decidir = async (id: number, aprovar: boolean) => {
    if (!aprovar && motivo.trim().length < 3) { onToast("Informe o motivo da reprovação.", "err"); return; }
    setSalvando(id);
    const { data, error } = await db.rpc("rec_gerente_operacoes_decidir", {
      p_id: id, p_aprovar: aprovar, p_motivo: aprovar ? null : motivo.trim(),
    });
    setSalvando(null);
    if (error) { onToast("Erro: " + error.message, "err"); return; }
    onToast(aprovar
      ? `Admissão #${id} aprovada — seguiu para ${data === "Pendente Diretoria" ? "a Diretoria" : "a aprovação do Operacional"}.`
      : `Admissão #${id} reprovada.`, "ok");
    setReprovando(null); setMotivo("");
    carregar();
    onDecidido?.();
  };

  if (!ehGerente) return null;

  return (
    <section aria-label="Admissões aguardando o Gerente de Operações"
      style={{ marginBottom: 16, border: "1.5px solid #c7d7f5", borderRadius: 14, background: "#fff", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 16px", background: "#eef4ff", borderBottom: "1px solid #c7d7f5" }}>
        <ShieldCheck size={18} aria-hidden style={{ color: "#0f3171" }} />
        <div style={{ fontSize: 14.5, fontWeight: 800, color: "#0f3171" }}>
          Admissões aguardando sua aprovação {carregando ? "…" : `(${linhas.length})`}
        </div>
        <div style={{ marginLeft: "auto", fontSize: 12.5, color: "#475569" }}>Gerente de Operações</div>
      </div>
      {!carregando && linhas.length === 0 ? (
        <div style={{ padding: "12px 16px", fontSize: 13.5, color: "#64748b" }}>Nenhuma admissão aguardando aprovação.</div>
      ) : (
        <div style={{ display: "grid" }}>
          {linhas.map(l => {
            const acima = l.quantitativo_ativos != null && l.quantitativo_cotado != null && l.quantitativo_ativos > l.quantitativo_cotado;
            return (
              <div key={l.id} style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", display: "grid", gap: 6 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", alignItems: "baseline" }}>
                  <b style={{ fontSize: 14 }}>#{l.id} · {l.cargo || "—"}</b>
                  <span style={{ fontSize: 13, color: "#334155" }}>{l.contrato || "—"}</span>
                  <span style={{ fontSize: 12.5, color: "#64748b" }}>
                    {[l.cidade, l.estado].filter(Boolean).join("/") || "—"} · {l.quantidade_vagas || 1} vaga(s) · início {fmtData(l.data_inicio_prevista)}
                    {l.reserva_tecnica ? " · RT" : ""}{l.administrativa ? " · escritório" : ""}
                  </span>
                  <span style={{ fontSize: 12.5, color: "#64748b" }}>Pedida por {l.solicitante_nome || "—"} em {fmtData(l.created_at)}</span>
                </div>
                {l.quantitativo_cotado != null && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: acima ? "#b45309" : "#15803d", display: "flex", gap: 6, alignItems: "flex-start" }}>
                    {acima ? <AlertTriangle size={15} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} /> : <CheckCircle2 size={15} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />}
                    <span>
                      {l.quantitativo_ativos} ativos para {l.quantitativo_cotado} cotados{acima ? " — acima do quantitativo." : " — dentro do quantitativo."}
                      {acima && l.quantitativo_justificativa && <span style={{ display: "block", fontWeight: 500, color: "#334155", marginTop: 2 }}>Justificativa e quem autorizou: {l.quantitativo_justificativa}</span>}
                    </span>
                  </div>
                )}
                {reprovando === l.id ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    <textarea rows={2} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo da reprovação"
                      style={{ width: "100%", border: "1.5px solid #94a3b8", borderRadius: 10, padding: "8px 10px", fontFamily: "inherit", fontSize: 13.5 }} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" disabled={salvando === l.id} onClick={() => decidir(l.id, false)}
                        style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Confirmar reprovação</button>
                      <button type="button" onClick={() => { setReprovando(null); setMotivo(""); }}
                        style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: "#475569", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={() => { setReprovando(l.id); setMotivo(""); }}
                      style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Reprovar</button>
                    <button type="button" disabled={salvando === l.id} onClick={() => decidir(l.id, true)}
                      style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{salvando === l.id ? "Aprovando…" : "✓ Aprovar"}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
