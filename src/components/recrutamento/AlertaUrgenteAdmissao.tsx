import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { BUCKET_CRACHAS } from "@/lib/suprimentos/fotoCracha";

// =====================================================================
// Admissão URGENTE — o card que treme na tela do SST e do Compras
// (14/10/2026, mig 20261014000045).
//
// Pablo: "RH ao enviar pro COMPRAS e SST tem que conseguir marcar como
// urgente […] deve chegar um card tremendo de notificação pros respectivos
// setores, SST e suprimentos/compras, um card mostrando a solicitação e
// botões pra interagir e ver."
//
// Fica no AppShell (qualquer rota) e não numa tela: quem precisa ver o
// urgente é justamente quem NÃO está com a fila aberta. Aparece para quem tem
// a fila do setor (SST › ASO admissão = `sst_aso`; Suprimentos › EPIs —
// Admissões = `sup_epis_admissao`) e some quando alguém do setor dá "visto"
// (ou decide o candidato). Consulta a cada minuto e ao voltar para a aba —
// leve: índice parcial em WA_CURRICULOS só com os urgentes.
// =====================================================================

const db = supabase as unknown as SupabaseClient;
const ETAPAS_PARALELO = ["SST + COMPRAS", "EXAME SST", "COMPRAS"];
const INTERVALO_MS = 60_000;

type Setor = "sst" | "compras";
interface Urgente {
  candidato_id: number; nome: string; cargo: string | null; contrato: string | null; cidade: string | null;
  urgente_sst: boolean; urgente_compras: boolean; urgente_em: string | null; urgente_por: string | null; urgente_motivo: string | null;
  sst_visto_em: string | null; compras_visto_em: string | null; sst_ok: boolean | null; compras_ok: boolean | null;
}

const ROTA: Record<Setor, string> = { sst: "/app/sst/aso", compras: "/app/suprimentos/epis-admissoes" };
const ROTULO: Record<Setor, string> = { sst: "SST — exame admissional", compras: "Compras — EPIs e materiais" };

