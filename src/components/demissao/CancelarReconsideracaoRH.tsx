import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET, MOTIVO_CANCELAMENTO_MIN, STATUS_SST_AGENDADO, STATUS_SST_ASO_VALIDO, caminhoAnexoCancelamento, cancelarAvisaSST, podeCancelarDemissaoRH, temPedidoDeCancelamento } from "@/lib/demissao/solicitacao";
import { fmtTamanho } from "@/lib/solicitacoes/anexos";

// =====================================================================
// CANCELAR | RECONSIDERAÇÃO — pelo RH, no card de "Pendente RH"
// (18/09/2026) e, desde 21/09/2026, também com a solicitação no SST (aí o
// SST é avisado no sino para desmarcar o ASO — mig 198). Diferente do botão do encarregado (CancelarDemissao.tsx):
//   • explica (motivo obrigatório) e pode ANEXAR arquivo (o pedido de
//     reconsideração assinado, o e-mail do gestor…);
//   • confirma DUAS vezes antes de executar — cancelar aqui encerra o
//     pedido de outra pessoa;
//   • de Pendente RH até o ASO agendado (podeCancelarDemissaoRH; o banco repete
//     com has_screen_access('rh_demissoes','aprovar') na mig 186).
// Os arquivos sobem no bucket demissoes-docs ANTES da RPC; ela grava as
// linhas em Documentos com o prefixo "Cancelamento —", escreve no fio da
// conversa e avisa o solicitante no sino. Se a RPC falhar, os arquivos
// que subiram são removidos — não fica documento órfão de um cancelamento
// que não aconteceu.
// =====================================================================

const db = supabase as unknown as SupabaseClient;
const MAX_BYTES = 25 * 1024 * 1024;

interface Enviado { nome: string; storage_path: string; tamanho: number; tipo: string | null }

