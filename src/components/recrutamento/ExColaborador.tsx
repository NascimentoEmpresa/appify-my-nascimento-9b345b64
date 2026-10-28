import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { History } from "lucide-react";
import {
  JANELA_EX_COLABORADOR, textoSaida, vinculoNaEmpresa,
  type CadastroEmpresa, type VinculoEmpresa,
} from "@/lib/recrutamento/exColaborador";

// "Já trabalhou conosco — saiu há quanto tempo?" (27/10/2026). Selo ao lado
// do nome e bloco nos detalhes do candidato, na Gestão Recrutamento, no Banco
// de Talentos e nas filas por setor (CandidatoInfo). A regra mora em
// src/lib/recrutamento/exColaborador.ts; aqui só busca e desenha.

const sb = supabase as unknown as SupabaseClient;
const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Cadastros em EMPREGADOS de um CPF (vazio sem CPF ou sem a RPC). */
export async function buscarCadastrosEmpresa(cpf: unknown): Promise<CadastroEmpresa[]> {
  if (soDigitos(cpf).length !== 11) return [];
  const { data, error } = await sb.rpc("empregados_por_cpfs", { p_cpfs: [String(cpf)] });
  return error || !Array.isArray(data) ? [] : data;
}

/**
 * Uma chamada para a lista inteira (cards do Banco de Talentos), não uma por
 * card. Devolve CPF (só dígitos) → cadastros.
 */
export function useCadastrosEmpresa(cpfs: unknown[]): Map<string, CadastroEmpresa[]> {
  const [mapa, setMapa] = useState<Map<string, CadastroEmpresa[]>>(new Map());
  const lista = useMemo(() => Array.from(new Set(cpfs.map(soDigitos).filter(d => d.length === 11))).sort(), [cpfs]);
  const assinatura = lista.join("|");
  useEffect(() => {
    let vivo = true;
    if (!lista.length) { setMapa(new Map()); return; }
    (async () => {
      const m = new Map<string, CadastroEmpresa[]>();
      // Lotes de 500: a lista do banco de talentos passa de mil CPFs.
      for (let i = 0; i < lista.length; i += 500) {
        const { data, error } = await sb.rpc("empregados_por_cpfs", { p_cpfs: lista.slice(i, i + 500) });
        if (error || !Array.isArray(data)) continue;
        for (const e of data as (CadastroEmpresa & { cpf_match: string })[]) {
          if (!m.has(e.cpf_match)) m.set(e.cpf_match, []);
          m.get(e.cpf_match)!.push(e);
        }
      }
      if (vivo) setMapa(m);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);
  return mapa;
}

/** O vínculo de um CPF, a partir do mapa do hook acima. */
export const vinculoDoCpf = (mapa: Map<string, CadastroEmpresa[]>, cpf: unknown): VinculoEmpresa =>
  vinculoNaEmpresa(mapa.get(soDigitos(cpf)));

/** Vínculo de um único candidato, buscado ao montar (lupa, filas por setor). */
export function useVinculoEmpresa(cpf: unknown): VinculoEmpresa {
  const [v, setV] = useState<VinculoEmpresa>({ tipo: "nenhum" });
  const d = soDigitos(cpf);
  useEffect(() => {
    let vivo = true;
    setV({ tipo: "nenhum" });
    buscarCadastrosEmpresa(d).then(c => { if (vivo) setV(vinculoNaEmpresa(c)); });
    return () => { vivo = false; };
  }, [d]);
  return v;
}

const cores = (v: VinculoEmpresa) =>
  v.tipo === "saiu" && v.recente ? { bg: "#fee2e2", brd: "#fecaca", c: "#b91c1c" }
    : v.tipo === "saiu" ? { bg: "#fef3c7", brd: "#fde68a", c: "#92400e" }
    : { bg: "#e0f2fe", brd: "#bae6fd", c: "#0369a1" };

/** Selo ao lado do nome. Some quando a pessoa nunca trabalhou na empresa. */
export function SeloExColaborador({ vinculo }: { vinculo: VinculoEmpresa }) {
  if (vinculo.tipo === "nenhum") return null;
  const k = cores(vinculo);
  const txt = vinculo.tipo === "ativo" ? "Colaborador ativo" : `Ex-colaborador · ${textoSaida(vinculo).replace(/^Saiu /, "saiu ")}`;
  return (
    <span title={vinculo.tipo === "saiu" && vinculo.recente ? `Saiu há ${JANELA_EX_COLABORADOR} dias ou menos` : undefined}
      style={{ display: "inline-flex", alignItems: "center", fontSize: 10, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: k.bg, color: k.c, border: `1px solid ${k.brd}`, whiteSpace: "nowrap" }}>
      <History size={11} strokeWidth={2} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5, flexShrink: 0 }} />{txt}
    </span>
  );
}

/** Bloco dos detalhes do candidato: a última passagem e há quanto tempo saiu. */
export function BlocoExColaborador({ vinculo }: { vinculo: VinculoEmpresa }) {
  if (vinculo.tipo === "nenhum") return null;
  const k = cores(vinculo);
  const c = vinculo.cadastro;
  const campo = (label: string, val: unknown) => val ? (
    <div><span style={{ color: "#94a3b8", fontWeight: 700 }}>{label}: </span>{String(val)}</div>
  ) : null;
  return (
    <div style={{ background: k.bg, border: `1px solid ${k.brd}`, borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: k.c }}>
        <History size={14} strokeWidth={2} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5, flexShrink: 0 }} />
        {vinculo.tipo === "ativo" ? "Trabalha na empresa hoje" : `Já trabalhou conosco — ${textoSaida(vinculo).replace(/^Saiu /, "saiu ")}`}
      </div>
      {vinculo.tipo === "saiu" && vinculo.recente && (
        <div style={{ fontSize: 11.5, color: k.c, marginTop: 3 }}>Saída nos últimos {JANELA_EX_COLABORADOR} dias.</div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 14px", marginTop: 6, fontSize: 12, color: "#334155" }}>
        {campo("Cargo", c.cargo)}
        {campo("Situação", c.situacao)}
        {campo("Admissão", c.admissao)}
        {campo("Saída", vinculo.tipo === "saiu" && vinculo.saida ? vinculo.saida.split("-").reverse().join("/") : null)}
        {campo("Empresa", c.empresa)}
        {campo("Filial", c.filial)}
      </div>
    </div>
  );
}
