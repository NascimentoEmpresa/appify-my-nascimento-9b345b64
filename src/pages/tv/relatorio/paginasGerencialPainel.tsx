import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  colunasDaTela, corDoGrafico, dadosDoGrafico, formatarValor, graficoDo, indicadoresDaTela, indicadoresDaTv, nomeCurto, notaSubindicadores,
  placar, situacao, textoMeta, visualGerencial, type IndicadorGerencial, type LinhaDetalhe, type PainelGerencial, type Situacao,
  type VisualGerencial,
} from "@/lib/tv/gerencial";

// =====================================================================
// TVs gerenciais — o VISUAL DO PROTÓTIPO HTML (14/10/2026, mig 20261014000002)
//
// "Desenvolve igual ao HTML, deixa várias opções" — o protótipo anexado ao
// SIS-2026-0635 (TVs_Gerenciais_10_Telas_CONFORME_WORD.html): cabeçalho com
// "PAINEL GERENCIAL", nome da TV, a pergunta e "Tela X de Y"; notas; grade de
// cartões, cada um com um GRÁFICO (colunas, agrupadas, linha, rosca, combo),
// a legenda e as caixas Meta / Contrato-Setor afetado / Causa principal /
// Responsável pela ação; rodapé "Leitura gerencial". Aqui com os números
// reais do ERP, no palco 1920×1080 (encolhe sem cortar em qualquer TV).
// Gráficos em SVG próprio: nítidos na TV e leves para navegador de TV fraco.
// Três variações (gerencial.ts › VISUAIS_GERENCIAIS): escuro igual ao HTML,
// claro, e gráficos grandes (4 por tela).
// =====================================================================

interface Tema {
  fundo: string; cartao: string; borda: string; texto: string; suave: string; caixa: string; rotulo: string; eixo: string;
  olho: string; pergunta: string; nota: string;
}
const ESCURO: Tema = {
  fundo: "linear-gradient(135deg,#06121f 0%,#091a2c 55%,#0c223b 100%)", cartao: "linear-gradient(180deg,rgba(14,31,51,.95),rgba(10,24,40,.98))",
  borda: "rgba(255,255,255,.10)", texto: "#ecf3ff", suave: "#a8bed6", caixa: "rgba(255,255,255,.035)", rotulo: "#8fb3d9", eixo: "rgba(255,255,255,.14)",
  olho: "#93c5fd", pergunta: "#dbeafe", nota: "rgba(255,255,255,.03)",
};
const CLARO: Tema = {
  fundo: "#eef2f7", cartao: "#ffffff", borda: "#dbe3ee", texto: "#0f172a", suave: "#64748b", caixa: "#f5f8fc", rotulo: "#475569", eixo: "#cbd5e1",
  olho: "#1d4ed8", pergunta: "#1e293b", nota: "#ffffff",
};
export const fundoDoPainel = (visual: VisualGerencial) => (visualGerencial(visual).escuro ? ESCURO.fundo : CLARO.fundo);

/** As cores de status do protótipo (crítico / atenção / dentro da meta). */
const STATUS: Record<Situacao, { cor: string; rotulo: string }> = {
  vermelho: { cor: "#ef4444", rotulo: "Crítico" }, amarelo: { cor: "#f59e0b", rotulo: "Atenção" }, verde: { cor: "#22c55e", rotulo: "Dentro da meta" },
  neutro: { cor: "#60a5fa", rotulo: "Acompanhar" }, sem_dado: { cor: "#94a3b8", rotulo: "Sem dado" },
};
const PALETA = ["#ef4444", "#f59e0b", "#60a5fa", "#22c55e", "#a855f7", "#94a3b8", "#fb7185", "#38bdf8"];

