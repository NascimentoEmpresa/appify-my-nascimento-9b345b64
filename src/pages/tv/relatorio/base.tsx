import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, ComposedChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { LucideIcon } from "lucide-react";
import { PALCO, escalaDoPalco, misturarCor } from "@/lib/tv/relatorioTv";

// =====================================================================
// Relatórios na TV — os blocos visuais (08/10/2026)
//
// Linguagem da referência pedida (carmed.vercel.app): fundo cinza-claro
// (#f4f4f5), faixa de cor SÓLIDA no topo (aqui, a cor do relatório),
// cartões brancos arredondados com sombra suave, selos de cor em negrito,
// números grandes, fonte Sofia Sans. Tudo em px de um palco 1920×1080 (ver
// Palco): a TV encolhe o palco inteiro, então nada corta.
// =====================================================================

export const FUNDO = "#f4f4f5";
export const TINTA = "#18181b";
export const TINTA_SUAVE = "#71717a";
export const LARANJA = "#f97316";
export const FONTE = "'Sofia Sans', 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

/** Cor do número do KPI pelo "tom" que as RPCs devolvem. */
export const COR_TOM: Record<string, string> = {
  primary: "#2563eb", success: "#16a34a", warning: "#d97706", destructive: "#dc2626", info: "#0284c7",
};
export const corDoTom = (tom: string | null | undefined) => COR_TOM[tom ?? ""] ?? TINTA;
/** Grupos de status (aberto/concluído/recusado) — mesmas cores em toda a TV. */
export const COR_GRUPO = { aberto: "#f59e0b", concluido: "#16a34a", recusado: "#ef4444" } as const;

/** "quinta-feira, 08 de outubro" → "Quinta-feira, 08 de outubro" (o capitalize do CSS faria "De Outubro"). */
const inicialMaiuscula = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Carrega a Sofia Sans uma vez (só nas telas de TV). */
export function useFonteTv() {
  useEffect(() => {
    if (document.getElementById("fonte-tv")) return;
    const l = document.createElement("link");
    l.id = "fonte-tv";
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Sofia+Sans:wght@400;500;600;700;800;900&display=swap";
    document.head.appendChild(l);
  }, []);
}

/**
 * O PALCO: um quadro de 1920×1080 que encolhe para caber no espaço (a tela
 * da TV ou o iframe da prévia), centralizado, com margem contra o overscan.
 * Mede o próprio contêiner — funciona igual na TV e na gestão.
 */
