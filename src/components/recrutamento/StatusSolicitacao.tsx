import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PASSOS_FLUXO, desfechoDoStatus, estadosDosPassos, progressoDoStatus, resumoHistorico, statusAntesDoFim,
  type EventoHistorico,
} from "@/lib/recrutamento/fluxoStatus";

// =====================================================================
// STATUS DA SOLICITAÇÃO — o cartão grande (70% da tela) do botão "Status"
// em cada solicitação de vaga (18/09/2026, pedido do Pablo).
//
// Três blocos, animados na entrada:
//   1. Cabeçalho em degradê com a vaga, o status atual pulsando e a barra de
//      progresso do fluxo.
//   2. A RÉGUA: os 8 passos do fluxo (lib/recrutamento/fluxoStatus.ts) com o
//      que já passou (verde, ✓), o passo atual (azul, pulsando) e o que
//      falta (cinza). Reprovada/cancelada mostra onde o pedido parou (vermelho).
//   3. O HISTÓRICO: RECRUTAMENTO_HISTORICO da solicitação, mais novo em cima,
//      cada evento entrando em cascata; nome de quem fez traduzido por
//      EMPREGADOS quando ficou só o e-mail.
// =====================================================================

const db = supabase as unknown as SupabaseClient;

const fmtDtHora = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(+d) ? String(s) : d.toLocaleDateString("pt-BR") + " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };
const fmtDt = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(+d) ? String(s) : d.toLocaleDateString("pt-BR"); };

export interface SolicitacaoStatus {
  id: number;
  status: string;
  cargo?: string | null;
  contrato?: string | null;
  cidade?: string | null;
  created_at?: string | null;
  status_changed_at?: string | null;
  grau_urgencia?: string | null;
  solicitante_nome?: string | null;
  quantidade_vagas?: number | string | null;
}

async function nomesPorEmail(emails: (string | null | undefined)[]): Promise<Record<string, string>> {
  const lista = Array.from(new Set(emails.filter((e): e is string => !!e && e.includes("@"))));
  if (!lista.length) return {};
  const { data } = await db.from("EMPREGADOS").select('"Nome","email"').in("email", lista);
  const mapa: Record<string, string> = {};
  (data ?? []).forEach((e: { Nome?: string; email?: string }) => { if (e.email && e.Nome) mapa[e.email] = e.Nome; });
  return mapa;
}

const PAPEL_COR: Record<string, string> = {
  Recrutamento: "#7c3aed", Analista: "#b45309", Diretoria: "#92400e", Operacional: "#0e7490",
  "Jurídico": "#6d28d9", SST: "#b45309", Compras: "#ea580c", RH: "#15803d", Encarregado: "#0f3171", Sistema: "#64748b",
};

