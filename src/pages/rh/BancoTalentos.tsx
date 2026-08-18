import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { Toasts, btnStyle, EtapaChip, Modal } from "@/components/recrutamento/CandidatoInfo";

// =====================================================================
// RH / RECRUTAMENTO — Banco de Talentos
// Pool central de candidatos: candidaturas gerais (sem vaga) + candidaturas
// a vagas específicas. Abas: Favoritos, Banco geral, Por vaga, Todos.
// Fonte: WA_CURRICULOS + RECRUTAMENTO_CANDIDATO_ARQUIVOS.
// =====================================================================

const fmtDt = (s?: string) => (!s ? "—" : String(s).slice(0, 10).split("-").reverse().join("/"));
const simNao = (b: any) => (b === true ? "Sim" : b === false ? "Não" : "—");
const digitsOf = (s?: string) => String(s ?? "").replace(/\D/g, "");
type Aba = "favoritos" | "banco" | "vaga" | "todos";

// Junta candidaturas da MESMA PESSOA: mesmo CPF (cpf ou cpf_cand) OU mesmo
// e-mail — candidaturas antigas nem sempre têm os dois. Um registro que
// conecta dois grupos (CPF num, e-mail noutro) funde os grupos.
function agruparPessoas(list: any[]): any[][] {
  const chavesDe = (c: any): string[] => {
    const ks: string[] = [];
    const d = digitsOf(c.cpf || c.cpf_cand);
    if (d.length === 11) ks.push("cpf:" + d);
    const em = String(c.email ?? "").trim().toLowerCase();
    if (em) ks.push("em:" + em);
    return ks.length ? ks : ["id:" + c.id];
  };
  const porChave = new Map<string, any[]>();
  const grupos: any[][] = [];
  list.forEach((c: any) => {
    const ks = chavesDe(c);
    const achados = [...new Set(ks.map(k => porChave.get(k)).filter(Boolean))] as any[][];
    let g: any[];
    if (achados.length === 0) { g = []; grupos.push(g); }
    else {
      g = achados[0];
      for (const outro of achados.slice(1)) {
        g.push(...outro); outro.length = 0;
        for (const [k, arr] of porChave) if (arr === outro) porChave.set(k, g);
      }
    }
    g.push(c);
    ks.forEach(k => porChave.set(k, g));
  });
  return grupos.filter(g => g.length);
}

