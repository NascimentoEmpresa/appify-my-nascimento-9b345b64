import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { useContratosCatalogo, usePostos, useFuncoes } from "@/hooks/useSupCatalogo";
import {
  CandidatoInfo, Modal, Campo, Acoes, Toasts, btnStyle, PendToggle, EtapaChip, HistoricoCandidato,
} from "@/components/recrutamento/CandidatoInfo";

// =====================================================================
// SUPRIMENTOS — EPIs / Admissões (fila do Recrutamento)
//
// Espelho da tela do SST (/app/sst/aso), do outro lado do processo: aqui o
// Compras providencia os materiais e EPIs de quem está entrando.
//
// POR QUE ESTA TELA EXISTE, e não um botão no kanban do Recrutamento: o
// kanban é do RH e só ele entra lá. Aprovação de Compras tem que acontecer
// onde só o Compras entra — senão o RH assinaria etapa de outro setor, que é
// justamente o controle que a etapa existe para exercer.
//
// SST e Compras correm em PARALELO: os dois recebem o candidato ao mesmo
// tempo e nenhum espera o outro. Por isso esta tela NÃO muda a etapa; ela só
// carimba `compras_ok`. Quem passa para ADMISSÃO é o trigger
// rec_paralelo_admissao, quando o segundo setor aprovar — a primeira tela a
// assinar não tem como saber se é a última.
// =====================================================================

const ETAPAS_PARALELO = ["SST + COMPRAS", "EXAME SST", "COMPRAS"];
const sb = supabase as any;

interface EnxovalDetalhe {
  id: string;
  token: string | null;
  expira_em: string | null;
  preenchido_em: string | null;
  pedido_id: string | null;
  contrato_id: string | null;
  posto_id: string | null;
  funcao_id: string | null;
  sup_admissao_enxoval_item: Array<{
    id: string;
    nome_item: string;
    tamanho: string | null;
    tamanho_informado: string | null;
    quantidade: number;
    ordem: number;
  }>;
}