const inicialMaiuscula = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function TelaPainelGerencial({ p, cor, visual, chave, paginas, pagina, duracaoMs, atualizado }: {
  p: PainelGerencial; cor: string; visual: VisualGerencial; chave: string;
  paginas: { chave: string; titulo: string }[]; pagina: number; duracaoMs: number; atualizado: string | null;
}) {
  const cfg = visualGerencial(visual);
  const t = cfg.escuro ? ESCURO : CLARO;
  const itens = indicadoresDaTela(p, visual, chave);
  const pl = placar(indicadoresDaTv(p));
  const nota = notaSubindicadores(p);
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => { const id = window.setInterval(() => setAgora(new Date()), 15_000); return () => window.clearInterval(id); }, []);
  const colunas = colunasDaTela(visual, itens.length);
  const linhas = Math.max(1, Math.ceil(itens.length / colunas));
  const compacto = colunas >= 4;

  return (
    <div className="flex h-full w-full flex-col" style={{ padding: "34px 44px 26px", color: t.texto, gap: 18 }}>
      {/* Cabeçalho: como o screen-head do HTML */}
      <div className="flex shrink-0 items-start gap-8">
        <span className="mt-1 h-[118px] w-3 shrink-0 rounded-full" style={{ background: cor }} />
        <div className="min-w-0 flex-1">
          <p className="font-bold uppercase" style={{ fontSize: 18, letterSpacing: ".14em", color: t.olho }}>
            Painel Gerencial · {p.painel?.diretoria ?? ""}
          </p>
          <p className="mt-1 truncate font-extrabold leading-tight" style={{ fontSize: 46 }}>TV {p.painel?.titulo ?? ""}</p>
          <p className="mt-2 font-bold leading-snug" style={{ fontSize: 24, color: t.pergunta, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {p.painel?.pergunta}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="text-right">
            <p className="font-black leading-none tabular-nums" style={{ fontSize: 54 }}>{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
            <p className="mt-1 font-semibold" style={{ fontSize: 17, color: t.suave }}>{inicialMaiuscula(agora.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }))}</p>
          </div>
          <div className="flex items-center gap-2">
            {(["vermelho", "amarelo", "verde"] as const).map((s) => pl[s] > 0 && (
              <span key={s} className="rounded-full px-3 py-1 font-extrabold" style={{ fontSize: 15, color: STATUS[s].cor, background: `${STATUS[s].cor}22`, border: `1px solid ${STATUS[s].cor}55` }}>
                {pl[s]} {STATUS[s].rotulo.toLowerCase()}
              </span>
            ))}
            <span className="rounded-full px-4 py-1 font-bold" style={{ fontSize: 15, border: `1px solid ${t.borda}`, background: t.caixa, color: t.texto }}>
              Tela {pagina + 1} de {paginas.length}
            </span>
            <span className="rounded-full px-4 py-1 font-black uppercase" style={{ fontSize: 14, background: "#f97316", color: "#fff" }}>Grupo Nascimento</span>
          </div>
        </div>
      </div>

      {nota && (
        <div className="shrink-0 truncate rounded-2xl px-5 py-2.5" style={{ fontSize: 16, color: t.suave, background: t.nota, border: `1px solid ${t.borda}` }}>{nota}</div>
      )}

      {/* Grade de cartões */}
      <div key={chave} className="grid min-h-0 flex-1" style={{ gap: 18, gridTemplateColumns: `repeat(${colunas}, minmax(0,1fr))`, gridTemplateRows: `repeat(${linhas}, minmax(0,1fr))`, animation: "tvg-entra 600ms ease-out" }}>
        {itens.map((i) => <CartaoPainel key={i.codigo} i={i} t={t} grande={colunas <= 2} compacto={compacto} />)}
      </div>

      {/* Rodapé: leitura gerencial + o tempo da tela */}
      <div className="flex shrink-0 items-center gap-6 rounded-2xl px-5" style={{ height: 50, background: t.nota, border: `1px solid ${t.borda}`, fontSize: 16, color: t.suave }}>
        <p className="shrink-0"><b style={{ color: t.texto }}>Leitura gerencial:</b> fora da meta primeiro, pelo impacto.</p>
        <p className="shrink-0"><b style={{ color: t.texto }}>Detalhamento:</b> TV's › Indicadores gerenciais, no ERP.</p>
        <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: paginas.length > 1 ? t.eixo : "transparent" }}>
          {paginas.length > 1 && <div key={`${pagina}-${duracaoMs}`} className="absolute inset-y-0 left-0 rounded-full" style={{ background: cor, animation: `tvg-progresso ${duracaoMs}ms linear forwards` }} />}
        </div>
        <p className="shrink-0">{atualizado ? `Atualizado às ${atualizado}` : "ERP Grupo Nascimento"}</p>
      </div>
      <style>{"@keyframes tvg-progresso { from { width: 0% } to { width: 100% } } @keyframes tvg-entra { from { transform: translateY(16px) } to { transform: none } }"}</style>
    </div>
  );
}