export default function BancoTalentos() {
  const { user } = useAuth();
  const { can } = usePermissoes();
  const podeAgir = can("alterar", undefined, "recrutamento_gestao");
  const nome = user?.user_metadata?.nome ?? user?.email ?? "";

  const [aba, setAba] = useState<Aba>("banco");
  const [cargoFiltro, setCargoFiltro] = useState<string>("");
  const [rows, setRows] = useState<any[]>([]);
  const [arquivos, setArquivos] = useState<Record<number, any[]>>({});
  const [sols, setSols] = useState<any[]>([]);                 // solicitações (cargo/status)
  const [vagasComCand, setVagasComCand] = useState<{ vaga_id: number; n: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [puxar, setPuxar] = useState<any | null>(null);
  const [detalhe, setDetalhe] = useState<{ latest: any; items: any[]; n: number } | null>(null);
  const [vagaSel, setVagaSel] = useState<string>("");
  const [toasts, setToasts] = useState<{ id: number; msg: string; t: string }[]>([]);

  const toast = (msg: string, t = "info") => {
    const id = Date.now() + Math.random();
    setToasts(x => [...x, { id, msg, t }]);
    setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 3600);
  };

  const cargoDe = (id?: number | null) => sols.find(s => s.id === id)?.cargo || (id ? `#${id}` : "—");
  const vagasAbertas = sols.filter(s => s.status === "Vaga aberta - Seleção de Currículos");

  // Carrega TODAS as candidaturas de uma vez; o recorte por aba é feito por
  // PESSOA (client-side), pra pessoa aparecer inteira em qualquer aba.
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).from("WA_CURRICULOS").select("*").order("created_at", { ascending: false });
    setLoading(false);
    if (error) { toast("Erro ao carregar: " + error.message, "err"); return; }
    const list = (data ?? []).map((c: any) => ({ ...c, nome: String(c.nome ?? "").trim().toUpperCase() }));
    setRows(list);
    const ids = list.map((c: any) => c.id);
    if (ids.length) {
      const { data: arq } = await (supabase as any).from("RECRUTAMENTO_CANDIDATO_ARQUIVOS").select("*").in("candidato_id", ids).order("id");
      const map: Record<number, any[]> = {};
      (arq ?? []).forEach((a: any) => { (map[a.candidato_id] = map[a.candidato_id] || []).push(a); });
      setArquivos(map);
    } else setArquivos({});
  }, []);

  // Metadados (uma vez): solicitações + contadores + vagas com candidatura.
  const loadMeta = useCallback(async () => {
    const [{ data: s }, { data: all }] = await Promise.all([
      (supabase as any).from("SISTEMA_RECRUTAMENTO").select("id,cargo,cidade,status"),
      (supabase as any).from("WA_CURRICULOS").select("id,vaga_id"),
    ]);
    setSols(s ?? []);
    const porVaga = new Map<number, number>();
    (all ?? []).forEach((c: any) => { if (c.vaga_id) porVaga.set(c.vaga_id, (porVaga.get(c.vaga_id) || 0) + 1); });
    setVagasComCand(Array.from(porVaga, ([vaga_id, n]) => ({ vaga_id, n })).sort((a, b) => b.n - a.n));
  }, []);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { load(); }, [load]);

  const baixar = async (a: any) => {
    if (!a.storage_path) { toast("Sem arquivo.", "info"); return; }
    const { data, error } = await supabase.storage.from("curriculos").createSignedUrl(a.storage_path, 3600);
    if (error || !data?.signedUrl) { toast("Não foi possível abrir o arquivo.", "err"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  // Favorita/desfavorita a PESSOA (todas as candidaturas do card juntas).
  const favoritar = async (items: any[]) => {
    const novo = !items.some((it: any) => it.favorito);
    const ids = items.map((it: any) => it.id);
    const { error } = await (supabase as any).from("WA_CURRICULOS").update({ favorito: novo }).in("id", ids);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    setRows(rs => rs.map(x => ids.includes(x.id) ? { ...x, favorito: novo } : x));
    toast(novo ? "⭐ Favoritado." : "Removido dos favoritos.", "ok");
  };

  const confirmarPuxar = async () => {
    if (!puxar || !vagaSel) { toast("Selecione a vaga.", "err"); return; }
    const nowIso = new Date().toISOString();
    const jaTemVaga = !!puxar.vaga_id;

    // Candidatura que já pertence a uma vaga NÃO é movida: cria-se uma nova.
    // Mover apagaria o histórico da participação anterior — inclusive o
    // motivo da reprovação, que é justamente o que o RH precisa consultar ao
    // reaproveitar a pessoa.
    let error;
    if (jaTemVaga) {
      const { id, created_at, etapa_processo, etapa_changed_at, favorito,
              juridico_ok, juridico_obs, juridico_por, juridico_em,
              sst_ok, sst_obs, sst_por, sst_em, compras_ok, compras_obs, compras_por, compras_em,
              motivo_reprovacao, desistiu, desistencia_motivo, desistencia_em, desistencia_por, desistencia_etapa,
              admitido_em, admitido_por, empregado_id, enviado_admissao_por, enviado_admissao_em,
              ...dadosPessoais } = puxar;
      ({ error } = await (supabase as any).from("WA_CURRICULOS").insert({
        ...dadosPessoais,
        vaga_id: Number(vagaSel), etapa_processo: "ENTRADA", etapa_changed_at: nowIso,
        selecionado_por: nome, selecionado_em: nowIso,
      }));
    } else {
      ({ error } = await (supabase as any).from("WA_CURRICULOS").update({
        vaga_id: Number(vagaSel), etapa_processo: "ENTRADA", etapa_changed_at: nowIso,
        selecionado_por: nome, selecionado_em: nowIso,
      }).eq("id", puxar.id));
    }
    if (error) { toast("Erro ao puxar: " + error.message, "err"); return; }
    try {
      await (supabase as any).from("RECRUTAMENTO_HISTORICO").insert({
        solicitacao_id: Number(vagaSel), candidato_id: puxar.id, candidato_nome: puxar.nome,
        evento: jaTemVaga
          ? "Puxado do Banco de Talentos (nova candidatura) → ENTRADA"
          : "Puxado do Banco de Talentos → ENTRADA",
        para_status: "ENTRADA",
        papel: "Recrutamento", usuario_nome: nome, usuario_email: user?.email ?? "",
      });
    } catch { /* noop */ }
    toast(`${puxar.nome || "Candidato"} enviado para a vaga.`, "ok");
    setPuxar(null); setVagaSel("");
    load();
  };

  // Vagas que receberam currículo agrupadas por CARGO.
  const cargosComCand = (() => {
    const m = new Map<string, number>();
    vagasComCand.forEach(v => { const c = cargoDe(v.vaga_id); m.set(c, (m.get(c) || 0) + v.n); });
    return Array.from(m, ([cargo, n]) => ({ cargo, n })).sort((a, b) => b.n - a.n);
  })();

  // Opções do filtro por cargo de interesse ("cargos_interesse" vem como
  // string separada por vírgula do formulário público).
  const cargosOpc = (() => {
    const s = new Set<string>();
    rows.forEach((c: any) => String(c.cargos_interesse ?? "").split(",").forEach((p: string) => { const v = p.trim(); if (v) s.add(v); }));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  })();

  const termo = busca.trim().toLowerCase();
  // Um card por PESSOA, com todas as candidaturas dela (mais recente primeiro).
  const grupos = agruparPessoas(rows).map(items => {
    const ord = [...items].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    return { latest: ord[0], items: ord, n: ord.length };
  });
  // Banco geral = TODAS as pessoas (candidatura geral ou por vaga, em processo ou não).
  // Contadores das abas = nº de PESSOAS em cada recorte.
  const contadores = {
    todos: grupos.length,
    favoritos: grupos.filter(g => g.items.some((it: any) => it.favorito)).length,
    banco: grupos.length,
  };
  const agrupados = grupos.filter(g => {
    if (aba === "favoritos" && !g.items.some((it: any) => it.favorito)) return false;
    if (aba === "vaga") {
      if (!g.items.some((it: any) => it.vaga_id)) return false;
      if (cargoFiltro && !g.items.some((it: any) => it.vaga_id && cargoDe(it.vaga_id) === cargoFiltro)) return false;
    }
    if (!termo) return true;
    return g.items.some((c: any) =>
      [c.nome, c.cpf, c.cpf_cand, c.cargos_interesse, c.cidade_desejada, c.cidade_residencia, c.escolaridade, cargoDe(c.vaga_id)]
        .some(v => String(v ?? "").toLowerCase().includes(termo)));
  });

  const info = (label: string, val: any) => (val || val === false ? (
    <div style={{ fontSize: 12, color: "#475569" }}><span style={{ color: "#94a3b8", fontWeight: 700 }}>{label}: </span>{typeof val === "boolean" ? simNao(val) : val}</div>
  ) : null);

  const tabBtn = (id: Aba, label: string, count?: number) => (
    <button onClick={() => { setAba(id); if (id !== "vaga") setCargoFiltro(""); }} style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: aba === id ? "#0f3171" : "transparent", color: aba === id ? "#fff" : "#94a3b8", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
      {label}{count != null ? ` (${count})` : ""}
    </button>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 18, background: "linear-gradient(135deg,#fff 0%,#f8fbff 100%)", boxShadow: "0 8px 24px rgba(15,23,42,.06)", flexShrink: 0, gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, color: "#0f3171" }}>💼 Banco de Talentos</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>Todos os candidatos e candidaturas. Favorite ⭐, filtre por vaga e puxe para uma vaga aberta.</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 24px" }}>
        {/* Abas */}
        <div style={{ display: "inline-flex", gap: 2, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 4, marginBottom: 14, boxShadow: "0 8px 24px rgba(15,23,42,.06)", flexWrap: "wrap" }}>
          {tabBtn("favoritos", "⭐ Favoritos", contadores.favoritos)}
          {tabBtn("banco", "Banco geral", contadores.banco)}
          {tabBtn("vaga", "Por vaga")}
          {tabBtn("todos", "Todos", contadores.todos)}
        </div>

        {/* Card: cargos que receberam currículo */}
        {aba === "vaga" && (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "12px 14px", marginBottom: 14, boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#0f3171", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".4px" }}>Cargos que receberam candidatura</div>
            {cargosComCand.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "#94a3b8" }}>Nenhuma candidatura a vaga ainda.</div>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {cargosComCand.map(v => (
                  <button key={v.cargo} onClick={() => { setAba("vaga"); setCargoFiltro(cargoFiltro === v.cargo ? "" : v.cargo); }} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 12px", borderRadius: 10, border: `1px solid ${cargoFiltro === v.cargo ? "#0f3171" : "#e2e8f0"}`, background: cargoFiltro === v.cargo ? "#eef4ff" : "#fff", cursor: "pointer" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>{v.cargo}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", background: "#fff", border: "1px solid #dbe4f0", borderRadius: 20, padding: "1px 8px" }}>{v.n}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Busca + filtro cargo */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <input placeholder="Buscar por nome, CPF, cargo, cidade..." value={busca} onChange={e => setBusca(e.target.value)}
            style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, color: "#0f172a", fontSize: 12, padding: "9px 12px", outline: "none", flex: 1, minWidth: 260, boxShadow: "0 8px 24px rgba(15,23,42,.06)" }} />
          {cargosOpc.length > 0 && (
            <select value="" onChange={e => e.target.value && setBusca(e.target.value)} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, color: "#475569", fontSize: 12, padding: "9px 12px", outline: "none", minWidth: 200 }}>
              <option value="">Filtrar por cargo de interesse…</option>
              {cargosOpc.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>

        {loading ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8" }}>Carregando...</div>
        ) : aba === "vaga" && !cargoFiltro ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "#94a3b8" }}>Selecione um cargo acima para ver os candidatos.</div>
        ) : agrupados.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8" }}>Nenhum candidato.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(380px,1fr))", gap: 14, alignItems: "start" }}>
            {agrupados.map(g => {
              const c = g.latest;
              const arqsG = g.items.flatMap((it: any) => arquivos[it.id] || []);
              const semVaga = g.items.find((it: any) => !it.vaga_id);
              // Dado pessoal: pega da candidatura mais recente que tiver (as antigas completam as novas).
              const deG = (campo: string) => g.items.map((it: any) => it[campo]).find((v: any) => v || v === false);
              const fav = g.items.some((it: any) => it.favorito);
              const interesses = deG("cargos_interesse");
              return (
              <div key={c.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 24px rgba(15,23,42,.06)", position: "relative" }}>
                <div style={{ height: 3, background: "#0f3171" }} />
                <button onClick={() => favoritar(g.items)} title={fav ? "Remover dos favoritos" : "Favoritar"} style={{ position: "absolute", top: 10, right: 10, background: "none", border: "none", cursor: "pointer", fontSize: 20, lineHeight: 1, filter: fav ? "none" : "grayscale(1) opacity(.4)" }}>⭐</button>
                <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", paddingRight: 28, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {c.nome || "Sem nome"}
                    {g.n > 1 && <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: "#eef4ff", border: "1px solid #dbe4f0", color: "#0f3171" }}>📩 {g.n} candidaturas</span>}
                  </div>
                  {(g.n > 1 || c.vaga_id) && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {g.items.map((it: any) => (
                        <div key={it.id} style={{ fontSize: 11.5, color: it.vaga_id ? "#0369a1" : "#64748b" }}>
                          {it.vaga_id
                            ? <>Candidatou-se: <b>{cargoDe(it.vaga_id)}</b> {it.etapa_processo && <EtapaChip etapa={it.etapa_processo} />}</>
                            : <>Candidatura geral (banco de talentos)</>}
                          <span style={{ color: "#94a3b8", whiteSpace: "nowrap" }}> · {fmtDt(it.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 14px" }}>
                    {info("CPF", deG("cpf") || deG("cpf_cand"))}
                    {info("Nasc.", fmtDt(deG("data_nascimento")))}
                    {info("Fone", deG("telefone"))}
                    {info("Email", deG("email"))}
                    {info("Escolaridade", deG("escolaridade"))}
                    {info("Reside", deG("cidade_residencia"))}
                    {info("Deseja", [deG("cidade_desejada"), deG("estado_desejado")].filter(Boolean).join("/"))}
                    {info("CNH", deG("possui_cnh"))}
                    {info("Horários", deG("disponibilidade_horarios"))}
                    {info("Experiência", deG("experiencia_previa"))}
                  </div>
                  {interesses && <div style={{ fontSize: 12, color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 9px" }}><b style={{ color: "#0f3171" }}>Interesse:</b> {interesses}</div>}
                  {arqsG.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {arqsG.map((a: any) => (
                        <button key={a.id} onClick={() => baixar(a)} style={btnStyle(a.tipo === "ctps" ? "rgba(139,92,246,.12)" : "rgba(249,115,22,.12)", `1px solid ${a.tipo === "ctps" ? "rgba(139,92,246,.3)" : "rgba(249,115,22,.3)"}`, a.tipo === "ctps" ? "#7c3aed" : "#ea580c")}>↓ {a.tipo === "ctps" ? "CTPS" : "Currículo"}</button>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
                    <span style={{ fontSize: 10.5, color: "#94a3b8" }}>Cadastro em {fmtDt(c.created_at)}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setDetalhe(g)} style={btnStyle("rgba(15,49,113,.08)", "1px solid rgba(15,49,113,.2)", "#0f3171")}>🔍 Detalhes</button>
                      {/* Antes só aparecia com candidatura SEM vaga, então quem
                          tinha sido reprovado em alguma ficava preso: todas as
                          candidaturas dele tinham vaga_id. Agora vale sempre —
                          reprovado numa vaga pode concorrer a outra. */}
                      {podeAgir && <button onClick={() => { setVagaSel(""); setPuxar(semVaga ?? c); }} style={btnStyle("#16a34a", "none", "#fff")}>✓ Puxar para vaga</button>}
                    </div>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {puxar && (
        <div style={{ position: "fixed", inset: 0, zIndex: 700, background: "rgba(15,23,42,.42)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 24, width: "100%", maxWidth: 460, position: "relative", boxShadow: "0 16px 40px rgba(15,23,42,.1)" }}>
            <button onClick={() => { setPuxar(null); setVagaSel(""); }} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Puxar para uma vaga</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>{puxar.nome} entrará no kanban da vaga em ENTRADA.</div>
            {vagasAbertas.length === 0 ? (
              <div style={{ fontSize: 13, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>Nenhuma vaga aberta no momento.</div>
            ) : (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>Vaga *</label>
                <select value={vagaSel} onChange={e => setVagaSel(e.target.value)} style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, color: "#0f172a", fontSize: 13, padding: "9px 12px", outline: "none" }}>
                  <option value="">— Selecione a vaga —</option>
                  {vagasAbertas.map(v => <option key={v.id} value={v.id}>#{v.id} · {v.cargo} · {v.cidade || ""}</option>)}
                </select>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { setPuxar(null); setVagaSel(""); }} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmarPuxar} disabled={!vagaSel} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: vagaSel ? "#16a34a" : "#cbd5e1", color: "#fff", fontSize: 12, fontWeight: 700, cursor: vagaSel ? "pointer" : "default" }}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: todas as informações do candidato (dados das candidaturas se completam) */}
      {detalhe && (() => {
        const dg = (campo: string) => detalhe.items.map((it: any) => it[campo]).find((v: any) => v || v === false);
        const arqsD = detalhe.items.flatMap((it: any) => arquivos[it.id] || []);
        const tit = { fontSize: 11, fontWeight: 800, color: "#0f3171", marginBottom: 6, textTransform: "uppercase" as const, letterSpacing: ".4px" };
        const bloco = { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" };
        const nascimento = dg("data_nascimento");
        const experiencias = [dg("experiencia_1"), dg("experiencia_2"), dg("experiencia_3")].filter(Boolean).join(" · ");
        return (
          <Modal title={`🔍 ${detalhe.latest.nome || "Candidato"}`} sub={`${detalhe.n} candidatura(s) · cadastro mais recente em ${fmtDt(detalhe.latest.created_at)}`} onClose={() => setDetalhe(null)} maxWidth={680}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={bloco}>
                <div style={tit}>Candidaturas</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {detalhe.items.map((it: any) => (
                    <div key={it.id} style={{ fontSize: 12, color: it.vaga_id ? "#0369a1" : "#64748b", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {it.vaga_id
                        ? <>Vaga: <b>{cargoDe(it.vaga_id)}</b> {it.etapa_processo && <EtapaChip etapa={it.etapa_processo} />}</>
                        : <>Candidatura geral (banco de talentos)</>}
                      <span style={{ color: "#94a3b8", whiteSpace: "nowrap" }}>· {fmtDt(it.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={bloco}>
                <div style={tit}>Dados pessoais</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 14px" }}>
                  {info("CPF", dg("cpf") || dg("cpf_cand"))}
                  {info("RG", dg("rg"))}
                  {info("Nascimento", nascimento ? fmtDt(nascimento) : null)}
                  {info("Sexo", dg("sexo"))}
                  {info("Nome da mãe", dg("nome_mae"))}
                  {info("Nome do pai", dg("nome_pai"))}
                  {info("Fone", dg("telefone"))}
                  {info("Email", dg("email"))}
                  {info("Escolaridade", dg("escolaridade"))}
                  {info("Reside", dg("cidade_residencia"))}
                  {info("Deseja trabalhar", [dg("cidade_desejada"), dg("estado_desejado")].filter(Boolean).join("/"))}
                  {info("CNH", dg("possui_cnh"))}
                  {info("Disp. horários", dg("disponibilidade_horarios"))}
                  {info("Fim de semana", dg("disp_fim_semana"))}
                  {info("Experiência prévia", dg("experiencia_previa"))}
                  {info("Estrangeiro", dg("estrangeiro"))}
                </div>
                {dg("cargos_interesse") && <div style={{ marginTop: 6, fontSize: 12, color: "#475569" }}><span style={{ color: "#94a3b8", fontWeight: 700 }}>Cargos de interesse: </span>{dg("cargos_interesse")}</div>}
                {experiencias && <div style={{ marginTop: 4, fontSize: 12, color: "#475569" }}><span style={{ color: "#94a3b8", fontWeight: 700 }}>Experiências: </span>{experiencias}</div>}
                {dg("mensagem") && <div style={{ marginTop: 4, fontSize: 12, color: "#475569", whiteSpace: "pre-wrap" }}><span style={{ color: "#94a3b8", fontWeight: 700 }}>Mensagem: </span>{dg("mensagem")}</div>}
              </div>
              {arqsD.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {arqsD.map((a: any) => (
                    <button key={a.id} onClick={() => baixar(a)} style={btnStyle(a.tipo === "ctps" ? "rgba(139,92,246,.12)" : "rgba(249,115,22,.12)", `1px solid ${a.tipo === "ctps" ? "rgba(139,92,246,.3)" : "rgba(249,115,22,.3)"}`, a.tipo === "ctps" ? "#7c3aed" : "#ea580c")}>↓ {a.tipo === "ctps" ? "CTPS" : "Currículo"}</button>
                  ))}
                </div>
              )}
            </div>
          </Modal>
        );
      })()}

      <Toasts toasts={toasts} />
    </div>
  );
}