export function Palco({ children }: { children: ReactNode }) {
  useFonteTv();
  const caixa = useRef<HTMLDivElement>(null);
  const [tam, setTam] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setTam({ w: el.clientWidth, h: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const escala = escalaDoPalco(tam.w, tam.h);
  return (
    <div ref={caixa} className="relative h-full w-full overflow-hidden" style={{ background: FUNDO }}>
      {tam.w > 0 && (
        <div className="absolute left-1/2 top-1/2 overflow-hidden"
          style={{ width: PALCO.largura, height: PALCO.altura, transform: `translate(-50%, -50%) scale(${escala})`, transformOrigin: "center", fontFamily: FONTE, color: TINTA, background: FUNDO, borderRadius: 18 }}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A moldura de toda página: faixa de cor sólida (o relatório), relógio e a
 * marca no topo; páginas e a barra de tempo da página embaixo.
 */
export function Moldura({ cor, Icone, titulo, selos, paginas, pagina, duracaoMs, atualizado, children }: {
  cor: string; Icone: LucideIcon; titulo: string; selos: string[];
  paginas: { chave: string; titulo: string }[]; pagina: number; duracaoMs: number; atualizado: string | null; children: ReactNode;
}) {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setAgora(new Date()), 15_000); return () => window.clearInterval(t); }, []);
  const escuro = misturarCor(cor, "#000000", 0.28);
  return (
    <div className="flex h-full w-full flex-col">
      {/* Faixa do topo */}
      <div className="relative flex shrink-0 items-center gap-7 overflow-hidden px-14" style={{ height: 168, background: `linear-gradient(115deg, ${cor} 0%, ${escuro} 100%)`, color: "#fff" }}>
        <div className="pointer-events-none absolute -right-24 -top-28 h-[420px] w-[420px] rounded-full" style={{ background: "rgba(255,255,255,0.07)" }} />
        <div className="pointer-events-none absolute right-72 -bottom-40 h-[300px] w-[300px] rounded-full" style={{ background: "rgba(255,255,255,0.05)" }} />
        <div className="flex h-[96px] w-[96px] shrink-0 items-center justify-center rounded-[26px]" style={{ background: "rgba(255,255,255,0.16)", boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.18)" }}>
          <Icone style={{ width: 54, height: 54 }} strokeWidth={2.2} />
        </div>
        <div className="relative min-w-0 flex-1">
          <p className="truncate font-extrabold leading-none tracking-tight" style={{ fontSize: 64 }}>{titulo}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {selos.filter(Boolean).map((s) => (
              <span key={s} className="rounded-full px-5 py-1.5 font-bold uppercase tracking-wide" style={{ fontSize: 20, background: "#fff", color: cor }}>{s}</span>
            ))}
          </div>
        </div>
        <div className="relative shrink-0 text-right">
          <p className="font-black leading-none tabular-nums" style={{ fontSize: 76 }}>{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
          <p className="mt-2 font-semibold opacity-90" style={{ fontSize: 22 }}>{inicialMaiuscula(agora.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }))}</p>
        </div>
        <div className="relative shrink-0 rounded-2xl px-5 py-3 text-center font-black uppercase leading-tight tracking-wider" style={{ fontSize: 20, background: LARANJA, color: "#fff", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.2)" }}>
          Grupo<br />Nascimento
        </div>
      </div>

      {/* Conteúdo — entra com um leve deslize a cada página. SÓ deslize, sem
          opacidade: navegador de TV fraco às vezes congela animação, e um
          fade-in congelado no 1º quadro deixaria a tela em branco. */}
      <div key={pagina} className="min-h-0 flex-1 px-12 pb-6 pt-8" style={{ animation: "tv-entra 600ms ease-out" }}>{children}</div>

      {/* Rodapé: páginas e o tempo desta página */}
      <div className="flex shrink-0 items-center gap-5 px-12" style={{ height: 64 }}>
        <div className="flex gap-2.5">
          {paginas.map((p, i) => (
            <span key={p.chave} className="rounded-full px-4 py-1 font-bold" style={{ fontSize: 18, background: i === pagina ? cor : "#e4e4e7", color: i === pagina ? "#fff" : TINTA_SUAVE }}>{p.titulo}</span>
          ))}
        </div>
        {/* A barra de tempo só faz sentido quando há outra página para vir. */}
        <div className="relative h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: paginas.length > 1 ? "#e4e4e7" : "transparent" }}>
          {paginas.length > 1 && (
            <div key={`${pagina}-${duracaoMs}`} className="absolute inset-y-0 left-0 rounded-full"
              style={{ background: cor, animation: `tv-progresso ${duracaoMs}ms linear forwards` }} />
          )}
        </div>
        <p className="shrink-0 font-semibold" style={{ fontSize: 18, color: TINTA_SUAVE }}>
          {atualizado ? `Atualizado às ${atualizado}` : "ERP Grupo Nascimento"}
        </p>
      </div>
      <style>{"@keyframes tv-progresso { from { width: 0% } to { width: 100% } } @keyframes tv-entra { from { transform: translateY(18px) } to { transform: none } }"}</style>
    </div>
  );
}

/** Cartão branco arredondado com sombra — o bloco de tudo. */
export function Cartao({ titulo, selo, cor, children, className = "", style, corpoClassName = "" }: {
  titulo?: string; selo?: string | null; cor?: string; children: ReactNode; className?: string; style?: CSSProperties; corpoClassName?: string;
}) {
  return (
    <div className={`flex min-h-0 min-w-0 flex-col rounded-[28px] bg-white ${className}`}
      style={{ padding: "26px 30px", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.08)", ...style }}>
      {titulo && (
        <div className="mb-4 flex shrink-0 items-center gap-3">
          <span className="h-7 w-2 rounded-full" style={{ background: cor ?? TINTA }} />
          <p className="min-w-0 flex-1 truncate font-extrabold tracking-tight" style={{ fontSize: 28 }}>{titulo}</p>
          {selo && <Selo cor={cor ?? TINTA}>{selo}</Selo>}
        </div>
      )}
      <div className={`min-h-0 flex-1 ${corpoClassName}`}>{children}</div>
    </div>
  );
}

/** Selo de cor (a "pílula" da referência). */
export function Selo({ cor, children, claro = false, tamanho = 18 }: { cor: string; children: ReactNode; claro?: boolean; tamanho?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1 font-extrabold uppercase tracking-wide"
      style={{ fontSize: tamanho, background: claro ? misturarCor(cor, "#ffffff", 0.86) : cor, color: claro ? cor : "#fff" }}>
      {children}
    </span>
  );
}

/** Um número grande com rótulo, dica e (opcional) variação. */
export function CartaoKpi({ rotulo, valor, dica, cor, selo, destaque = false, tamanho = 72 }: {
  rotulo: string; valor: string; dica?: string | null; cor: string; selo?: { texto: string; cor: string } | null; destaque?: boolean;
  /** Tamanho do número (px do palco) — menor para valores em R$, que são mais largos. */
  tamanho?: number;
}) {
  return (
    <div className="relative flex min-w-0 flex-col justify-between overflow-hidden rounded-[28px] bg-white"
      style={{ padding: "24px 28px", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.08)", outline: destaque ? `3px solid ${cor}` : undefined }}>
      <span className="absolute inset-x-0 top-0 h-2" style={{ background: cor }} />
      <p className="truncate font-bold uppercase tracking-wide" style={{ fontSize: 20, color: TINTA_SUAVE }}>{rotulo}</p>
      <p className="truncate font-black leading-none tabular-nums" style={{ fontSize: tamanho, color: cor, marginTop: 10 }}>{valor}</p>
      <div className="mt-3 flex min-h-[30px] items-center gap-2">
        {selo && <Selo cor={selo.cor} claro tamanho={17}>{selo.texto}</Selo>}
        {dica && <p className="truncate font-semibold" style={{ fontSize: 19, color: TINTA_SUAVE }}>{dica}</p>}
      </div>
    </div>
  );
}

/** Barras horizontais em div (mais nítidas que gráfico na TV). */
export function Barras({ itens, cor, sufixo = "", max: maxFixo }: {
  itens: { nome: string; valor: number; rotulo?: string; dica?: string; cor?: string }[]; cor: string; sufixo?: string; max?: number;
}) {
  const max = maxFixo ?? Math.max(1, ...itens.map((i) => i.valor));
  if (!itens.length) return <Vazio />;
  return (
    <div className="flex h-full flex-col justify-around gap-2">
      {itens.map((i) => (
        <div key={i.nome} className="min-w-0">
          <div className="flex items-baseline justify-between gap-4">
            <p className="min-w-0 truncate font-semibold" style={{ fontSize: 22 }}>{i.nome}</p>
            <p className="shrink-0 font-black tabular-nums" style={{ fontSize: 26, color: i.cor ?? cor }}>
              {i.rotulo ?? `${i.valor.toLocaleString("pt-BR")}${sufixo}`}
              {i.dica && <span className="ml-2 font-semibold" style={{ fontSize: 18, color: TINTA_SUAVE }}>{i.dica}</span>}
            </p>
          </div>
          <div className="mt-1.5 h-3.5 overflow-hidden rounded-full" style={{ background: "#f1f1f3" }}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, (i.valor / max) * 100)}%`, background: i.cor ?? cor }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Anel com o total no meio e a legenda ao lado. */
export function Anel({ fatias, centro, sub }: { fatias: { nome: string; n: number; cor: string }[]; centro: string; sub: string }) {
  const total = fatias.reduce((s, f) => s + f.n, 0);
  const visiveis = fatias.filter((f) => f.n > 0);
  return (
    <div className="flex h-full items-center gap-8">
      <div className="relative h-full min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={visiveis.length ? visiveis : [{ nome: "—", n: 1, cor: "#e4e4e7" }]} dataKey="n" nameKey="nome" innerRadius="64%" outerRadius="96%" paddingAngle={visiveis.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
              {(visiveis.length ? visiveis : [{ nome: "—", n: 1, cor: "#e4e4e7" }]).map((f) => <Cell key={f.nome} fill={f.cor} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="font-black leading-none tabular-nums" style={{ fontSize: 56 }}>{centro}</p>
          <p className="mt-1 font-bold uppercase tracking-wide" style={{ fontSize: 17, color: TINTA_SUAVE }}>{sub}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-4">
        {fatias.map((f) => (
          <div key={f.nome} className="flex items-center gap-3">
            <span className="h-5 w-5 rounded-md" style={{ background: f.cor }} />
            <div>
              <p className="font-bold leading-tight" style={{ fontSize: 21 }}>{f.nome}</p>
              <p className="font-semibold tabular-nums leading-tight" style={{ fontSize: 19, color: TINTA_SUAVE }}>
                {f.n.toLocaleString("pt-BR")} · {total ? Math.round((f.n * 100) / total) : 0}%
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const EIXO = { fill: TINTA_SUAVE, fontSize: 19, fontWeight: 600 } as const;

/** Barras mês a mês (empilhadas ou lado a lado), com linha opcional no eixo da direita. */
export function GraficoMensal({ dados, series, empilhado = false, linha, referencia, rotuloTopo = true }: {
  dados: Record<string, string | number | null>[]; series: { chave: string; nome: string; cor: string }[];
  empilhado?: boolean; linha?: { chave: string; nome: string; cor: string; sufixo?: string } | null;
  referencia?: { valor: number; rotulo: string; cor: string } | null; rotuloTopo?: boolean;
}) {
  if (!dados.length) return <Vazio />;
  const ultima = series[series.length - 1]?.chave;
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap gap-5">
        {series.map((s) => <Legenda key={s.chave} cor={s.cor} nome={s.nome} />)}
        {linha && <Legenda cor={linha.cor} nome={linha.nome} linha />}
        {referencia && <Legenda cor={referencia.cor} nome={referencia.rotulo} tracejado />}
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={dados} margin={{ top: 34, right: linha ? 6 : 12, left: 0, bottom: 0 }} barCategoryGap={empilhado ? "26%" : "18%"}>
            <CartesianGrid strokeDasharray="4 6" vertical={false} stroke="#e4e4e7" />
            <XAxis dataKey="rotulo" tick={EIXO} interval={0} axisLine={false} tickLine={false} />
            <YAxis yAxisId="e" tick={EIXO} allowDecimals={false} axisLine={false} tickLine={false} width={56} />
            {/* A linha mora na metade de baixo (eixo até 1,8× o máximo): não briga com os números no topo das barras. */}
            {linha && <YAxis yAxisId="d" orientation="right" tick={EIXO} axisLine={false} tickLine={false} width={64} unit={linha.sufixo}
              domain={[0, (max: number) => Math.ceil((max || 1) * 1.8)]} allowDecimals={false} />}
            {referencia && <ReferenceLine yAxisId={linha ? "d" : "e"} y={referencia.valor} stroke={referencia.cor} strokeWidth={3} strokeDasharray="10 8" />}
            {series.map((s, i) => (
              <Bar key={s.chave} yAxisId="e" dataKey={s.chave} name={s.nome} fill={s.cor} stackId={empilhado ? "a" : undefined}
                radius={!empilhado || s.chave === ultima ? [8, 8, 0, 0] : [0, 0, 0, 0]} isAnimationActive={false}>
                {rotuloTopo && (empilhado ? s.chave === ultima : i === 0) && (
                  <LabelList dataKey={empilhado ? "__total" : s.chave} position="top" fill={TINTA} fontSize={20} fontWeight={800} formatter={(v: number) => (v ? v.toLocaleString("pt-BR") : "")} />
                )}
              </Bar>
            ))}
            {linha && <Line yAxisId="d" type="monotone" dataKey={linha.chave} name={linha.nome} stroke={linha.cor} strokeWidth={5} dot={{ r: 6, fill: "#fff", strokeWidth: 4 }} connectNulls isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Barras verticais simples com uma cor por barra (aging, etapas, metas por mês). */
export function Colunas({ dados, sufixo = "", referencia }: { dados: { rotulo: string; valor: number | null; cor: string }[]; sufixo?: string; referencia?: { valor: number; cor: string } | null }) {
  if (!dados.length) return <Vazio />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={dados} margin={{ top: 40, right: 12, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid strokeDasharray="4 6" vertical={false} stroke="#e4e4e7" />
        <XAxis dataKey="rotulo" tick={EIXO} interval={0} axisLine={false} tickLine={false} />
        <YAxis tick={EIXO} axisLine={false} tickLine={false} width={56} allowDecimals={!!sufixo} unit={sufixo} />
        {referencia && <ReferenceLine y={referencia.valor} stroke={referencia.cor} strokeWidth={3} strokeDasharray="10 8" />}
        <Bar dataKey="valor" radius={[10, 10, 0, 0]} isAnimationActive={false}>
          {dados.map((d) => <Cell key={d.rotulo} fill={d.cor} />)}
          <LabelList dataKey="valor" position="top" fill={TINTA} fontSize={22} fontWeight={800}
            formatter={(v: number | null) => (v == null ? "" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${sufixo}`)} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Legenda({ cor, nome, linha = false, tracejado = false }: { cor: string; nome: string; linha?: boolean; tracejado?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-bold" style={{ fontSize: 19, color: TINTA_SUAVE }}>
      {linha ? <span className="h-1.5 w-7 rounded-full" style={{ background: cor }} />
        : tracejado ? <span className="w-7 border-t-[3px] border-dashed" style={{ borderColor: cor }} />
        : <span className="h-4 w-4 rounded" style={{ background: cor }} />}
      {nome}
    </span>
  );
}

export function Vazio({ texto = "Nada no período." }: { texto?: string }) {
  return <div className="flex h-full items-center justify-center font-semibold" style={{ fontSize: 24, color: TINTA_SUAVE }}>{texto}</div>;
}

/** Tela inteira de espera/erro dentro do palco. */
export function Aviso({ cor, titulo, sub, girando = true }: { cor: string; titulo: string; sub?: string; girando?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
      {girando && <div className="h-20 w-20 animate-spin rounded-full border-[8px] border-zinc-200" style={{ borderTopColor: cor }} />}
      <p className="font-extrabold" style={{ fontSize: 44 }}>{titulo}</p>
      {sub && <p className="max-w-[1200px] font-semibold" style={{ fontSize: 26, color: TINTA_SUAVE }}>{sub}</p>}
    </div>
  );
}