export default function EpisAdmissoes() {
  const { user } = useAuth();
  const { can } = usePermissoes();
  const { empresa } = useEmpresaAtiva();
  const podeAgir = can("alterar", undefined, "sup_epis_admissao");
  const nome = user?.user_metadata?.nome ?? user?.email ?? "";

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [verTodos, setVerTodos] = useState(false);
  const [acao, setAcao] = useState<{ cand: any; tipo: "providenciar" | "reprovar" } | null>(null);
  const [obs, setObs] = useState("");
  const [toasts, setToasts] = useState<{ id: number; msg: string; t: string }[]>([]);
  const [candidatoEnxoval, setCandidatoEnxoval] = useState<any | null>(null);
  const [selecao, setSelecao] = useState({ contrato_id: "", posto_id: "", funcao_id: "" });
  const [enxoval, setEnxoval] = useState<EnxovalDetalhe | null>(null);
  const [carregandoEnxoval, setCarregandoEnxoval] = useState(false);
  const [salvandoEnxoval, setSalvandoEnxoval] = useState(false);

  const { data: contratosCatalogo = [] } = useContratosCatalogo(empresa.id);
  const { data: postosCatalogo = [] } = usePostos(selecao.contrato_id || null);
  const { data: funcoesCatalogo = [] } = useFuncoes(selecao.posto_id || null);

  const toast = (msg: string, t = "info") => {
    const id = Date.now() + Math.random();
    setToasts(x => [...x, { id, msg, t }]);
    setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 3600);
  };

  const logHist = async (c: any, evento: string, de: string, para: string, detalhe: string | null) => {
    try {
      await (supabase as any).from("RECRUTAMENTO_HISTORICO").insert({
        solicitacao_id: c.vaga_id, candidato_id: c.candidato_id, candidato_nome: c.nome,
        evento, de_status: de, para_status: para, papel: "Suprimentos",
        usuario_nome: nome, usuario_email: user?.email ?? "", detalhe,
      });
    } catch { /* histórico é registro; não pode derrubar a ação */ }
  };

  const load = useCallback(async () => {
    setLoading(true);
    let q = (supabase as any).from("VW_RECRUTAMENTO_CANDIDATOS").select("*");
    // Pendente = na etapa paralela e ainda sem o aval do Compras. Quem já
    // aprovou sai da fila, mesmo que o SST ainda não tenha assinado.
    q = verTodos
      ? q.not("compras_em", "is", null)
      : q.in("etapa_processo", ETAPAS_PARALELO).is("compras_ok", null);
    const { data, error } = await q.order("etapa_changed_at", { ascending: true });
    setLoading(false);
    if (error) { toast("Erro ao carregar: " + error.message, "err"); return; }
    setRows(data ?? []);
  }, [verTodos]);
  useEffect(() => { load(); }, [load]);

  const carregarEnxoval = async (candidatoId: number) => {
    setCarregandoEnxoval(true);
    const { data, error } = await sb
      .from("sup_admissao_enxoval")
      .select("id,token,expira_em,preenchido_em,pedido_id,contrato_id,posto_id,funcao_id,sup_admissao_enxoval_item(id,nome_item,tamanho,tamanho_informado,quantidade,ordem)")
      .eq("candidato_id", candidatoId)
      .maybeSingle();
    setCarregandoEnxoval(false);
    if (error) { toast("Erro ao carregar o enxoval: " + error.message, "err"); return; }
    const detalhe = data as EnxovalDetalhe | null;
    setEnxoval(detalhe);
    if (detalhe) {
      setSelecao({
        contrato_id: detalhe.contrato_id ?? "",
        posto_id: detalhe.posto_id ?? "",
        funcao_id: detalhe.funcao_id ?? "",
      });
    }
  };

  const abrirEnxoval = (c: any) => {
    setCandidatoEnxoval(c);
    setEnxoval(null);
    setSelecao({
      contrato_id: c.contrato_id ?? "",
      posto_id: c.posto_id ?? "",
      funcao_id: c.funcao_id ?? "",
    });
    carregarEnxoval(c.candidato_id);
  };

  const linkDoEnxoval = enxoval?.token
    ? `${window.location.origin}/admissao/enxoval/${enxoval.token}`
    : "";

  const copiarLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copiado para a área de transferência.", "ok");
    } catch {
      toast("Link gerado. Copie-o pelo campo exibido.", "info");
    }
  };

  const gerarEnxoval = async () => {
    if (!candidatoEnxoval) return;
    if (!selecao.contrato_id || !selecao.posto_id || !selecao.funcao_id) {
      toast("Selecione contrato, posto e função.", "err");
      return;
    }
    setSalvandoEnxoval(true);
    const { data, error } = await sb.rpc("sup_adm_gerar_enxoval", {
      p_candidato_id: candidatoEnxoval.candidato_id,
      p_contrato_id: selecao.contrato_id,
      p_posto_id: selecao.posto_id,
      p_funcao_id: selecao.funcao_id,
      p_dias: 15,
    });
    setSalvandoEnxoval(false);
    if (error) { toast("Erro ao gerar o enxoval: " + error.message, "err"); return; }
    const link = `${window.location.origin}/admissao/enxoval/${data.token}`;
    toast("Enxoval gerado com validade de 15 dias.", "ok");
    await copiarLink(link);
    await carregarEnxoval(candidatoEnxoval.candidato_id);
    load();
  };

  const gerarPedido = async () => {
    if (!enxoval) return;
    setSalvandoEnxoval(true);
    const { data, error } = await sb.rpc("sup_adm_criar_pedido", {
      p_enxoval_id: enxoval.id,
    });
    setSalvandoEnxoval(false);
    if (error) { toast("Erro ao gerar o pedido: " + error.message, "err"); return; }
    toast(`Pedido de materiais gerado com sucesso (${data}).`, "ok");
    if (candidatoEnxoval) await carregarEnxoval(candidatoEnxoval.candidato_id);
  };

  const confirmar = async () => {
    if (!acao) return;
    const c = acao.cand;
    const nowIso = new Date().toISOString();

    if (acao.tipo === "providenciar") {
      // Só carimba o Compras. A etapa NÃO muda aqui — ver o cabeçalho.
      const { error } = await (supabase as any).from("WA_CURRICULOS").update({
        compras_ok: true, compras_por: nome, compras_em: nowIso, compras_obs: obs.trim() || null,
      }).eq("id", c.candidato_id);
      if (error) { toast("Erro: " + error.message, "err"); return; }
      await logHist(c, "Materiais/EPIs providenciados — Compras aprovado", "SST + COMPRAS", "SST + COMPRAS", obs.trim() || null);
      toast(c.sst_ok === true
        ? "Compras aprovado — candidato liberado para a Admissão."
        : "Compras aprovado — aguardando o SST.", "ok");
    } else {
      if (!obs.trim()) { toast("Informe o motivo.", "err"); return; }
      const { error } = await (supabase as any).from("WA_CURRICULOS").update({
        etapa_processo: "Reprovado", etapa_changed_at: nowIso,
        compras_ok: false, compras_por: nome, compras_em: nowIso, motivo_reprovacao: obs.trim(),
      }).eq("id", c.candidato_id);
      if (error) { toast("Erro: " + error.message, "err"); return; }
      await logHist(c, "Candidato reprovado pelo Compras", "SST + COMPRAS", "Reprovado", obs.trim());
      toast("Candidato reprovado.", "ok");
    }
    setAcao(null); setObs("");
    load();
  };

  const termo = busca.trim().toLowerCase();
  const filtrados = !termo ? rows
    : rows.filter(c => [c.nome, c.cpf, c.cargo, c.contrato, c.cidade, c.compras_necessidades]
        .some(v => String(v ?? "").toLowerCase().includes(termo)));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 18, background: "linear-gradient(135deg,#fff 0%,#f8fbff 100%)", boxShadow: "0 8px 24px rgba(15,23,42,.06)", flexShrink: 0, gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, color: "#0f3171" }}>🦺 EPIs — Admissões</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            Materiais e EPIs de quem está sendo admitido. O Recrutamento descreve o que é preciso; aqui você confirma quando estiver providenciado.
          </div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 800, background: "#ffedd5", color: "#ea580c", border: "1px solid #fed7aa", borderRadius: 20, padding: "4px 12px" }}>{rows.length} pendente(s)</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 24px" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <input placeholder="Buscar por nome, CPF, cargo, contrato, material..." value={busca} onChange={e => setBusca(e.target.value)}
            style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, color: "#0f172a", fontSize: 12, padding: "9px 12px", outline: "none", flex: 1, minWidth: 240, boxShadow: "0 8px 24px rgba(15,23,42,.06)" }} />
          <PendToggle verTodos={verTodos} setVerTodos={setVerTodos} />
        </div>

        {loading ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8" }}>Carregando...</div>
        ) : filtrados.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8" }}>
            {verTodos ? "Nenhum candidato passou pelo Compras." : "Nenhum candidato aguardando materiais."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(360px,1fr))", gap: 14, alignItems: "start" }}>
            {filtrados.map(c => (
              <div key={c.candidato_id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
                <div style={{ height: 3, background: "#f97316" }} />
                <div style={{ padding: "14px 16px" }}>
                  <CandidatoInfo cand={c} hideCurriculo />

                  {/* O que o Recrutamento pediu — informação central desta tela.
                      Sem ela o Compras não sabe o que providenciar, e é por isso
                      que o campo é obrigatório do lado de lá. */}
                  <div style={{ marginTop: 10, fontSize: 12.5, color: "#7c2d12", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "8px 11px" }}>
                    <b>🧾 Materiais / EPIs solicitados:</b>
                    <div style={{ marginTop: 3, whiteSpace: "pre-wrap" }}>
                      {c.compras_necessidades?.trim() || <span style={{ color: "#c2410c" }}>Não informado pelo Recrutamento.</span>}
                    </div>
                  </div>

                  {c.compras_em && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#15803d", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: "7px 10px" }}>
                      ✓ Providenciado por {c.compras_por || "—"}{c.compras_obs ? ` · ${c.compras_obs}` : ""}
                    </div>
                  )}

                  {/* Quem falta: o candidato só anda quando os dois assinam. */}
                  <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
                    {([["SST", c.sst_ok === true], ["Compras", c.compras_ok === true]] as [string, boolean][]).map(([rot, ok]) => (
                      <span key={rot} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: ok ? "#dcfce7" : "#fef3c7", color: ok ? "#15803d" : "#b45309" }}>
                        {ok ? "✅" : "⏳"} {rot}
                      </span>
                    ))}
                  </div>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
                    {!ETAPAS_PARALELO.includes(c.etapa_processo) && <span style={{ fontSize: 11, color: "#94a3b8" }}>Situação atual: <EtapaChip etapa={c.etapa_processo} /></span>}
                    <HistoricoCandidato candidatoId={c.candidato_id} nome={c.nome} />
                    <button onClick={() => abrirEnxoval(c)} style={btnStyle("#0f3171", "none", "#fff")}>
                      Enxoval e tamanhos
                    </button>
                    {podeAgir && ETAPAS_PARALELO.includes(c.etapa_processo) && c.compras_ok !== true && <>
                      <button onClick={() => { setObs(""); setAcao({ cand: c, tipo: "providenciar" }); }} style={btnStyle("#16a34a", "none", "#fff")}>✓ Materiais providenciados</button>
                      <button onClick={() => { setObs(""); setAcao({ cand: c, tipo: "reprovar" }); }} style={btnStyle("rgba(220,38,38,.08)", "1px solid rgba(220,38,38,.25)", "#dc2626")}>Reprovar</button>
                    </>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {acao && (
        <Modal onClose={() => { setAcao(null); setObs(""); }}
          title={acao.tipo === "providenciar" ? "Confirmar materiais providenciados" : "Reprovar candidato"}
          sub={`${acao.cand.nome} · ${acao.cand.cargo || ""}${acao.cand.cidade ? " · " + acao.cand.cidade : ""}`}>
          {acao.tipo === "providenciar" && acao.cand.compras_necessidades && (
            <div style={{ marginBottom: 12, fontSize: 12.5, color: "#7c2d12", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "8px 11px", whiteSpace: "pre-wrap" }}>
              <b>Solicitado:</b> {acao.cand.compras_necessidades}
            </div>
          )}
          <Campo label={acao.tipo === "providenciar" ? "Observação (opcional)" : "Motivo *"} value={obs} onChange={setObs}
            placeholder={acao.tipo === "providenciar" ? "Ex.: entregue no posto em 20/08." : "Descreva o motivo..."} />
          <Acoes onCancel={() => { setAcao(null); setObs(""); }} onConfirm={confirmar} cor={acao.tipo === "reprovar" ? "#dc2626" : "#16a34a"} />
        </Modal>
      )}

      {candidatoEnxoval && (
        <Modal onClose={() => { setCandidatoEnxoval(null); setEnxoval(null); }}
          title="Enxoval e tamanhos"
          sub={`${candidatoEnxoval.nome} · ${candidatoEnxoval.cargo || "Função não informada"}`}>
          {carregandoEnxoval ? (
            <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Carregando enxoval...</div>
          ) : (
            <>
              <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                  Contrato
                  <select value={selecao.contrato_id} disabled={!!candidatoEnxoval.contrato_id}
                    onChange={e => setSelecao({ contrato_id: e.target.value, posto_id: "", funcao_id: "" })}
                    style={{ width: "100%", marginTop: 4, padding: "9px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: candidatoEnxoval.contrato_id ? "#f1f5f9" : "#fff" }}>
                    <option value="">Selecione o contrato</option>
                    {contratosCatalogo.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                  Posto
                  <select value={selecao.posto_id} disabled={!!candidatoEnxoval.posto_id || !selecao.contrato_id}
                    onChange={e => setSelecao(s => ({ ...s, posto_id: e.target.value, funcao_id: "" }))}
                    style={{ width: "100%", marginTop: 4, padding: "9px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: candidatoEnxoval.posto_id ? "#f1f5f9" : "#fff" }}>
                    <option value="">Selecione o posto</option>
                    {postosCatalogo.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                  Função
                  <select value={selecao.funcao_id} disabled={!!candidatoEnxoval.funcao_id || !selecao.posto_id}
                    onChange={e => setSelecao(s => ({ ...s, funcao_id: e.target.value }))}
                    style={{ width: "100%", marginTop: 4, padding: "9px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: candidatoEnxoval.funcao_id ? "#f1f5f9" : "#fff" }}>
                    <option value="">Selecione a função</option>
                    {funcoesCatalogo.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </select>
                </label>
              </div>

              {!enxoval?.preenchido_em && podeAgir && (
                <button disabled={salvandoEnxoval} onClick={gerarEnxoval}
                  style={{ ...btnStyle("#0f3171", "none", "#fff"), width: "100%", justifyContent: "center", opacity: salvandoEnxoval ? .6 : 1 }}>
                  {enxoval ? "Gerar novo link" : "Gerar link do enxoval"}
                </button>
              )}

              {linkDoEnxoval && !enxoval?.preenchido_em && (
                <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "#eff6ff", border: "1px solid #bfdbfe" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#1e40af", marginBottom: 5 }}>Link do candidato</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input readOnly value={linkDoEnxoval} style={{ flex: 1, minWidth: 0, padding: "7px 8px", border: "1px solid #93c5fd", borderRadius: 6, fontSize: 11 }} />
                    <button onClick={() => copiarLink(linkDoEnxoval)} style={btnStyle("#2563eb", "none", "#fff")}>Copiar</button>
                  </div>
                </div>
              )}

              {enxoval?.preenchido_em && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#15803d", marginBottom: 7 }}>
                    ✓ Tamanhos informados pelo candidato
                  </div>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                    {[...(enxoval.sup_admissao_enxoval_item ?? [])]
                      .sort((a, b) => a.ordem - b.ordem)
                      .map(item => {
                        // Item sem grade vem com o tamanho ESCRITO pelo candidato.
                        // Mostrar "Sem tamanho" aqui esconderia justamente o dado
                        // que ele digitou — foi o furo que o Cassio apontou.
                        const escrito = item.tamanho_informado?.trim();
                        return (
                          <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 10px", borderBottom: "1px solid #f1f5f9", fontSize: 12 }}>
                            <span>
                              {item.nome_item} <span style={{ color: "#94a3b8" }}>× {item.quantidade}</span>
                              {item.tamanho && escrito && (
                                <div style={{ color: "#b45309", fontSize: 11, marginTop: 2 }}>obs.: {escrito}</div>
                              )}
                            </span>
                            {item.tamanho ? (
                              <b>{item.tamanho}</b>
                            ) : escrito ? (
                              <b style={{ color: "#b45309" }} title="Escrito pelo colaborador — o item não tem grade cadastrada">
                                {escrito} <span style={{ fontWeight: 400, fontSize: 10 }}>(escrito)</span>
                              </b>
                            ) : (
                              <b style={{ color: "#94a3b8" }}>Sem tamanho</b>
                            )}
                          </div>
                        );
                      })}
                  </div>
                  {enxoval.pedido_id ? (
                    <div style={{ marginTop: 10, fontSize: 12, color: "#15803d" }}>✓ Pedido de materiais já gerado.</div>
                  ) : podeAgir && (
                    <button disabled={salvandoEnxoval} onClick={gerarPedido}
                      style={{ ...btnStyle("#16a34a", "none", "#fff"), width: "100%", justifyContent: "center", marginTop: 10, opacity: salvandoEnxoval ? .6 : 1 }}>
                      Gerar pedido de materiais
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </Modal>
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}
