import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import {
  acimaDoOrcamento, contratosDoGrafico, desvioTotal, FOLGA_ORCAMENTO, rotuloCompetencias, tomDesvio, type DadosRhSalariosTv,
} from "@/lib/tv/rhSalariosTv";
import { FONTE, LARANJA, TINTA, TINTA_SUAVE } from "./base";

// =====================================================================
// TV › RH — Salários e benefícios × orçamento (11/11/2026, mig 20261111220000).
// Gráfico por contrato: barra do orçado e do realizado lado a lado (crescem
// ao entrar) e o desvio. Regras: src/lib/tv/rhSalariosTv.ts.
// =====================================================================

const COR = { bom: "#16a34a", atencao: "#d97706", critico: "#dc2626" } as const;
const ROXO = "#4f46e5";
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const curto = (c: string) => c.replace(/\s+-\s+\d[\d./\s-]*$/, "").trim() || c;

export function TelaRhSalarios({ d, atualizado }: { d: DadosRhSalariosTv; atualizado: string | null }) {
  const [pronto, setPronto] = useState(false);
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => { const t = window.setTimeout(() => setPronto(true), 80); return () => window.clearTimeout(t); }, []);
  useEffect(() => { const t = window.setInterval(() => setAgora(new Date()), 15_000); return () => window.clearInterval(t); }, []);
  const lista = contratosDoGrafico(d);
  const max = Math.max(1, ...lista.map((c) => Math.max(c.orc_sal + c.orc_ben, c.real_sal + c.real_ben)));
  const total = desvioTotal(d);
  const acima = acimaDoOrcamento(d);
  const comps = rotuloCompetencias(d.competencias);

  return (
    <div className="flex h-full w-full flex-col gap-6 px-10 pb-6 pt-6" style={{ fontFamily: FONTE, background: "linear-gradient(180deg,#f5f3ff 0%,#f8fafc 100%)" }}>
      <div className="relative flex shrink-0 items-center gap-6 overflow-hidden rounded-[28px] px-12 text-white" style={{ height: 130, background: "linear-gradient(110deg,#3730a3 0%,#6d28d9 60%,#7c3aed 100%)" }}>
        <span className="grid h-[84px] w-[84px] shrink-0 place-items-center rounded-[22px]" style={{ background: "rgba(255,255,255,0.16)" }}><Wallet style={{ width: 46, height: 46 }} /></span>
        <div className="min-w-0 flex-1">
          <p className="font-bold uppercase tracking-widest opacity-85" style={{ fontSize: 20 }}>Recursos Humanos</p>
          <p className="font-black leading-tight tracking-tight" style={{ fontSize: 50 }}>Salários e benefícios × orçamento</p>
        </div>
        <p className="shrink-0 font-black leading-none tabular-nums" style={{ fontSize: 72 }}>{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
        <div className="shrink-0 rounded-2xl px-5 py-3 text-center font-black uppercase leading-tight tracking-wider" style={{ fontSize: 19, background: LARANJA }}>Grupo<br />Nascimento</div>
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-6" style={{ height: 150 }}>
        {[
          { t: "Orçado (Planilha de Custo)", v: d.orcado != null ? brl(d.orcado) : "—", cor: TINTA },
          { t: "Realizado (folha + rateios)", v: d.realizado != null ? brl(d.realizado) : "—", cor: TINTA },
          { t: `Contratos acima do orçado (+${FOLGA_ORCAMENTO}%)`, v: `${acima} de ${d.contratos.length}`, cor: acima ? COR.critico : COR.bom,
            sub: total != null ? `no total: ${pct(total)} do orçado` : "" },
        ].map((k) => (
          <div key={k.t} className="flex flex-col justify-center rounded-[24px] bg-white px-8" style={{ boxShadow: "0 10px 30px -14px rgba(15,23,42,.28)" }}>
            <p className="font-extrabold" style={{ fontSize: 22, color: TINTA_SUAVE }}>{k.t}</p>
            <p className="font-black tabular-nums" style={{ fontSize: 56, color: k.cor }}>{k.v}</p>
            {"sub" in k && k.sub && <p className="font-semibold" style={{ fontSize: 19, color: TINTA_SUAVE }}>{k.sub}</p>}
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-[26px] bg-white px-10 py-6" style={{ boxShadow: "0 10px 30px -14px rgba(15,23,42,.28)" }}>
        <div className="mb-4 flex items-center gap-6">
          <p className="flex-1 font-extrabold" style={{ fontSize: 28, color: TINTA }}>Os contratos que mais consomem o orçamento de pessoal</p>
          <span className="flex items-center gap-2 font-semibold" style={{ fontSize: 19, color: TINTA_SUAVE }}><i className="inline-block h-4 w-4 rounded" style={{ background: "#c7d2fe" }} />Orçado</span>
          <span className="flex items-center gap-2 font-semibold" style={{ fontSize: 19, color: TINTA_SUAVE }}><i className="inline-block h-4 w-4 rounded" style={{ background: ROXO }} />Realizado</span>
        </div>
        {lista.length ? (
          <div className="flex min-h-0 flex-1 flex-col justify-between">
            {lista.map((c, i) => {
              const tom = tomDesvio(c.desvio);
              const orc = c.orc_sal + c.orc_ben;
              const real = c.real_sal + c.real_ben;
              return (
                <div key={c.contrato} className="grid grid-cols-[340px_1fr_150px] items-center gap-5">
                  <p className="truncate text-right font-bold" style={{ fontSize: 20, color: TINTA }}>{curto(c.contrato)}</p>
                  <div className="space-y-1">
                    {[{ v: orc, cor: "#c7d2fe" }, { v: real, cor: tom === "bom" ? ROXO : COR[tom] }].map((b, j) => (
                      <div key={j} className="flex items-center gap-3">
                        <div className="h-3.5 rounded-r-full" style={{ width: pronto ? `${(b.v / max) * 85}%` : "0%", background: b.cor, transition: `width 900ms cubic-bezier(.2,.8,.2,1) ${i * 70 + j * 120}ms` }} />
                        <span className="font-bold tabular-nums" style={{ fontSize: 16, color: TINTA_SUAVE }}>{brl(b.v)}</span>
                      </div>
                    ))}
                  </div>
                  <span className="justify-self-end rounded-full px-4 py-1 font-black tabular-nums" style={{ fontSize: 24, color: COR[tom], background: tom === "bom" ? "#dcfce7" : tom === "atencao" ? "#fef3c7" : "#fee2e2" }}>{pct(c.desvio)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="font-bold" style={{ fontSize: 28, color: TINTA_SUAVE }}>Nenhum contrato com Planilha de Custo executada e folha para comparar.</p>
        )}
      </div>

      <p className="shrink-0 font-semibold" style={{ fontSize: 17, color: TINTA_SUAVE }}>
        Realizado = salário-base dos ativos (folha Senior) + rateio de {comps || "VT, BSF e seguro"}. Orçado = as mesmas linhas da Planilha de Custo executada vigente.
        VA/VR e demais benefícios sem lançamento por contrato ficam de fora.{atualizado ? ` Atualizado às ${atualizado}.` : ""}
      </p>
    </div>
  );
}