const rotulo: CSSProperties = { display: "block", fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: "#1e293b", marginBottom: 6 };
const campo: CSSProperties = { width: "100%", border: "1.5px solid #94a3b8", borderRadius: 10, padding: "10px 12px", fontSize: 14, boxSizing: "border-box", fontFamily: "inherit", background: "#fff", color: "#0f172a", resize: "vertical" };
const btn = (fundo: string, cor: string, borda = "none"): CSSProperties =>
  ({ padding: "9px 16px", borderRadius: 10, border: borda, background: fundo, color: cor, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" });

export function BlocoCancelarReconsideracaoRH({ solicitacao, onCancelada, avisar }: {
  solicitacao: { id: number; status: string; colaborador_nome?: string | null; solicitante_nome?: string | null };
  onCancelada: () => void;
  /** Toast da tela que hospeda o bloco. */
  avisar: (msg: string, tipo: "ok" | "err" | "info") => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  // 0 = formulário · 1 = primeira confirmação · 2 = segunda (definitiva)
  const [passo, setPasso] = useState<0 | 1 | 2>(0);
  const [salvando, setSalvando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const regra = podeCancelarDemissaoRH(solicitacao);
  if (!regra.ok) return null;

  const escolher = (lista: FileList | null) => {
    if (!lista) return;
    const novos = Array.from(lista);
    const grande = novos.find((f) => f.size > MAX_BYTES);
    if (grande) { avisar(`"${grande.name}" tem ${fmtTamanho(grande.size)} — o limite é 25 MB.`, "err"); return; }
    setArquivos((a) => [...a, ...novos]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const iniciar = () => {
    if (motivo.trim().length < MOTIVO_CANCELAMENTO_MIN) {
      avisar(`Explique o motivo da reconsideração (mín. ${MOTIVO_CANCELAMENTO_MIN} caracteres).`, "err");
      return;
    }
    setPasso(1);
  };

  const executar = async () => {
    setSalvando(true);
    const enviados: Enviado[] = [];
    const desfazer = async () => { if (enviados.length) await supabase.storage.from(BUCKET).remove(enviados.map((e) => e.storage_path)); };
    // 1) Sobe os arquivos (se houver). Falhou um → não cancela nada, e avisa.
    for (const f of arquivos) {
      const caminho = caminhoAnexoCancelamento(solicitacao.id, f.name);
      const { error } = await supabase.storage.from(BUCKET).upload(caminho, f);
      if (error) {
        await desfazer();
        setSalvando(false);
        avisar(`Não consegui enviar "${f.name}": ${error.message}. Nada foi cancelado — tente de novo.`, "err");
        return;
      }
      enviados.push({ nome: f.name, storage_path: caminho, tamanho: f.size, tipo: f.type || null });
    }
    // 2) Cancela — a RPC grava os anexos, escreve no fio e avisa o solicitante.
    const { data, error } = await db.rpc("demissao_cancelar", { p_id: solicitacao.id, p_motivo: motivo.trim(), p_anexos: enviados });
    setSalvando(false);
    if (error) { await desfazer(); avisar(error.message, "err"); return; }
    const vaga = (data as { vaga?: string | null } | null)?.vaga;
    const nSST = Number((data as { sst_avisados?: number } | null)?.sst_avisados ?? 0);
    const sobreSST = noSST ? (nSST > 0 ? ` O SST foi avisado (${nSST} pessoa(s)) para cancelar o agendamento do ASO.` : " Ninguém tem a tela ASO Demissional liberada — avise o SST diretamente.") : "";
    const sobreVaga = vaga === "cancelada"
      ? " A vaga de Substituição que ainda não tinha aberto foi cancelada junto."
      : vaga === "mantida" ? " A vaga de Substituição já está em seleção — avise o Recrutamento se ela não for mais necessária." : "";
    avisar(`Solicitação #${solicitacao.id} cancelada (reconsideração). O solicitante foi avisado.${sobreSST}${sobreVaga}`, "ok");
    setPasso(0); setMotivo(""); setArquivos([]);
    onCancelada();
  };

  const nome = solicitacao.colaborador_nome ?? "—";
  const noSST = cancelarAvisaSST(solicitacao.status);
  const agendado = solicitacao.status === STATUS_SST_AGENDADO;
  const asoValido = solicitacao.status === STATUS_SST_ASO_VALIDO;
  const solicitante = solicitacao.solicitante_nome;

  return (
    <div style={{ border: "2px solid #dc2626", background: "#fef2f2", borderRadius: 12, padding: 16, display: "grid", gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 900, color: "#b91c1c", textTransform: "uppercase", letterSpacing: ".4px" }}>🚫 Cancelar | Reconsideração</div>
      <div style={{ fontSize: 13.5, color: "#7f1d1d" }}>
        Use quando a demissão de <b>{nome}</b> foi <b>reconsiderada</b> (o colaborador fica). A solicitação é encerrada como{" "}
        <b>CANCELADA</b>, o motivo vai pro fio da conversa e {solicitante ? <b>{solicitante}</b> : "quem solicitou"} recebe um aviso.
        Não é devolver: não volta pra ninguém corrigir.
      </div>
      {asoValido && (
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px" }}>
          O SST já concluiu esta solicitação (ASO válido, sem exame demissional). Cancelar desfaz a demissão; não há agendamento a desmarcar, então o SST não é avisado.
        </div>
      )}
      {noSST && (
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px" }}>
          A solicitação já está no SST ({solicitacao.status}). Ao cancelar, o SST recebe um aviso para{" "}
          {agendado ? "desmarcar o ASO demissional que já foi agendado" : "não agendar o ASO demissional"}.
        </div>
      )}

      {passo === 0 && (
        <>
          <div>
            <label htmlFor="rh-cancel-motivo" style={rotulo}>Explique o motivo da reconsideração <span style={{ color: "#dc2626" }}>*</span></label>
            <textarea id="rh-cancel-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} style={campo}
              placeholder="Ex.: o gestor reconsiderou o aviso em acordo com o colaborador; pedido de reconsideração recebido em…" />
          </div>
          <div>
            <label htmlFor="rh-cancel-anexo" style={rotulo}>
              Anexar arquivo <span style={{ fontWeight: 600, textTransform: "none", color: "#64748b" }}>(opcional — pedido assinado, e-mail do gestor…)</span>
            </label>
            <input id="rh-cancel-anexo" ref={inputRef} type="file" multiple onChange={(e) => escolher(e.target.files)} style={{ fontSize: 13, fontFamily: "inherit" }} />
            {arquivos.length > 0 && (
              <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
                {arquivos.map((f, i) => (
                  <li key={`${f.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, background: "#fff", border: "1px solid #fecaca", borderRadius: 8, padding: "5px 10px" }}>
                    <span>📎</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    <span style={{ color: "#64748b", fontSize: 12 }}>{fmtTamanho(f.size)}</span>
                    <button type="button" onClick={() => setArquivos((a) => a.filter((_, j) => j !== i))} title="Remover"
                      style={{ border: "none", background: "transparent", color: "#b91c1c", cursor: "pointer", fontWeight: 800, fontFamily: "inherit" }}>✕</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <button type="button" onClick={iniciar} style={btn("#fff", "#b91c1c", "1.5px solid #dc2626")}>🚫 Cancelar solicitação (reconsideração)</button>
          </div>
        </>
      )}

      {passo === 1 && (
        <div style={{ background: "#fff", border: "1.5px solid #dc2626", borderRadius: 10, padding: 14, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: "#0f172a" }}>Tem certeza que deseja cancelar a demissão de {nome}?</div>
          <div style={{ fontSize: 13.5, color: "#475569" }}>
            {noSST
              ? <>A solicitação #{solicitacao.id} sai da fila do SST{agendado ? ", o ASO agendado precisa ser desmarcado" : ""} e não pode ser reaberta — se a demissão voltar a acontecer, o encarregado abre um pedido novo.</>
              : <>A solicitação #{solicitacao.id} não segue pro SST e não pode ser reaberta — se a demissão voltar a acontecer, o encarregado abre um pedido novo.</>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setPasso(0)} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Voltar</button>
            <button type="button" onClick={() => setPasso(2)} style={btn("#fff", "#b91c1c", "1.5px solid #dc2626")}>Sim, quero cancelar</button>
          </div>
        </div>
      )}

      {passo === 2 && (
        <div style={{ background: "#fff", border: "2px solid #dc2626", borderRadius: 10, padding: 14, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: "#b91c1c", textTransform: "uppercase", letterSpacing: ".4px" }}>Última confirmação</div>
          <div style={{ fontSize: 14, color: "#0f172a" }}>
            A solicitação <b>#{solicitacao.id}</b> ficará <b style={{ color: "#dc2626" }}>CANCELADA</b>
            {solicitante ? <> e <b>{solicitante}</b> será avisado</> : null}
            {noSST ? <>; o <b>SST</b> recebe o aviso para {agendado ? "desmarcar" : "não agendar"} o ASO</> : null}.
          </div>
          <div style={{ fontSize: 13.5, color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", whiteSpace: "pre-wrap" }}>
            <b>Motivo:</b> {motivo.trim()}
            {arquivos.length > 0 && <><br /><b>Anexos:</b> {arquivos.map((f) => f.name).join(", ")}</>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setPasso(1)} disabled={salvando} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Voltar</button>
            <button type="button" onClick={executar} disabled={salvando} style={btn("#dc2626", "#fff")}>
              {salvando ? "Cancelando…" : "Confirmo — cancelar definitivamente"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// PEDIDO DE CANCELAMENTO do encarregado — o RH aprova ou recusa
// (25/09/2026, mig 239). Aparece no card quando a solicitação está em
// "Cancelamento solicitado"; o RH chega aqui pelo sino (link com ?abrir=).
//   • Aprovar: a RPC demissao_decidir_cancelamento cancela com o motivo do
//     encarregado — vaga de Substituição que nem abriu cai junto e, se
//     estava no SST, o SST é avisado para desmarcar o ASO.
//   • Recusar: observação obrigatória; a solicitação volta pro status de
//     antes e o encarregado recebe o porquê no sino.
// O banco repete a regra (rh_demissoes/aprovar).
// =====================================================================
export function BlocoDecidirCancelamentoRH({ solicitacao, onDecidido, avisar }: {
  solicitacao: {
    id: number; status: string; colaborador_nome?: string | null; solicitante_nome?: string | null;
    cancel_pedido_por?: string | null; cancel_pedido_em?: string | null; cancel_pedido_motivo?: string | null; cancel_status_anterior?: string | null;
  };
  onDecidido: () => void;
  avisar: (msg: string, tipo: "ok" | "err" | "info") => void;
}) {
  const [obs, setObs] = useState("");
  const [confirmando, setConfirmando] = useState<"aprovar" | "recusar" | null>(null);
  const [salvando, setSalvando] = useState(false);
  if (!temPedidoDeCancelamento(solicitacao)) return null;

  const anterior = solicitacao.cancel_status_anterior ?? "—";
  const quem = solicitacao.cancel_pedido_por || solicitacao.solicitante_nome || "O solicitante";
  const quando = solicitacao.cancel_pedido_em ? new Date(solicitacao.cancel_pedido_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
  const noSST = cancelarAvisaSST(anterior);

  const pedir = (acao: "aprovar" | "recusar") => {
    if (acao === "recusar" && obs.trim().length < MOTIVO_CANCELAMENTO_MIN) {
      avisar(`Explique ao solicitante por que o cancelamento foi recusado (mín. ${MOTIVO_CANCELAMENTO_MIN} caracteres).`, "err");
      return;
    }
    setConfirmando(acao);
  };

  const decidir = async () => {
    if (!confirmando) return;
    setSalvando(true);
    const { data, error } = await db.rpc("demissao_decidir_cancelamento", {
      p_id: solicitacao.id, p_aprovar: confirmando === "aprovar", p_observacao: obs.trim() || null,
    });
    setSalvando(false);
    if (error) { avisar(error.message, "err"); return; }
    if (confirmando === "aprovar") {
      const ret = data as { vaga?: string | null; sst_avisados?: number } | null;
      const nSST = Number(ret?.sst_avisados ?? 0);
      avisar(`Cancelamento aprovado: a solicitação #${solicitacao.id} está CANCELADA e o solicitante foi avisado.`
        + (noSST ? (nSST > 0 ? ` O SST foi avisado (${nSST} pessoa(s)) para desmarcar o ASO.` : " Ninguém tem a tela ASO Demissional liberada — avise o SST diretamente.") : "")
        + (ret?.vaga === "cancelada" ? " A vaga de Substituição que ainda não tinha aberto foi cancelada junto." : ret?.vaga === "mantida" ? " A vaga de Substituição já está em seleção — avise o Recrutamento se ela não for mais necessária." : ""), "ok");
    } else {
      avisar(`Cancelamento recusado: a solicitação #${solicitacao.id} voltou para "${anterior}" e o solicitante foi avisado.`, "ok");
    }
    setConfirmando(null); setObs("");
    onDecidido();
  };

  return (
    <div style={{ border: "2px solid #dc2626", background: "#fef2f2", borderRadius: 12, padding: 16, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden style={{ width: 34, height: 34, borderRadius: 999, background: "#dc2626", color: "#fff", display: "grid", placeItems: "center", fontSize: 18, flexShrink: 0 }}>🚫</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 900, color: "#b91c1c", textTransform: "uppercase", letterSpacing: ".4px" }}>Pedido de cancelamento — decisão do RH</div>
          <div style={{ fontSize: 12.5, color: "#991b1b" }}>{quem}{quando ? ` · ${quando}` : ""} · estava em <b>{anterior}</b></div>
        </div>
      </div>
      <div style={{ fontSize: 14, color: "#7f1d1d", background: "#fff", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 10px", whiteSpace: "pre-wrap" }}>
        <b>Motivo:</b> {solicitacao.cancel_pedido_motivo || "—"}
      </div>
      {noSST && (
        <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px" }}>
          A solicitação estava no SST ({anterior}). Aprovando, o SST recebe o aviso para {anterior === STATUS_SST_AGENDADO ? "desmarcar o ASO já agendado" : "não agendar o ASO"}.
        </div>
      )}
      <div>
        <label htmlFor="rh-decide-obs" style={rotulo}>Observação <span style={{ fontWeight: 600, textTransform: "none", color: "#64748b" }}>(obrigatória para recusar — vai pro solicitante)</span></label>
        <textarea id="rh-decide-obs" value={obs} onChange={(e) => { setObs(e.target.value); setConfirmando(null); }} rows={2} style={campo}
          placeholder="Ex.: o acerto já foi feito; o colaborador confirmou que sai…" />
      </div>
      {!confirmando ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => pedir("aprovar")} style={btn("#dc2626", "#fff")}>🚫 Aprovar cancelamento</button>
          <button type="button" onClick={() => pedir("recusar")} style={btn("#fff", "#475569", "1px solid #cbd5e1")}>↩ Recusar — a demissão continua</button>
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1.5px solid #dc2626", borderRadius: 10, padding: 12, display: "grid", gap: 8 }}>
          <div style={{ fontSize: 14, color: "#0f172a" }}>
            {confirmando === "aprovar"
              ? <>Confirma? A demissão de <b>{solicitacao.colaborador_nome ?? "—"}</b> fica <b style={{ color: "#dc2626" }}>CANCELADA</b> e não pode ser reaberta.</>
              : <>Confirma? O pedido é recusado e a solicitação volta para <b>{anterior}</b>.</>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setConfirmando(null)} disabled={salvando} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Voltar</button>
            <button type="button" onClick={decidir} disabled={salvando} style={confirmando === "aprovar" ? btn("#dc2626", "#fff") : btn("#0f172a", "#fff")}>
              {salvando ? "Salvando…" : confirmando === "aprovar" ? "Confirmo — cancelar a demissão" : "Confirmo — recusar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
