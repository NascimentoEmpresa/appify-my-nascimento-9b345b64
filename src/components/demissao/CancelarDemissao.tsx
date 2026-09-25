import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MOTIVO_CANCELAMENTO_MIN, STATUS_CANCELAMENTO_SOLICITADO, podeCancelarDemissao } from "@/lib/demissao/solicitacao";

// =====================================================================
// CANCELAR (reconsiderar) uma solicitação de demissão — botão + diálogo
// (17/09/2026). O mesmo nos dois lugares em que o encarregado vê as
// demissões dele: Solicitar Demissão e Minhas Solicitações.
//
// Clicou → "Tem certeza que deseja reconsiderar? Informe o motivo" → RPC
// demissao_cancelar. Quando não pode, o clique explica em vez de abrir o
// diálogo.
//
// DESDE 25/09/2026 (mig 239) O ENCARREGADO PEDE, O RH APROVA: a RPC não
// cancela mais na hora — põe a solicitação em "Cancelamento solicitado" e o
// RH recebe no sino. O RH aprova ou recusa em Solicitações de Demissão
// (BlocoDecidirCancelamentoRH, em CancelarReconsideracaoRH.tsx).
// =====================================================================

const db = supabase as unknown as SupabaseClient;

export function BotaoCancelarDemissao({ solicitacao, onCancelada, avisar, compacto }: {
  solicitacao: { id: number; status: string; colaborador_nome?: string | null };
  onCancelada: () => void;
  /** Toast da tela que hospeda o botão. */
  avisar: (msg: string, tipo: "ok" | "err" | "info") => void;
  compacto?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const regra = podeCancelarDemissao(solicitacao);

  const clicar = () => {
    if (!regra.ok) { avisar(regra.motivo ?? "Não é possível cancelar.", "err"); return; }
    setMotivo(""); setAberto(true);
  };

  const confirmar = async () => {
    if (motivo.trim().length < MOTIVO_CANCELAMENTO_MIN) { avisar(`Informe o motivo da reconsideração (mín. ${MOTIVO_CANCELAMENTO_MIN} caracteres).`, "err"); return; }
    setSalvando(true);
    const { data, error } = await db.rpc("demissao_cancelar", { p_id: solicitacao.id, p_motivo: motivo.trim() });
    setSalvando(false);
    if (error) { avisar(error.message, "err"); return; }
    setAberto(false);
    const ret = data as { vaga?: string | null; por?: string | null } | null;
    if (ret?.por === "pedido") {
      avisar(`Pedido de cancelamento da solicitação #${solicitacao.id} enviado ao RH. Você será avisado quando o RH decidir.`, "ok");
    } else {
      const vaga = ret?.vaga;
      avisar(`Solicitação #${solicitacao.id} cancelada.${vaga === "cancelada" ? " A vaga de Substituição que ainda não tinha aberto foi cancelada junto." : vaga === "mantida" ? " A vaga de Substituição já está em seleção — avise o Recrutamento se ela não for mais necessária." : ""}`, "ok");
    }
    onCancelada();
  };

  return (
    <>
      <button onClick={clicar} title={regra.ok ? "Reconsiderar: pedir ao RH o cancelamento desta solicitação de demissão" : regra.motivo}
        style={{ padding: compacto ? "4px 10px" : "7px 12px", borderRadius: 8, border: "1px solid #fecaca", background: regra.ok ? "#fff" : "#f8fafc", color: regra.ok ? "#b91c1c" : "#94a3b8", fontSize: compacto ? 11 : 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
        🚫 Solicitar cancelamento
      </button>
      {aberto && (
        <div onClick={e => { if (e.target === e.currentTarget) setAberto(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 800, background: "rgba(15,23,42,.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 26, width: "100%", maxWidth: 520, boxShadow: "0 20px 50px rgba(15,23,42,.25)", color: "#0f172a" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#b91c1c", textTransform: "uppercase", letterSpacing: ".4px" }}>🚫 Cancelar solicitação de demissão #{solicitacao.id}</div>
            <div style={{ fontSize: 19, fontWeight: 900, margin: "6px 0 4px" }}>Tem certeza que deseja reconsiderar?</div>
            <div style={{ fontSize: 13.5, color: "#475569", marginBottom: 12 }}>
              O pedido de cancelamento{solicitacao.colaborador_nome ? <> da demissão de <b>{solicitacao.colaborador_nome}</b></> : ""} vai para o <b>RH aprovar</b>.
              Até o RH decidir, a solicitação fica parada; se ele recusar, ela continua de onde estava.
            </div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: "#1e293b", marginBottom: 6 }}>Informe o motivo abaixo *</label>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={4} autoFocus
              placeholder="Ex.: o colaborador reconsiderou e vai continuar; o aviso foi retirado em acordo com o gestor…"
              style={{ width: "100%", border: "1.5px solid #94a3b8", borderRadius: 12, padding: "11px 13px", fontSize: 14.5, boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button onClick={() => setAberto(false)} disabled={salvando} style={{ padding: "9px 16px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Voltar</button>
              <button onClick={confirmar} disabled={salvando} style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{salvando ? "Enviando…" : "Sim, pedir o cancelamento ao RH"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const fmtQuando = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";

/**
 * O pedido de cancelamento esperando o RH — ou a recusa dele, depois que a
 * solicitação voltou pro status de antes (25/09/2026). Pra qualquer card que
 * mostre a solicitação.
 */
export function AvisoPedidoCancelamento({ solicitacao }: { solicitacao: {
  status: string; cancel_pedido_por?: string | null; cancel_pedido_em?: string | null; cancel_pedido_motivo?: string | null;
  cancel_status_anterior?: string | null; cancel_recusa_por?: string | null; cancel_recusa_em?: string | null; cancel_recusa_motivo?: string | null;
} }) {
  if (solicitacao.status === STATUS_CANCELAMENTO_SOLICITADO) {
    const quando = fmtQuando(solicitacao.cancel_pedido_em);
    return (
      <div style={{ border: "2px solid #dc2626", background: "#fef2f2", borderRadius: 12, padding: "10px 14px" }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: "#b91c1c", textTransform: "uppercase", letterSpacing: ".5px" }}>
          🚫 Cancelamento solicitado{solicitacao.cancel_pedido_por ? ` por ${solicitacao.cancel_pedido_por}` : ""}{quando ? ` · ${quando}` : ""} — aguardando o RH
        </div>
        {solicitacao.cancel_pedido_motivo && <div style={{ fontSize: 14, color: "#7f1d1d", marginTop: 4, whiteSpace: "pre-wrap" }}>{solicitacao.cancel_pedido_motivo}</div>}
        {solicitacao.cancel_status_anterior && <div style={{ fontSize: 12, color: "#991b1b", marginTop: 4 }}>Estava em: {solicitacao.cancel_status_anterior}</div>}
      </div>
    );
  }
  if (solicitacao.cancel_recusa_em && solicitacao.status !== "Cancelada") {
    return (
      <div style={{ border: "1px solid #fca5a5", background: "#fff7f7", borderRadius: 12, padding: "10px 14px" }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#b91c1c" }}>
          ↩ Pedido de cancelamento recusado pelo RH{solicitacao.cancel_recusa_por ? ` (${solicitacao.cancel_recusa_por})` : ""} · {fmtQuando(solicitacao.cancel_recusa_em)}
        </div>
        {solicitacao.cancel_recusa_motivo && <div style={{ fontSize: 13.5, color: "#7f1d1d", marginTop: 3, whiteSpace: "pre-wrap" }}>{solicitacao.cancel_recusa_motivo}</div>}
      </div>
    );
  }
  return null;
}

/** O motivo do cancelamento, em vermelho, pra qualquer card que mostre a solicitação. */
export function AvisoCancelada({ solicitacao }: { solicitacao: { status: string; cancelado_por?: string | null; cancelado_em?: string | null; cancelado_motivo?: string | null } }) {
  if (solicitacao.status !== "Cancelada") return null;
  const quando = solicitacao.cancelado_em ? new Date(solicitacao.cancelado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
  return (
    <div style={{ border: "2px solid #dc2626", background: "#fef2f2", borderRadius: 12, padding: "10px 14px" }}>
      <div style={{ fontSize: 13, fontWeight: 900, color: "#b91c1c", textTransform: "uppercase", letterSpacing: ".5px" }}>🚫 Cancelado{solicitacao.cancelado_por ? ` por ${solicitacao.cancelado_por}` : ""}{quando ? ` · ${quando}` : ""}</div>
      {solicitacao.cancelado_motivo && <div style={{ fontSize: 14, color: "#7f1d1d", marginTop: 4, whiteSpace: "pre-wrap" }}>{solicitacao.cancelado_motivo}</div>}
    </div>
  );
}
