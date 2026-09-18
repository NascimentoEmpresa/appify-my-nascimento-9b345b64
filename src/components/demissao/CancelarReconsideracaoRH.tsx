import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET, MOTIVO_CANCELAMENTO_MIN, caminhoAnexoCancelamento, podeCancelarDemissaoRH } from "@/lib/demissao/solicitacao";
import { fmtTamanho } from "@/lib/solicitacoes/anexos";

// =====================================================================
// CANCELAR | RECONSIDERAÇÃO — pelo RH, no card de "Pendente RH"
// (18/09/2026). Diferente do botão do encarregado (CancelarDemissao.tsx):
//   • explica (motivo obrigatório) e pode ANEXAR arquivo (o pedido de
//     reconsideração assinado, o e-mail do gestor…);
//   • confirma DUAS vezes antes de executar — cancelar aqui encerra o
//     pedido de outra pessoa;
//   • só enquanto está Pendente RH (podeCancelarDemissaoRH; o banco repete
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
    const sobreVaga = vaga === "cancelada"
      ? " A vaga de Substituição que ainda não tinha aberto foi cancelada junto."
      : vaga === "mantida" ? " A vaga de Substituição já está em seleção — avise o Recrutamento se ela não for mais necessária." : "";
    avisar(`Solicitação #${solicitacao.id} cancelada (reconsideração). O solicitante foi avisado.${sobreVaga}`, "ok");
    setPasso(0); setMotivo(""); setArquivos([]);
    onCancelada();
  };

  const nome = solicitacao.colaborador_nome ?? "—";
  const solicitante = solicitacao.solicitante_nome;

  return (
    <div style={{ border: "2px solid #dc2626", background: "#fef2f2", borderRadius: 12, padding: 16, display: "grid", gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 900, color: "#b91c1c", textTransform: "uppercase", letterSpacing: ".4px" }}>🚫 Cancelar | Reconsideração</div>
      <div style={{ fontSize: 13.5, color: "#7f1d1d" }}>
        Use quando a demissão de <b>{nome}</b> foi <b>reconsiderada</b> (o colaborador fica). A solicitação é encerrada como{" "}
        <b>CANCELADA</b>, o motivo vai pro fio da conversa e {solicitante ? <b>{solicitante}</b> : "quem solicitou"} recebe um aviso.
        Não é devolver: não volta pra ninguém corrigir.
      </div>

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
            A solicitação #{solicitacao.id} não segue pro SST e não pode ser reaberta — se a demissão voltar a acontecer, o encarregado abre um pedido novo.
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
            {solicitante ? <> e <b>{solicitante}</b> será avisado</> : null}.
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
