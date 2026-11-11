import { useEffect, useState } from "react";
import { Building2, CheckCircle2 } from "lucide-react";
import {
  COBERTURA_CRITICA, CUSTO_ATENCAO, FALTAS_ATENCAO, INDICADORES, MARGEM_PADRAO, TURNOVER_META_MES,
  type ChaveInd, type LinhaContrato, type ResultadoInd, type StatusInd,
} from "@/lib/operacional/indicadoresContratos";
import { linhasDaTv, paginasOpeContratos, SEGUNDOS_POR_CONTRATO, topImpacto, type DadosOpeContratosTv } from "@/lib/tv/opeContratosTv";
import { FONTE, LARANJA, TINTA, TINTA_SUAVE } from "./base";

// =====================================================================
// TV › Operacional — Indicadores por Contrato (11/11/2026, mig 20261111130000)
// Abre com os 5 contratos que mais pedem atenção e passa um contrato por tela
// (10 s cada). Contas: src/lib/operacional/indicadoresContratos.ts (as mesmas
// da tela), ordem e páginas: src/lib/tv/opeContratosTv.ts.
// Regra das TVs (Pablo): "ruim" só quando é verdadeiro — sem dado ou sem fonte
// fica cinza, nunca vermelho.
// =====================================================================

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const rotuloComp = (c: string) => `${MESES[Number(c.slice(5, 7)) - 1]}/${c.slice(0, 4)}`;

const COR: Record<StatusInd, { fundo: string; tinta: string; rotulo: string }> = {
  ok: { fundo: "#dcfce7", tinta: "#15803d", rotulo: "Dentro do esperado" },
  atencao: { fundo: "#fef3c7", tinta: "#b45309", rotulo: "Atenção" },
  critico: { fundo: "#fee2e2", tinta: "#b91c1c", rotulo: "Crítico" },
  sem_dado: { fundo: "#f4f4f5", tinta: "#71717a", rotulo: "Sem base no mês" },
  sem_fonte: { fundo: "#f4f4f5", tinta: "#71717a", rotulo: "Sem fonte" },
};

const curtoNome = (n: string) => n.replace(/\s+-\s+\d[\d./\s-]*$/, "").trim() || n;

/** Barra com a régua (meta) marcada. Valores em %, escala 0..max. */
function Medidor({ valor, max, meta, cor }: { valor: number; max: number; meta?: number | null; cor: string }) {
  const p = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <div className="relative mt-4 h-5 w-full overflow-hidden rounded-full" style={{ background: "#e4e4e7" }}>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: p(valor), background: cor }} />
      {meta != null && <div className="absolute inset-y-[-4px] w-1.5 rounded" style={{ left: p(meta), background: TINTA }} />}
    </div>
  );
}

function medidorDe(chave: ChaveInd, r: ResultadoInd, margemPrevista: number | null, cor: string) {
  if (r.valor == null || (r.status !== "ok" && r.status !== "atencao" && r.status !== "critico")) return null;
  switch (chave) {
    case "postos": return <Medidor valor={r.valor} max={100} meta={COBERTURA_CRITICA} cor={cor} />;
    case "lucratividade": {
      const meta = margemPrevista ?? MARGEM_PADRAO;
      return <Medidor valor={Math.max(r.valor, 0)} max={Math.max(meta * 2, r.valor, 20)} meta={meta} cor={cor} />;
    }
    case "custo": return <Medidor valor={Math.max(r.valor + 30, 0)} max={60} meta={30 + CUSTO_ATENCAO} cor={cor} />;
    case "faltas": return <Medidor valor={r.valor} max={Math.max(FALTAS_ATENCAO * 3, r.valor)} meta={FALTAS_ATENCAO} cor={cor} />;
    case "turnover": return <Medidor valor={r.valor} max={Math.max(TURNOVER_META_MES * 4, r.valor)} meta={TURNOVER_META_MES} cor={cor} />;
    default: return null;
  }
}