export function StatusSolicitacao({ sol, onClose }: { sol: SolicitacaoStatus; onClose: () => void }) {
  const [eventos, setEventos] = useState<EventoHistorico[] | null>(null);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data } = await db.from("RECRUTAMENTO_HISTORICO").select("id, created_at, evento, de_status, para_status, papel, usuario_nome, usuario_email, detalhe, candidato_nome")
        .eq("solicitacao_id", sol.id).order("created_at", { ascending: false }).limit(500);
      if (!vivo) return;
      const evs = (data ?? []) as EventoHistorico[];
      setEventos(evs);
      setNomes(await nomesPorEmail(evs.map(e => e.usuario_email ?? e.usuario_nome)));
    })();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    window.addEventListener("keydown", esc);
    return () => { vivo = false; window.removeEventListener("keydown", esc); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sol.id]);

  const fechar = () => { setSaindo(true); setTimeout(onClose, 220); };

  const desfecho = desfechoDoStatus(sol.status);
  const antes = statusAntesDoFim(eventos ?? []);
  const estados = estadosDosPassos(sol.status, antes);
  const progresso = progressoDoStatus(desfecho === "andamento" || desfecho === "contratada" ? sol.status : antes);
  const r = resumoHistorico(eventos ?? [], sol.created_at, sol.status);
  const corDesfecho = desfecho === "contratada" ? "#16a34a" : desfecho === "reprovada" ? "#dc2626" : desfecho === "cancelada" ? "#64748b" : "#f59e0b";
  const rotuloDesfecho = desfecho === "contratada" ? "Contratada" : desfecho === "reprovada" ? "Reprovada" : desfecho === "cancelada" ? "Cancelada" : "Em andamento";
  const nome = (e: EventoHistorico) => {
    const u = e.usuario_nome ?? "";
    if (u && !u.includes("@")) return u;
    return nomes[e.usuario_email ?? ""] ?? nomes[u] ?? u ?? "—";
  };

  return createPortal(
    <div className={"sts-ov" + (saindo ? " sts-out" : "")} onClick={e => { if (e.target === e.currentTarget) fechar(); }}>
      <style>{`
        .sts-ov{position:fixed;inset:0;z-index:900;background:rgba(15,23,42,.55);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:18px;animation:sts-fade .25s ease}
        .sts-ov.sts-out{animation:sts-fade-out .22s ease forwards}
        .sts-ov.sts-out .sts-card{animation:sts-card-out .22s ease forwards}
        @keyframes sts-fade{from{opacity:0}to{opacity:1}}
        @keyframes sts-fade-out{to{opacity:0}}
        .sts-card{width:70vw;min-width:min(720px,96vw);max-width:1240px;max-height:90vh;background:#f5f7fb;border-radius:26px;box-shadow:0 40px 100px rgba(15,23,42,.45);overflow:hidden;display:flex;flex-direction:column;animation:sts-card-in .45s cubic-bezier(.2,.8,.2,1);position:relative}
        @keyframes sts-card-in{from{opacity:0;transform:translateY(28px) scale(.96)}to{opacity:1;transform:none}}
        @keyframes sts-card-out{to{opacity:0;transform:translateY(16px) scale(.97)}}
        .sts-hero{position:relative;overflow:hidden;padding:26px 30px 22px;background:linear-gradient(135deg,#0f3171 0%,#1d4ed8 60%,#2563eb 100%);color:#fff;background-size:200% 200%;animation:sts-grad 16s ease-in-out infinite}
        @keyframes sts-grad{0%,100%{background-position:0% 0%}50%{background-position:100% 100%}}
        .sts-hero::before{content:"";position:absolute;right:-80px;top:-100px;width:320px;height:320px;border-radius:50%;background:rgba(255,255,255,.08);animation:sts-drift 14s ease-in-out infinite}
        .sts-hero::after{content:"";position:absolute;left:30%;bottom:-160px;width:260px;height:260px;border-radius:50%;background:rgba(255,255,255,.05);animation:sts-drift 18s ease-in-out -6s infinite}
        @keyframes sts-drift{0%,100%{transform:translate(0,0)}50%{transform:translate(-30px,20px)}}
        .sts-hero > *{position:relative}
        .sts-up{opacity:0;transform:translateY(16px);animation:sts-up .6s cubic-bezier(.2,.8,.2,1) forwards}
        @keyframes sts-up{to{opacity:1;transform:none}}
        .sts-eyebrow{font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;opacity:.8}
        .sts-hero h2{margin:4px 0 2px;font-size:26px;font-weight:900;letter-spacing:-.4px;line-height:1.15}
        .sts-hero p{margin:0;font-size:13.5px;opacity:.9}
        .sts-status{display:inline-flex;align-items:center;gap:8px;background:#fff;color:#0f3171;border-radius:999px;padding:9px 16px;font-size:13.5px;font-weight:900;box-shadow:0 12px 28px rgba(0,0,0,.2);white-space:nowrap}
        .sts-status i{width:9px;height:9px;border-radius:50%;background:var(--c);box-shadow:0 0 0 0 var(--c);animation:sts-ping 1.8s ease-out infinite}
        @keyframes sts-ping{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--c) 60%,transparent)}100%{box-shadow:0 0 0 12px transparent}}
        .sts-bar{height:8px;border-radius:999px;background:rgba(255,255,255,.2);overflow:hidden;margin-top:16px}
        .sts-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#fdba74,#f97316);width:0;animation:sts-bar 1.1s cubic-bezier(.2,.8,.2,1) .3s forwards;box-shadow:0 0 14px rgba(249,115,22,.7)}
        @keyframes sts-bar{to{width:var(--w)}}
        .sts-pills{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
        .sts-pills span{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700}
        .sts-pills span b{font-weight:900}
        .sts-x{position:absolute;top:16px;right:18px;z-index:2;border:none;background:rgba(255,255,255,.16);color:#fff;width:38px;height:38px;border-radius:12px;font-size:18px;cursor:pointer;transition:.15s;font-family:inherit}
        .sts-x:hover{background:rgba(255,255,255,.3);transform:rotate(90deg)}
        .sts-body{overflow-y:auto;padding:22px 30px 30px;display:grid;gap:20px}
        .sts-sec{background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:20px 22px;box-shadow:0 8px 24px rgba(15,23,42,.05)}
        .sts-sec-t{font-size:12.5px;font-weight:800;color:#0f3171;text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:8px;margin-bottom:16px}
        .sts-sec-t::before{content:"";width:4px;height:16px;border-radius:2px;background:#0f3171}
        .sts-regua{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:0;position:relative}
        @media(max-width:1000px){.sts-regua{grid-template-columns:repeat(4,minmax(0,1fr));row-gap:22px}}
        .sts-passo{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;padding:0 6px;opacity:0;animation:sts-up .5s cubic-bezier(.2,.8,.2,1) forwards}
        .sts-passo::before{content:"";position:absolute;top:22px;left:-50%;width:100%;height:4px;background:#e2e8f0;z-index:0}
        .sts-passo:first-child::before{display:none}
        .sts-passo[data-e="feito"]::before,.sts-passo[data-e="atual"]::before,.sts-passo[data-e="parado"]::before{background:linear-gradient(90deg,#16a34a,#22c55e)}
        .sts-passo[data-e="atual"]::before{background:linear-gradient(90deg,#16a34a,#2563eb)}
        .sts-passo[data-e="parado"]::before{background:linear-gradient(90deg,#16a34a,#dc2626)}
        .sts-bola{position:relative;z-index:1;width:46px;height:46px;border-radius:50%;display:grid;place-items:center;font-size:19px;background:#f1f5f9;border:3px solid #e2e8f0;color:#94a3b8;transition:.2s}
        .sts-passo[data-e="feito"] .sts-bola{background:#dcfce7;border-color:#16a34a;color:#15803d}
        .sts-passo[data-e="atual"] .sts-bola{background:#0f3171;border-color:#0f3171;color:#fff;box-shadow:0 0 0 0 rgba(15,49,113,.5);animation:sts-ping-azul 1.8s ease-out infinite;transform:scale(1.12)}
        @keyframes sts-ping-azul{0%{box-shadow:0 0 0 0 rgba(37,99,235,.55)}100%{box-shadow:0 0 0 16px transparent}}
        .sts-passo[data-e="parado"] .sts-bola{background:#fee2e2;border-color:#dc2626;color:#b91c1c}
        .sts-passo-t{margin-top:9px;font-size:12px;font-weight:800;color:#94a3b8;line-height:1.2}
        .sts-passo[data-e="feito"] .sts-passo-t{color:#15803d}
        .sts-passo[data-e="atual"] .sts-passo-t{color:#0f3171}
        .sts-passo[data-e="parado"] .sts-passo-t{color:#b91c1c}
        .sts-passo-q{font-size:10.5px;color:#94a3b8;margin-top:3px;line-height:1.3}
        .sts-passo-tag{margin-top:6px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.5px;padding:2px 8px;border-radius:999px}
        .sts-tl{position:relative;padding-left:26px}
        .sts-tl::before{content:"";position:absolute;left:9px;top:8px;bottom:8px;width:2px;background:linear-gradient(180deg,#0f3171,#e2e8f0)}
        .sts-ev{position:relative;padding:12px 14px;border:1px solid #e2e8f0;border-radius:14px;background:#fff;margin-bottom:10px;opacity:0;animation:sts-slide .45s cubic-bezier(.2,.8,.2,1) forwards;transition:transform .15s,box-shadow .15s}
        .sts-ev:hover{transform:translateX(4px);box-shadow:0 10px 24px rgba(15,23,42,.08)}
        @keyframes sts-slide{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}
        .sts-ev::before{content:"";position:absolute;left:-22px;top:18px;width:12px;height:12px;border-radius:50%;background:#fff;border:3px solid var(--c,#0f3171);box-shadow:0 0 0 3px #fff}
        .sts-ev-h{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center}
        .sts-ev-t{font-size:13.5px;font-weight:800;color:#0f172a}
        .sts-ev-d{font-size:11.5px;color:#64748b;white-space:nowrap}
        .sts-ev-m{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;font-size:12px;color:#475569}
        .sts-tag{display:inline-flex;align-items:center;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px;background:#f1f5f9;color:#475569}
        .sts-de{font-size:11.5px;font-weight:700;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:2px 8px}
        .sts-para{font-size:11.5px;font-weight:800;color:#0f3171;background:#eef4ff;border:1px solid #c7d7f5;border-radius:8px;padding:2px 8px}
        .sts-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
        .sts-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:14px 16px;box-shadow:0 8px 24px rgba(15,23,42,.05);position:relative;overflow:hidden}
        .sts-kpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--c)}
        .sts-kpi-l{font-size:10.5px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px}
        .sts-kpi-v{font-size:24px;font-weight:900;color:var(--c);line-height:1.15;margin-top:2px}
        .sts-kpi-s{font-size:11px;color:#64748b;margin-top:2px}
        @media(prefers-reduced-motion:reduce){.sts-card,.sts-ov,.sts-up,.sts-passo,.sts-ev,.sts-bar i,.sts-hero,.sts-status i,.sts-passo[data-e="atual"] .sts-bola{animation:none;opacity:1;transform:none;width:var(--w)}}
      `}</style>
      <div className="sts-card" role="dialog" aria-modal="true" aria-label={`Status da solicitação #${sol.id}`}>
        <button className="sts-x" onClick={fechar} title="Fechar (Esc)">✕</button>
        <div className="sts-hero">
          <div className="sts-up" style={{ animationDelay: ".05s" }}>
            <div className="sts-eyebrow">Solicitação #{sol.id} · {sol.contrato || "sem contrato"}</div>
            <h2>{sol.cargo || "Vaga"}{Number(sol.quantidade_vagas) > 1 ? ` · ${sol.quantidade_vagas} vagas` : ""}</h2>
            <p>{[sol.cidade, sol.solicitante_nome ? `pedida por ${sol.solicitante_nome}` : null, sol.created_at ? `em ${fmtDt(sol.created_at)}` : null].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="sts-up" style={{ animationDelay: ".18s", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
            <span className="sts-status" style={{ "--c": corDesfecho } as React.CSSProperties}><i />{sol.status}</span>
            <span style={{ fontSize: 12.5, fontWeight: 800, background: "rgba(255,255,255,.16)", border: "1px solid rgba(255,255,255,.3)", borderRadius: 999, padding: "7px 13px" }}>{rotuloDesfecho}</span>
            {sol.grau_urgencia?.startsWith("Alta") && <span style={{ fontSize: 12.5, fontWeight: 900, background: "#fff", color: "#b91c1c", borderRadius: 999, padding: "7px 13px" }}>⚡ Urgente</span>}
          </div>
          <div className="sts-bar sts-up" style={{ animationDelay: ".25s" }}><i style={{ "--w": `${progresso}%` } as React.CSSProperties} /></div>
          <div className="sts-pills sts-up" style={{ animationDelay: ".32s" }}>
            <span>📊 <b>{progresso}%</b> do fluxo</span>
            <span>📅 aberta há <b>{r.diasAberta}</b> dia{r.diasAberta === 1 ? "" : "s"}</span>
            <span>⏱ <b>{r.diasNoStatus}</b> dia{r.diasNoStatus === 1 ? "" : "s"} no status atual</span>
            <span>📜 <b>{r.mudancas}</b> mudança{r.mudancas === 1 ? "" : "s"} de status</span>
          </div>
        </div>

        <div className="sts-body">
          <div className="sts-sec">
            <div className="sts-sec-t">Onde a vaga está</div>
            <div className="sts-regua">
              {PASSOS_FLUXO.map((p, i) => (
                <div key={p.chave} className="sts-passo" data-e={estados[i]} style={{ animationDelay: `${.25 + i * .07}s` }}>
                  <div className="sts-bola">{estados[i] === "feito" ? "✓" : estados[i] === "parado" ? "✕" : p.icone}</div>
                  <div className="sts-passo-t">{p.titulo}</div>
                  <div className="sts-passo-q">{p.quem}</div>
                  {estados[i] === "atual" && <span className="sts-passo-tag" style={{ background: "#0f3171", color: "#fff" }}>agora</span>}
                  {estados[i] === "parado" && <span className="sts-passo-tag" style={{ background: "#fee2e2", color: "#b91c1c" }}>{desfecho === "cancelada" ? "cancelada aqui" : "reprovada aqui"}</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="sts-kpis">
            {[
              ["Dias em aberto", r.diasAberta, "#0f3171", sol.created_at ? `desde ${fmtDt(sol.created_at)}` : ""],
              ["No status atual", r.diasNoStatus, "#2563eb", "dias parado neste passo"],
              ["Mudanças de status", r.mudancas, "#7c3aed", "da solicitação"],
              ["Eventos no histórico", r.eventos, "#0e7490", r.ultimaEm ? `último em ${fmtDt(r.ultimaEm)}` : ""],
            ].map(([l, v, c, s], i) => (
              <div key={String(l)} className="sts-kpi sts-up" style={{ "--c": c, animationDelay: `${.5 + i * .06}s` } as React.CSSProperties}>
                <div className="sts-kpi-l">{l}</div><div className="sts-kpi-v">{v}</div>{s ? <div className="sts-kpi-s">{s}</div> : null}
              </div>
            ))}
          </div>

          <div className="sts-sec">
            <div className="sts-sec-t">Histórico completo</div>
            {eventos === null ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Carregando histórico…</div>
              : eventos.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Nenhum evento registrado ainda — a solicitação foi criada em {fmtDtHora(sol.created_at)}.</div>
              : (
                <div className="sts-tl">
                  {eventos.map((e, i) => {
                    const cor = PAPEL_COR[e.papel ?? ""] ?? "#0f3171";
                    return (
                      <div key={e.id} className="sts-ev" style={{ "--c": cor, animationDelay: `${.55 + Math.min(i, 12) * .06}s` } as React.CSSProperties}>
                        <div className="sts-ev-h">
                          <div className="sts-ev-t">{e.evento || "Movimentação"}{e.candidato_nome ? <span style={{ fontWeight: 600, color: "#475569" }}> · {e.candidato_nome}</span> : null}</div>
                          <div className="sts-ev-d">{fmtDtHora(e.created_at)}</div>
                        </div>
                        <div className="sts-ev-m">
                          {e.papel && <span className="sts-tag" style={{ background: `${cor}18`, color: cor }}>{e.papel}</span>}
                          <span>👤 {nome(e)}</span>
                          {e.para_status && e.para_status !== e.de_status && (
                            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                              {e.de_status && <span className="sts-de">{e.de_status}</span>}
                              {e.de_status && <span style={{ color: "#94a3b8" }}>→</span>}
                              <span className="sts-para">{e.para_status}</span>
                            </span>
                          )}
                        </div>
                        {e.detalhe && <div style={{ fontSize: 12.5, color: "#475569", marginTop: 6, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{e.detalhe}</div>}
                      </div>
                    );
                  })}
                  <div className="sts-ev" style={{ "--c": "#94a3b8", animationDelay: `${.55 + Math.min(eventos.length, 12) * .06}s` } as React.CSSProperties}>
                    <div className="sts-ev-h"><div className="sts-ev-t">Solicitação criada</div><div className="sts-ev-d">{fmtDtHora(sol.created_at)}</div></div>
                    {sol.solicitante_nome && <div className="sts-ev-m"><span>👤 {sol.solicitante_nome}</span></div>}
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
