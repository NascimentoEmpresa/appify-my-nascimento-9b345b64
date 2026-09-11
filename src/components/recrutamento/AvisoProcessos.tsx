import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// "Este candidato já processou a empresa" — o aviso que o Recrutamento vê ao
// lado do nome (11/09/2026). A resposta vem da RPC rec_processos_do_candidato
// (migration 20260930000092): quem trabalha candidatos não lê JUR_PROCESSOS,
// só recebe "processou / qual". Casa por CPF quando o processo tem o CPF
// vinculado, senão pelo nome completo — homônimo pode dar falso positivo, e
// é por isso que o texto diz "confira", não "reprove".

export interface ProcessoDoCandidato {
  id_sequencial: number;
  numero_processo: string;
  reclamante: string;
  cpf_digits: string | null;
  nome_chave: string | null;
  status: string | null;
  casou_por: "cpf" | "nome";
}

const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Mesma normalização de rec_nome_chave no banco: maiúsculo, sem acento, um espaço. */
export const nomeChave = (v: unknown) =>
  String(v ?? "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

export type MapaProcessos = Map<string, ProcessoDoCandidato[]>;

/** Chaves sob as quais um candidato pode aparecer no mapa. */
const chavesDe = (c: { cpf?: unknown; nome?: unknown }): string[] => {
  const ks: string[] = [];
  const d = soDigitos(c.cpf);
  if (d.length === 11) ks.push("cpf:" + d);
  const n = nomeChave(c.nome);
  if (n.length >= 5) ks.push("nome:" + n);
  return ks;
};

/** Os processos de um candidato, sem repetir o mesmo processo que casou por CPF e por nome. */
export function processosDe(mapa: MapaProcessos, c: { cpf?: unknown; nome?: unknown }): ProcessoDoCandidato[] {
  const vistos = new Set<number>();
  const out: ProcessoDoCandidato[] = [];
  for (const k of chavesDe(c)) {
    for (const p of mapa.get(k) ?? []) {
      if (vistos.has(p.id_sequencial)) continue;
      vistos.add(p.id_sequencial);
      out.push(p);
    }
  }
  return out;
}

/**
 * Uma chamada para a lista inteira (kanban, banco de talentos), não uma por
 * card. Recalcula quando a lista de CPFs/nomes muda de verdade.
 */
export function useProcessosDosCandidatos(cands: { cpf?: unknown; nome?: unknown }[]): MapaProcessos {
  const [mapa, setMapa] = useState<MapaProcessos>(new Map());
  const cpfs = useMemo(() => Array.from(new Set(cands.map(c => soDigitos(c.cpf)).filter(d => d.length === 11))), [cands]);
  const nomes = useMemo(() => Array.from(new Set(cands.map(c => nomeChave(c.nome)).filter(n => n.length >= 5))), [cands]);
  const assinatura = cpfs.join("|") + "#" + nomes.join("|");

  useEffect(() => {
    let vivo = true;
    if (!cpfs.length && !nomes.length) { setMapa(new Map()); return; }
    (async () => {
      const { data, error } = await (supabase as any).rpc("rec_processos_do_candidato", { p_cpfs: cpfs, p_nomes: nomes });
      if (!vivo) return;
      // Banco ainda sem a RPC: sem aviso, sem quebrar a tela.
      if (error || !Array.isArray(data)) { setMapa(new Map()); return; }
      const m: MapaProcessos = new Map();
      for (const p of data as ProcessoDoCandidato[]) {
        const k = p.cpf_digits ? "cpf:" + p.cpf_digits : "nome:" + (p.nome_chave ?? "");
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(p);
      }
      setMapa(m);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);

  return mapa;
}

/**
 * O aviso em si. `compacto` é o chip do card do kanban (só "⚖️ 2 processos");
 * o completo lista cada processo com número, como o Jurídico se refere a ele
 * ("#410 · 0021423-52.2025.5.04.0406").
 */
export function AvisoProcessos({ processos, compacto = false }: { processos: ProcessoDoCandidato[]; compacto?: boolean }) {
  if (!processos.length) return null;
  const titulo = processos.map(p => `#${p.id_sequencial} · ${p.numero_processo}${p.status ? ` (${p.status})` : ""}`).join("\n");
  if (compacto) {
    return (
      <span title={`Já processou a empresa:\n${titulo}`}
        style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", whiteSpace: "nowrap" }}>
        ⚖️ {processos.length === 1 ? "já processou a empresa" : `${processos.length} processos`}
      </span>
    );
  }
  const porNome = processos.some(p => p.casou_por === "nome");
  return (
    <div style={{ fontSize: 12, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 10, padding: "8px 11px", lineHeight: 1.5 }}>
      <div style={{ fontWeight: 800 }}>⚖️ Este candidato já processou a empresa</div>
      {processos.map(p => (
        <div key={p.id_sequencial} style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5 }}>
          #{p.id_sequencial} · {p.numero_processo}
          {p.status && <span style={{ color: "#b91c1c", fontFamily: "inherit", fontWeight: 600 }}> — {p.status}</span>}
          <span style={{ color: "#b91c1c", fontFamily: "inherit" }}> · {p.reclamante}</span>
        </div>
      ))}
      {porNome && (
        <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 2 }}>
          Casou pelo nome completo (o processo não tem CPF vinculado) — confira com o Jurídico antes de decidir.
        </div>
      )}
    </div>
  );
}