function TileIndicador({ chave, r, margemPrevista }: { chave: ChaveInd; r: ResultadoInd; margemPrevista: number | null }) {
  const def = INDICADORES.find((i) => i.chave === chave)!;
  const c = COR[r.status];
  return (
    <div className="flex min-h-0 flex-col rounded-[28px] bg-white px-8 py-7" style={{ boxShadow: "0 10px 30px -12px rgba(15,23,42,.25)", borderTop: `10px solid ${c.tinta}` }}>
      <div className="flex items-start justify-between gap-4">
        <p className="font-extrabold uppercase leading-tight tracking-wide" style={{ fontSize: 24, color: TINTA_SUAVE }}>{def.curto}</p>
        <span className="shrink-0 rounded-full px-4 py-1 font-bold" style={{ fontSize: 18, background: c.fundo, color: c.tinta }}>{c.rotulo}</span>
      </div>
      <p className="mt-3 font-black leading-none tabular-nums" style={{ fontSize: 76, color: r.status === "sem_fonte" || r.status === "sem_dado" ? TINTA_SUAVE : TINTA }}>
        {r.status === "sem_fonte" ? "—" : r.texto}
      </p>
      {medidorDe(chave, r, margemPrevista, c.tinta)}
      <p className="mt-auto pt-4 font-semibold leading-snug" style={{ fontSize: 21, color: TINTA_SUAVE, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {r.detalhe}
      </p>
    </div>
  );
}

function PaginaContrato({ l, margemPrevista }: { l: LinhaContrato; margemPrevista: number | null }) {
  const ordem: ChaveInd[] = ["postos", "lucratividade", "custo", "glosas", "faltas", "turnover", "reclamacoes"];
  return (
    <div className="grid h-full grid-cols-4 grid-rows-2 gap-7">
      {/* Resumo do contrato: o primeiro bloco da grade */}
      <div className="flex flex-col justify-between rounded-[28px] px-9 py-8 text-white" style={{ background: "linear-gradient(140deg,#0f3171,#1e40af)" }}>
        <div>
          <p className="font-bold uppercase tracking-widest opacity-80" style={{ fontSize: 20 }}>Contrato</p>
          <p className="mt-3 font-black leading-[1.05]" style={{ fontSize: 44, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{curtoNome(l.nome)}</p>
          {l.cliente && <p className="mt-3 font-semibold opacity-85" style={{ fontSize: 22, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{l.cliente}</p>}
        </div>
        {l.criticos || l.atencoes ? (
          <div className="flex flex-wrap gap-3">
            {l.criticos > 0 && <span className="rounded-full px-5 py-2 font-extrabold" style={{ fontSize: 24, background: "#fee2e2", color: "#b91c1c" }}>{l.criticos} crítico{l.criticos > 1 ? "s" : ""}</span>}
            {l.atencoes > 0 && <span className="rounded-full px-5 py-2 font-extrabold" style={{ fontSize: 24, background: "#fef3c7", color: "#b45309" }}>{l.atencoes} em atenção</span>}
          </div>
        ) : (
          <p className="flex items-center gap-3 font-extrabold" style={{ fontSize: 28 }}><CheckCircle2 style={{ width: 40, height: 40 }} /> Tudo dentro do esperado</p>
        )}
      </div>
      {ordem.map((k) => <TileIndicador key={k} chave={k} r={l.ind[k]} margemPrevista={k === "lucratividade" ? margemPrevista : null} />)}
    </div>
  );
}

function PaginaTop({ linhas }: { linhas: LinhaContrato[] }) {
  const top = topImpacto(linhas);
  return (
    <div className="flex h-full flex-col gap-5">
      <p className="font-extrabold" style={{ fontSize: 40, color: TINTA }}>Os {top.length} contratos que mais pedem atenção</p>
      <div className="grid min-h-0 flex-1 gap-5" style={{ gridTemplateRows: `repeat(${Math.max(top.length, 1)}, minmax(0,1fr))` }}>
        {top.map((l, i) => {
          const fora = INDICADORES.filter((d) => l.ind[d.chave].status === "critico" || l.ind[d.chave].status === "atencao");
          return (
            <div key={l.id} className="flex min-h-0 items-center gap-8 rounded-[26px] bg-white px-8" style={{ boxShadow: "0 10px 30px -14px rgba(15,23,42,.25)" }}>
              <span className="grid h-[84px] w-[84px] shrink-0 place-items-center rounded-full font-black text-white" style={{ fontSize: 44, background: l.criticos ? "#b91c1c" : "#b45309" }}>{i + 1}</span>
              <div className="min-w-0 flex-[0_0_34%]">
                <p className="truncate font-black" style={{ fontSize: 36, color: TINTA }}>{curtoNome(l.nome)}</p>
                <p className="truncate font-semibold" style={{ fontSize: 20, color: TINTA_SUAVE }}>{l.cliente ?? ""}</p>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-3">
                {fora.map((d) => {
                  const r = l.ind[d.chave];
                  const c = COR[r.status];
                  return (
                    <span key={d.chave} className="rounded-2xl px-5 py-2 font-bold" style={{ fontSize: 22, background: c.fundo, color: c.tinta }}>
                      {d.curto}: <b className="font-black">{r.texto}</b>
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A TV inteira do relatório "ope-contratos": cabeçalho, página e rodapé. */
export function TelaOpeContratos({ d, cor, atualizado }: { d: DadosOpeContratosTv; cor: string; atualizado: string | null }) {
  const linhas = linhasDaTv(d);
  const paginas = paginasOpeContratos(linhas);
  const [pagina, setPagina] = useState(0);
  const [agora, setAgora] = useState(() => new Date());
  const ms = SEGUNDOS_POR_CONTRATO * 1000;
  useEffect(() => {
    if (paginas.length < 2) return;
    const t = window.setTimeout(() => setPagina((p) => (p + 1) % paginas.length), ms);
    return () => window.clearTimeout(t);
  }, [pagina, paginas.length, ms]);
  useEffect(() => { const t = window.setInterval(() => setAgora(new Date()), 15_000); return () => window.clearInterval(t); }, []);

  const p = paginas[Math.min(pagina, Math.max(0, paginas.length - 1))];
  const nContratos = linhas.length;
  const idx = p?.contrato ? linhas.findIndex((l) => l.id === p.contrato!.id) + 1 : 0;
  const margem = p?.contrato ? d.contratos.find((c) => c.id === p.contrato!.id)?.orcado?.margem_prevista ?? null : null;

  return (
    <div className="flex h-full w-full flex-col" style={{ fontFamily: FONTE }}>
      <div className="relative flex shrink-0 items-center gap-7 overflow-hidden px-14 text-white" style={{ height: 150, background: `linear-gradient(115deg, ${cor} 0%, #0b1f4d 100%)` }}>
        <div className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-[24px]" style={{ background: "rgba(255,255,255,0.16)" }}>
          <Building2 style={{ width: 50, height: 50 }} strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-extrabold leading-none tracking-tight" style={{ fontSize: 58 }}>Indicadores por Contrato</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {[`Competência ${rotuloComp(d.competencia)}`, `${nContratos} contratos em operação`, "Postos: posição de hoje"].map((s) => (
              <span key={s} className="rounded-full px-5 py-1 font-bold uppercase tracking-wide" style={{ fontSize: 19, background: "#fff", color: cor }}>{s}</span>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-black leading-none tabular-nums" style={{ fontSize: 70 }}>{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
        <div className="shrink-0 rounded-2xl px-5 py-3 text-center font-black uppercase leading-tight tracking-wider" style={{ fontSize: 19, background: LARANJA }}>Grupo<br />Nascimento</div>
      </div>

      <div key={pagina} className="min-h-0 flex-1 px-12 pb-5 pt-7" style={{ animation: "tv-entra 600ms ease-out" }}>
        {!p ? (
          <p className="pt-40 text-center font-bold" style={{ fontSize: 40, color: TINTA_SUAVE }}>Nenhum contrato em operação.</p>
        ) : p.chave === "ope-top" ? <PaginaTop linhas={linhas} />
          : p.contrato ? <PaginaContrato l={p.contrato} margemPrevista={margem} /> : null}
      </div>

      <div className="flex shrink-0 items-center gap-5 px-12" style={{ height: 60 }}>
        <span className="shrink-0 rounded-full px-5 py-1 font-bold text-white" style={{ fontSize: 20, background: cor }}>
          {p?.chave === "ope-top" ? "Destaques" : idx ? `Contrato ${idx} de ${nContratos}` : "—"}
        </span>
        <div className="relative h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: paginas.length > 1 ? "#e4e4e7" : "transparent" }}>
          {paginas.length > 1 && (
            <div key={`${pagina}-${ms}`} className="absolute inset-y-0 left-0 rounded-full" style={{ background: cor, animation: `tv-progresso ${ms}ms linear forwards` }} />
          )}
        </div>
        <p className="shrink-0 font-semibold" style={{ fontSize: 18, color: TINTA_SUAVE }}>
          {atualizado ? `Atualizado às ${atualizado}` : "ERP Grupo Nascimento"} · cinza = sem base ou sem fonte
        </p>
      </div>
      <style>{"@keyframes tv-progresso { from { width: 0% } to { width: 100% } } @keyframes tv-entra { from { transform: translateY(18px) } to { transform: none } }"}</style>
    </div>
  );
}