function CartaoPainel({ i, t, grande, compacto }: { i: IndicadorGerencial; t: Tema; grande: boolean; compacto: boolean }) {
  const s = situacao(i);
  const st = STATUS[s];
  const r = i.resultado ?? { valor: null };
  const semValor = r.valor == null;
  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden" style={{ background: t.cartao, border: `1px solid ${t.borda}`, outline: s === "vermelho" || s === "amarelo" || s === "verde" ? `2px solid ${st.cor}55` : undefined, borderRadius: 22, padding: grande ? "20px 24px" : "16px 18px", gap: 10, boxShadow: "0 10px 24px rgba(0,0,0,.18)" }}>
      <div className="flex shrink-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-extrabold leading-tight" style={{ fontSize: grande ? 26 : compacto ? 19 : 21, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{i.nome}</p>
          <p className="mt-0.5 truncate" style={{ fontSize: grande ? 17 : 15, color: t.suave }}>
            Resultado atual: <b style={{ color: semValor ? t.suave : st.cor, fontSize: grande ? 20 : 17 }}>{semValor ? (i.fonte === "manual" ? "aguardando lançamento" : "—") : formatarValor(r.valor, i.unidade)}</b>
          </p>
        </div>
        <span className="shrink-0 rounded-full px-3 py-1.5 font-extrabold uppercase" style={{ fontSize: 12, letterSpacing: ".08em", color: st.cor, background: `${st.cor}26`, border: `1px solid ${st.cor}48` }}>{st.rotulo}</span>
      </div>

      <div className="relative min-h-0 flex-1 rounded-xl" style={{ background: t.caixa, border: `1px solid ${t.borda}`, minHeight: 90 }}>
        <Grafico i={i} t={t} grande={grande} />
      </div>

      <div className="grid shrink-0 grid-cols-2" style={{ gap: 8 }}>
        <Caixa t={t} rotulo="Meta" texto={textoMeta(i).replace(/^Meta /, "")} grande={grande} />
        <Caixa t={t} rotulo={compacto ? "Onde" : "Contrato / Setor afetado"} texto={r.afetado} grande={grande} />
        <Caixa t={t} rotulo={compacto ? "Causa" : "Causa principal"} texto={r.causa} grande={grande} />
        <Caixa t={t} rotulo={compacto ? "Responsável" : "Responsável pela ação"} texto={i.responsavel} grande={grande} />
      </div>
    </div>
  );
}

function Caixa({ t, rotulo, texto, grande }: { t: Tema; rotulo: string; texto: string | null | undefined; grande: boolean }) {
  return (
    <div className="min-w-0 rounded-xl" style={{ background: t.caixa, border: `1px solid ${t.borda}`, padding: "7px 10px" }}>
      <p className="truncate font-bold uppercase" style={{ fontSize: 11, letterSpacing: ".08em", color: t.rotulo }}>{rotulo}</p>
      <p className="font-semibold leading-snug" style={{ fontSize: grande ? 16 : 14, minHeight: grande ? 21 : 18, display: "-webkit-box", WebkitLineClamp: grande ? 2 : 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {texto || "—"}
      </p>
    </div>
  );
}

// ---- Gráficos (SVG) ----------------------------------------------------------

function useTamanho<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [tam, setTam] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setTam({ w: el.clientWidth, h: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...tam };
}

function Grafico({ i, t, grande }: { i: IndicadorGerencial; t: Tema; grande: boolean }) {
  const { ref, w, h } = useTamanho<HTMLDivElement>();
  const g = graficoDo(i);
  const dados = dadosDoGrafico(i, grande ? 8 : 6);
  const s = situacao(i);
  const corPrincipal = s === "verde" ? "#22c55e" : s === "amarelo" ? "#f59e0b" : s === "vermelho" ? "#ef4444" : "#60a5fa";
  const fonte = grande ? 15 : 13;

  let corpo: ReactNode = null;
  if (!dados.length) {
    const msg = i.resultado?.valor == null ? (i.fonte === "manual" ? "Aguardando lançamento do número" : "Sem dado")
      : s === "verde" ? "Nada fora da meta" : "Sem detalhamento por contrato";
    corpo = <div className="flex h-full items-center justify-center font-semibold" style={{ fontSize: fonte + 2, color: t.suave }}>{msg}</div>;
  } else if (w > 0 && h > 0) {
    corpo = g.tipo === "rosca" ? <Rosca dados={dados} w={w} h={h} t={t} fonte={fonte} unidade={g.unidade ?? i.unidade} />
      : g.tipo === "linha" ? <Linha dados={dados} w={w} h={h} t={t} fonte={fonte} cor={corDoGrafico(i.codigo) ?? "#38bdf8"} i={i} />
      : g.tipo === "agrupado" ? <Agrupado dados={dados} w={w} h={h} t={t} fonte={fonte} series={g.series ?? ["A", "B"]} />
      : <Colunas dados={dados} w={w} h={h} t={t} fonte={fonte} cor={g.tipo === "combo" ? "#60a5fa" : corDoGrafico(i.codigo) ?? corPrincipal} i={i} combo={g.tipo === "combo"} />;
  }
  return <div ref={ref} className="absolute inset-0">{corpo}</div>;
}

const M = { l: 14, r: 14, t: 26, b: 40 };
const valorTxt = (v: number | null | undefined, unidade?: IndicadorGerencial["unidade"], _rotulo?: string | null) => {
  if (v == null) return "";
  return unidade ? formatarValor(v, unidade) : v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
};

function Rotulo({ x, y, texto, largura, t, fonte }: { x: number; y: number; texto: string; largura: number; t: Tema; fonte: number }) {
  // Duas linhas no máximo, quebrando por palavra.
  const porLinha = Math.max(6, Math.floor(largura / (fonte * 0.56)));
  const palavras = nomeCurto(texto, porLinha * 2).split(" ");
  const ls: string[] = [""];
  for (const p of palavras) {
    const teste = `${ls[ls.length - 1]} ${p}`.trim();
    if (teste.length > porLinha && ls[ls.length - 1]) ls.push(p); else ls[ls.length - 1] = teste;
  }
  return <text x={x} y={y} textAnchor="middle" fill={t.suave} fontSize={fonte - 1} fontWeight={600}>{ls.slice(0, 2).map((l, k) => <tspan key={k} x={x} dy={k ? fonte : 0}>{l}</tspan>)}</text>;
}

function Colunas({ dados, w, h, t, fonte, cor, i, combo }: { dados: LinhaDetalhe[]; w: number; h: number; t: Tema; fonte: number; cor: string; i: IndicadorGerencial; combo: boolean }) {
  const unidade = graficoDo(i).unidade ?? i.unidade;
  const vals = dados.map((d) => Math.abs(Number(d.valor) || 0));
  const meta = combo && i.meta != null ? Math.abs(Number(i.meta)) : null;
  const max = Math.max(1, ...vals, meta ?? 0);
  const cw = w - M.l - M.r, ch = h - M.t - M.b, n = dados.length, gap = Math.min(18, cw / n * 0.25), bw = (cw - gap * (n - 1)) / n;
  const yMeta = meta != null ? M.t + ch - (meta / max) * ch : null;
  return (
    <svg width={w} height={h}>
      <line x1={M.l} x2={w - M.r} y1={M.t + ch} y2={M.t + ch} stroke={t.eixo} />
      {dados.map((d, k) => {
        const v = vals[k], bh = Math.max(2, (v / max) * ch), x = M.l + k * (bw + gap), y = M.t + ch - bh;
        const negativo = Number(d.valor) < 0;
        return (
          <g key={k}>
            {/* Negativo em % (custo abaixo do orçado) fica verde, como no HTML; dias negativos (prazo vencido) seguem na cor do status. */}
            <rect x={x} y={y} width={bw} height={bh} rx={5} fill={negativo && unidade === "pct" ? "#22c55e" : cor} />
            <text x={x + bw / 2} y={y - 6} textAnchor="middle" fill={t.texto} fontSize={fonte} fontWeight={800}>{valorTxt(Number(d.valor), unidade, d.rotulo?.split(" ·")[0])}</text>
            <Rotulo x={x + bw / 2} y={M.t + ch + fonte + 3} texto={d.nome} largura={bw + gap} t={t} fonte={fonte} />
          </g>
        );
      })}
      {yMeta != null && (
        <g>
          <line x1={M.l} x2={w - M.r} y1={yMeta} y2={yMeta} stroke="#22c55e" strokeWidth={2.5} strokeDasharray="8 6" />
          <text x={w - M.r} y={yMeta - 5} textAnchor="end" fill="#22c55e" fontSize={fonte - 1} fontWeight={800}>Meta {formatarValor(meta, i.unidade)}</text>
        </g>
      )}
    </svg>
  );
}

function Agrupado({ dados, w, h, t, fonte, series }: { dados: LinhaDetalhe[]; w: number; h: number; t: Tema; fonte: number; series: [string, string] }) {
  const cores = ["#60a5fa", "#22c55e"];
  const max = Math.max(1, ...dados.flatMap((d) => [Number(d.a) || 0, Number(d.b) || 0]));
  const top = M.t + 14; // espaço da legenda
  const cw = w - M.l - M.r, ch = h - top - M.b, n = dados.length, gw = cw / n, bw = Math.min(34, (gw - 16) / 2);
  return (
    <svg width={w} height={h}>
      {series.map((s, k) => (
        <g key={s}><rect x={M.l + k * 130} y={6} width={12} height={12} rx={3} fill={cores[k]} /><text x={M.l + k * 130 + 18} y={16} fill={t.suave} fontSize={fonte - 1} fontWeight={700}>{s}</text></g>
      ))}
      <line x1={M.l} x2={w - M.r} y1={top + ch} y2={top + ch} stroke={t.eixo} />
      {dados.map((d, k) => {
        const cx = M.l + k * gw + gw / 2;
        return (
          <g key={k}>
            {[Number(d.a) || 0, Number(d.b) || 0].map((v, j) => {
              const bh = Math.max(2, (v / max) * (ch - 18)), x = cx - bw - 2 + j * (bw + 4), y = top + ch - bh;
              return (
                <g key={j}>
                  <rect x={x} y={y} width={bw} height={bh} rx={4} fill={cores[j]} />
                  <text x={x + bw / 2} y={y - 5} textAnchor="middle" fill={t.texto} fontSize={fonte - 1} fontWeight={800}>{v.toLocaleString("pt-BR")}</text>
                </g>
              );
            })}
            <Rotulo x={cx} y={top + ch + fonte + 3} texto={d.nome} largura={gw} t={t} fonte={fonte} />
          </g>
        );
      })}
    </svg>
  );
}

function Linha({ dados, w, h, t, fonte, cor, i }: { dados: LinhaDetalhe[]; w: number; h: number; t: Tema; fonte: number; cor: string; i: IndicadorGerencial }) {
  const vals = dados.map((d) => Number(d.valor) || 0);
  const max = Math.max(1, ...vals.map(Math.abs));
  const px = 30, cw = w - M.l - M.r - px * 2, ch = h - M.t - M.b - 6, n = dados.length;
  const pts = vals.map((v, k) => ({ x: M.l + px + (n > 1 ? (k * cw) / (n - 1) : cw / 2), y: M.t + 6 + ch - (Math.abs(v) / max) * ch }));
  return (
    <svg width={w} height={h}>
      <line x1={M.l} x2={w - M.r} y1={M.t + 6 + ch} y2={M.t + 6 + ch} stroke={t.eixo} />
      <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={cor} strokeWidth={4} strokeLinejoin="round" />
      {pts.map((p, k) => (
        <g key={k}>
          <circle cx={p.x} cy={p.y} r={6} fill={cor} stroke={t.texto} strokeWidth={1.5} />
          <text x={p.x} y={p.y - 11} textAnchor="middle" fill={t.texto} fontSize={fonte} fontWeight={800}>{valorTxt(vals[k], graficoDo(i).unidade ?? i.unidade, dados[k].rotulo?.split(" ·")[0])}</text>
          <Rotulo x={p.x} y={M.t + 6 + ch + fonte + 3} texto={dados[k].nome} largura={n > 1 ? cw / (n - 1) : cw} t={t} fonte={fonte} />
        </g>
      ))}
    </svg>
  );
}

function Rosca({ dados, w, h, t, fonte, unidade }: { dados: LinhaDetalhe[]; w: number; h: number; t: Tema; fonte: number; unidade: IndicadorGerencial["unidade"] }) {
  const total = dados.reduce((s, d) => s + (Number(d.valor) || 0), 0) || 1;
  const r = Math.max(20, Math.min(h * 0.36, w * 0.18)), esp = Math.max(14, r * 0.38);
  const cx = Math.min(w * 0.3, r + esp + 24), cy = h / 2;
  let ini = -Math.PI / 2;
  const arcos = dados.map((d, k) => {
    const ang = ((Number(d.valor) || 0) / total) * Math.PI * 2;
    const a0 = ini, a1 = ini + Math.max(ang - 0.01, 0.001);
    ini += ang;
    const p = (a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    return <path key={k} d={`M ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`} fill="none" stroke={PALETA[k % PALETA.length]} strokeWidth={esp} />;
  });
  const lx = cx + r + esp / 2 + 26, linhaH = Math.min(fonte + 10, (h - 16) / dados.length);
  return (
    <svg width={w} height={h}>
      {arcos}
      <text x={cx} y={cy + fonte * 0.4} textAnchor="middle" fill={t.texto} fontSize={fonte + 9} fontWeight={900}>{formatarValor(total, unidade)}</text>
      <text x={cx} y={cy + fonte * 1.6} textAnchor="middle" fill={t.suave} fontSize={fonte - 2}>total</text>
      {dados.map((d, k) => {
        const y = cy - (dados.length * linhaH) / 2 + k * linhaH + linhaH / 2;
        const pct = Math.round(((Number(d.valor) || 0) / total) * 100);
        return (
          <g key={k}>
            <rect x={lx} y={y - 7} width={12} height={12} rx={3} fill={PALETA[k % PALETA.length]} />
            <text x={lx + 20} y={y + 4} fill={t.texto} fontSize={fonte} fontWeight={600}>
              {nomeCurto(d.nome, Math.max(10, Math.floor((w - lx - 90) / (fonte * 0.55))))}
              <tspan fill={t.suave} fontWeight={800}>{`  ${pct}%`}</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}
