import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { MapaPicker } from "@/components/sst/MapaPicker";
import { CandidatoInfo, baixarCurriculoCand, Modal, Campo, Acoes, Toasts, btnStyle, PendToggle, EtapaChip, HistoricoCandidato } from "@/components/recrutamento/CandidatoInfo";

// =====================================================================
// SST — Exame Médico (fila do Recrutamento)
// Candidatos na etapa "Exame Médico" (liberados pelo Jurídico e pelas
// entrevistas). O SST confirma o exame admissional e envia para o Compras,
// ou reprova. Fonte: VW_RECRUTAMENTO_CANDIDATOS.
// =====================================================================

export default function AsoCandidatos() {
  const { user } = useAuth();
  const { can } = usePermissoes();
  const podeAgir = can("alterar", undefined, "sst_aso");
  const nome = user?.user_metadata?.nome ?? user?.email ?? "";

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [verTodos, setVerTodos] = useState(false);
  const [acao, setAcao] = useState<{ cand: any; tipo: "agendar" | "reprovar" } | null>(null);
  const [obs, setObs] = useState("");
  const [ag, setAg] = useState({ data: "", hora: "", local: "", maps: "" });
  const [mapPrev, setMapPrev] = useState(""); // texto usado na pré-visualização do mapa (embed)
  const [toasts, setToasts] = useState<{ id: number; msg: string; t: string }[]>([]);

  // Link p/ abrir o local no Google Maps: usa o link exato colado pelo SST,
  // senão cai na busca pelo texto do local.
  const mapsHref = (c: any): string | null => {
    const url = String(c?.sst_maps_url ?? "").trim();
    if (url) return url;
    const local = String(c?.sst_local_exame ?? "").trim();
    return local ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(local)}` : null;
  };

  const fmtD = (s?: string) => (!s ? "—" : String(s).slice(0, 10).split("-").reverse().join("/"));
  const logHist = async (c: any, evento: string, de: string, para: string, detalhe: string | null) => {
    try { await (supabase as any).from("RECRUTAMENTO_HISTORICO").insert({ solicitacao_id: c.vaga_id, candidato_id: c.candidato_id, candidato_nome: c.nome, evento, de_status: de, para_status: para, papel: "SST", usuario_nome: nome, usuario_email: user?.email ?? "", detalhe }); } catch { /* noop */ }
  };

  const toast = (msg: string, t = "info") => {
    const id = Date.now() + Math.random();
    setToasts(x => [...x, { id, msg, t }]);
    setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 3600);
  };

  const load = useCallback(async () => {
    setLoading(true);
    let q = (supabase as any).from("VW_RECRUTAMENTO_CANDIDATOS").select("*");
    // 'EXAME SST' era a etapa exclusiva do SST. Agora SST e Compras correm em
    // PARALELO numa etapa só; o nome antigo continua aceito porque há registro
    // gravado antes da mudança.
    q = verTodos
      ? q.or('etapa_processo.eq."SST + COMPRAS",etapa_processo.eq."EXAME SST",sst_em.not.is.null,sst_agendado_em.not.is.null')
      : q.in("etapa_processo", ["SST + COMPRAS", "EXAME SST"]).is("sst_ok", null);
    const { data, error } = await q.order("etapa_changed_at", { ascending: true });
    setLoading(false);
    if (error) { toast("Erro ao carregar: " + error.message, "err"); return; }
    setRows(data ?? []);
  }, [verTodos]);

  useEffect(() => { load(); }, [load]);

  const baixarCv = async (c: any) => { const err = await baixarCurriculoCand(c.storage_path); if (err) toast(err, "info"); };

  const confirmar = async () => {
    if (!acao) return;
    const nowIso = new Date().toISOString();
    const c = acao.cand;
    if (acao.tipo === "agendar") {
      if (!ag.data) { toast("Informe a data do exame.", "err"); return; }
      const patch: any = {
        sst_data_exame: ag.data, sst_hora_exame: ag.hora.trim() || null, sst_local_exame: ag.local.trim() || null,
        sst_maps_url: ag.maps.trim() || null,
        sst_agendado_por: nome, sst_agendado_em: nowIso,
        // Agendar JÁ conclui a etapa do SST. Antes eram dois passos (agendar e
        // depois "realizar"), e o segundo só repetia o que o primeiro já
        // dizia — card ficava parado esperando um clique sem decisão nenhuma
        // por trás. Quem leva o candidato à ADMISSÃO é o trigger, quando o
        // Compras também assinar.
        sst_ok: true, sst_por: nome, sst_em: nowIso,
      };
      let { error } = await (supabase as any).from("WA_CURRICULOS").update(patch).eq("id", c.candidato_id);
      if (error && /sst_maps_url/.test(error.message || "")) {
        // Banco ainda sem a coluna (migration não aplicada): salva sem o link.
        delete patch.sst_maps_url;
        ({ error } = await (supabase as any).from("WA_CURRICULOS").update(patch).eq("id", c.candidato_id));
        if (!error) toast("Agendado sem o link do Maps — aplique a migration sst_maps_url no banco.", "info");
      }
      if (error) { toast("Erro: " + error.message, "err"); return; }
      await logHist(c, "Exame agendado — SST aprovado", "SST + COMPRAS", "SST + COMPRAS", `${fmtD(ag.data)} ${ag.hora} · ${ag.local}`.trim());
      toast(c.compras_ok === true
        ? "Exame agendado — candidato liberado para a Admissão."
        : "Exame agendado — SST concluído, aguardando o Compras.", "ok");
    } else {
      if (!obs.trim()) { toast("Informe o motivo.", "err"); return; }
      const { error } = await (supabase as any).from("WA_CURRICULOS").update({
        etapa_processo: "Reprovado", etapa_changed_at: nowIso, sst_ok: false, sst_por: nome, sst_em: nowIso, motivo_reprovacao: obs.trim(),
      }).eq("id", c.candidato_id);
      if (error) { toast("Erro: " + error.message, "err"); return; }
      await logHist(c, "Candidato reprovado", "SST + COMPRAS", "Reprovado", obs.trim());
      toast("Candidato reprovado.", "ok");
    }
    setAcao(null); setObs(""); setAg({ data: "", hora: "", local: "", maps: "" }); setMapPrev("");
    load();
  };

  const termo = busca.trim().toLowerCase();
  const filtrados = !termo ? rows : rows.filter(c => [c.nome, c.cpf, c.cargo, c.contrato, c.cidade].some(v => String(v ?? "").toLowerCase().includes(termo)));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 18, background: "linear-gradient(135deg,#fff 0%,#f8fbff 100%)", boxShadow: "0 8px 24px rgba(15,23,42,.06)", flexShrink: 0, gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, color: "#0f3171" }}>🦺 Exame Médico (SST)</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>Agende o exame (data/hora/local) — isso já conclui a etapa do SST. O candidato segue para a Admissão quando o Compras também aprovar.</div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 800, background: "#fef3c7", color: "#b45309", border: "1px solid #fde68a", borderRadius: 20, padding: "4px 12px" }}>{rows.length} pendente(s)</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 24px" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <input placeholder="Buscar por nome, CPF, cargo, contrato, cidade..." value={busca} onChange={e => setBusca(e.target.value)}
            style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, color: "#0f172a", fontSize: 12, padding: "9px 12px", outline: "none", flex: 1, minWidth: 240, boxShadow: "0 8px 24px rgba(15,23,42,.06)" }} />
          <PendToggle verTodos={verTodos} setVerTodos={setVerTodos} />
        </div>

        {loading ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8" }}>Carregando...</div>
        ) : filtrados.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8" }}>{verTodos ? "Nenhum candidato passou pelo SST." : "Nenhum candidato aguardando exame médico."}</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(360px,1fr))", gap: 14, alignItems: "start" }}>
            {filtrados.map(c => (
              <div key={c.candidato_id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
                <div style={{ height: 3, background: "#f59e0b" }} />
                <div style={{ padding: "14px 16px" }}>
                  <CandidatoInfo cand={c} hideCurriculo />
                  {c.sst_agendado_em && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#15803d", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: "7px 10px" }}>
                      🗓 <b>Exame agendado:</b> {fmtD(c.sst_data_exame)}{c.sst_hora_exame ? ` às ${c.sst_hora_exame}` : ""}{c.sst_local_exame ? ` · ${c.sst_local_exame}` : ""}
                      {mapsHref(c) && <> · <a href={mapsHref(c)!} target="_blank" rel="noopener noreferrer" style={{ color: "#0369a1", fontWeight: 700 }}>📍 Ver no mapa</a></>}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
                    {!["SST + COMPRAS", "EXAME SST"].includes(c.etapa_processo) && <span style={{ fontSize: 11, color: "#94a3b8" }}>Situação atual: <EtapaChip etapa={c.etapa_processo} /></span>}
                    <HistoricoCandidato candidatoId={c.candidato_id} nome={c.nome} />
                    {podeAgir && ["SST + COMPRAS", "EXAME SST"].includes(c.etapa_processo) && <>
                      <button onClick={() => { const local = c.local_exato || c.cidade || ""; setAg({ data: c.sst_data_exame || "", hora: c.sst_hora_exame || "", local, maps: c.sst_maps_url || "" }); setMapPrev(local); setAcao({ cand: c, tipo: "agendar" }); }} style={btnStyle("#0ea5e9", "none", "#fff")}>🗓 {c.sst_agendado_em ? "Reagendar exame" : "Agendar exame e concluir"}</button>
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
        <Modal onClose={() => { setAcao(null); setObs(""); setAg({ data: "", hora: "", local: "", maps: "" }); setMapPrev(""); }}
          title={acao.tipo === "agendar" ? "Agendar exame (ASO) — conclui o SST" : "Reprovar candidato"}
          sub={`${acao.cand.nome} · ${acao.cand.cargo || ""}${acao.cand.cidade ? " · " + acao.cand.cidade : ""}`}>
          {acao.tipo === "agendar" ? (<>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>Data *</label>
                <input type="date" value={ag.data} onChange={e => setAg(s => ({ ...s, data: e.target.value }))} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 10px", fontSize: 13, outline: "none" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>Horário</label>
                <input value={ag.hora} onChange={e => setAg(s => ({ ...s, hora: e.target.value }))} placeholder="Ex.: 09:00" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 10px", fontSize: 13, outline: "none" }} />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>Local do exame</label>
              <input value={ag.local} onChange={e => setAg(s => ({ ...s, local: e.target.value }))} onBlur={() => setMapPrev(ag.local.trim())} placeholder="Clínica / endereço" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 10px", fontSize: 13, outline: "none" }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>Local exato no Google Maps (opcional)</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={ag.maps} onChange={e => setAg(s => ({ ...s, maps: e.target.value }))} placeholder="Cole aqui o link do Maps (Compartilhar → Copiar link)" style={{ flex: 1, border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 10px", fontSize: 12.5, outline: "none" }} />
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ag.local.trim() || "clínica ocupacional")}`} target="_blank" rel="noopener noreferrer" title="Abre o Google Maps buscando o local digitado — ache o lugar exato e copie o link em Compartilhar"
                  style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, padding: "0 12px", borderRadius: 10, background: "rgba(15,49,113,.08)", border: "1px solid rgba(15,49,113,.2)", color: "#0f3171", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>🔎 Buscar no Maps</a>
              </div>
              <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 4 }}>Ache o lugar no Maps, toque em <b>Compartilhar → Copiar link</b> e cole acima — quem for ver o agendamento abre direto no ponto exato.</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <MapaPicker busca={mapPrev} onPick={({ nome, url }) => setAg(s => ({ ...s, maps: url, local: nome || s.local }))} />
            </div>
          </>) : (
            <Campo label="Motivo *" value={obs} onChange={setObs} placeholder="Descreva o motivo..." />
          )}
          <Acoes onCancel={() => { setAcao(null); setObs(""); setAg({ data: "", hora: "", local: "", maps: "" }); setMapPrev(""); }} onConfirm={confirmar} cor={acao.tipo === "reprovar" ? "#dc2626" : "#16a34a"} />
        </Modal>
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}