/** Miniatura da foto do crachá (bucket privado: signed URL). */
export function FotoCrachaCandidato({ caminho, tamanho = 56 }: { caminho?: string | null; tamanho?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!caminho) return;
    if (/^https?:\/\//i.test(caminho)) { setUrl(caminho); return; }
    let vivo = true;
    db.storage.from(BUCKET_CRACHAS).createSignedUrl(caminho.replace(/^\/+/, ""), 600)
      .then(({ data }) => { if (vivo) setUrl(data?.signedUrl ?? null); });
    return () => { vivo = false; };
  }, [caminho]);
  if (!caminho) return null;
  return (
    <a href={url ?? undefined} target="_blank" rel="noopener noreferrer" title="Foto do crachá — abrir"
      style={{ width: tamanho, height: Math.round(tamanho * 1.25), flexShrink: 0, borderRadius: 8, overflow: "hidden", background: "#f1f5f9",
               border: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
      {url ? <img src={url} alt="Foto do crachá" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "🪪"}
    </a>
  );
}

export function AlertaUrgenteAdmissao() {
  const { user } = useAuth();
  const { can } = usePermissoes();
  const navigate = useNavigate();
  const location = useLocation();
  const veSst = can("visualizar", undefined, "sst_aso");
  const veCompras = can("visualizar", undefined, "sup_epis_admissao");
  const nome = user?.user_metadata?.nome ?? user?.email ?? "";
  const [lista, setLista] = useState<Array<Urgente & { setor: Setor }>>([]);
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!user?.id || (!veSst && !veCompras)) { setLista([]); return; }
    const ors: string[] = [];
    if (veSst) ors.push("and(urgente_sst.is.true,sst_visto_em.is.null,sst_ok.is.null)");
    if (veCompras) ors.push("and(urgente_compras.is.true,compras_visto_em.is.null,compras_ok.is.null)");
    const { data } = await db.from("VW_RECRUTAMENTO_CANDIDATOS")
      .select("candidato_id,nome,cargo,contrato,cidade,urgente_sst,urgente_compras,urgente_em,urgente_por,urgente_motivo,sst_visto_em,compras_visto_em,sst_ok,compras_ok")
      .in("etapa_processo", ETAPAS_PARALELO).or(ors.join(","))
      .order("urgente_em", { ascending: true }).limit(20);
    const itens: Array<Urgente & { setor: Setor }> = [];
    for (const c of (data ?? []) as Urgente[]) {
      if (veSst && c.urgente_sst && !c.sst_visto_em && c.sst_ok == null) itens.push({ ...c, setor: "sst" });
      if (veCompras && c.urgente_compras && !c.compras_visto_em && c.compras_ok == null) itens.push({ ...c, setor: "compras" });
    }
    setLista(itens);
  }, [user?.id, veSst, veCompras]);

  useEffect(() => {
    carregar();
    const t = window.setInterval(carregar, INTERVALO_MS);
    const foco = () => { if (document.visibilityState === "visible") carregar(); };
    document.addEventListener("visibilitychange", foco);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", foco); };
  }, [carregar]);
  // Trocar de tela (ex.: abriu a fila e decidiu) pede uma conferida.
  useEffect(() => { carregar(); }, [location.pathname, carregar]);

  const marcarVisto = async (u: Urgente & { setor: Setor }) => {
    setSalvando(`${u.setor}:${u.candidato_id}`);
    const agora = new Date().toISOString();
    const patch = u.setor === "sst" ? { sst_visto_em: agora, sst_visto_por: nome } : { compras_visto_em: agora, compras_visto_por: nome };
    const { error } = await db.from("WA_CURRICULOS").update(patch).eq("id", u.candidato_id);
    setSalvando(null);
    if (!error) setLista((l) => l.filter((x) => !(x.candidato_id === u.candidato_id && x.setor === u.setor)));
  };

  if (!lista.length) return null;
  const visiveis = lista.slice(0, 3);

  return (
    <div role="alert" aria-live="assertive"
      style={{ position: "fixed", right: 20, bottom: 96, zIndex: 60, width: "min(360px, calc(100vw - 32px))", display: "grid", gap: 10 }}>
      <style>{`
        @keyframes urgente-treme {
          0%, 78%, 100% { transform: translateX(0) rotate(0); }
          80% { transform: translateX(-6px) rotate(-1.5deg); }
          84% { transform: translateX(6px) rotate(1.5deg); }
          88% { transform: translateX(-5px) rotate(-1deg); }
          92% { transform: translateX(5px) rotate(1deg); }
          96% { transform: translateX(-2px) rotate(0); }
        }
        .urgente-card { animation: urgente-treme 2.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .urgente-card { animation: none; } }
      `}</style>
      {visiveis.map((u) => {
        const chave = `${u.setor}:${u.candidato_id}`;
        return (
          <div key={chave} className="urgente-card"
            style={{ background: "#fff", border: "2px solid #dc2626", borderRadius: 14, boxShadow: "0 12px 32px rgba(220,38,38,.28)", overflow: "hidden" }}>
            <div style={{ background: "#dc2626", color: "#fff", padding: "6px 12px", fontSize: 12, fontWeight: 800, letterSpacing: ".4px", display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>🚨 ADMISSÃO URGENTE</span>
              <span style={{ fontWeight: 700, opacity: .9 }}>{ROTULO[u.setor]}</span>
            </div>
            <div style={{ padding: "10px 12px" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{u.nome}</div>
              <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
                {[u.cargo, u.contrato, u.cidade].filter(Boolean).join(" · ") || "—"}
              </div>
              {(u.urgente_motivo || u.urgente_por) && (
                <div style={{ fontSize: 12, color: "#991b1b", background: "#fef2f2", borderRadius: 8, padding: "5px 8px", marginTop: 7 }}>
                  {u.urgente_motivo ? <b>{u.urgente_motivo}</b> : null}
                  {u.urgente_por ? <span>{u.urgente_motivo ? " — " : "Marcado por "}{u.urgente_por}</span> : null}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
                <button type="button" onClick={() => navigate(`${ROTA[u.setor]}?abrir=${u.candidato_id}`)}
                  style={{ flex: 1, padding: "7px 10px", borderRadius: 9, border: "none", background: "#dc2626", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                  Ver solicitação
                </button>
                <button type="button" disabled={salvando === chave} onClick={() => marcarVisto(u)}
                  style={{ flex: 1, padding: "7px 10px", borderRadius: 9, border: "1px solid #fca5a5", background: "#fff", color: "#b91c1c", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", opacity: salvando === chave ? .6 : 1 }}>
                  👁 Marcar como visto
                </button>
              </div>
            </div>
          </div>
        );
      })}
      {lista.length > visiveis.length && (
        <div style={{ textAlign: "right", fontSize: 12, fontWeight: 700, color: "#b91c1c" }}>+{lista.length - visiveis.length} urgente(s) na fila</div>
      )}
    </div>
  );
}
