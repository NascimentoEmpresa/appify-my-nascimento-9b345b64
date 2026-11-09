import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CircleSlash, Info as IconeInfo, MapPin, Target, UserCheck, type LucideIcon } from "lucide-react";
import {
  dadosDoGrafico, ehSerieNoTempo, formatarValor, graficoDo, indicadoresDaTela, indicadoresDaTv, nomeCurto, placar, resultadoDoCard,
  situacao, textoMeta, type IndicadorGerencial, type LinhaDetalhe, type PainelGerencial, type Situacao, type VisualGerencial,
} from "@/lib/tv/gerencial";
import { FaixaGerencial, STATUS, useTamanho } from "./paginasGerencialPainel";

// =====================================================================
// TVs gerenciais: os cards do documento (09/11/2026, mig 20261109001000)
// SIS-2026-0635
//
// Pablo, com os prints do protótipo: "tem que aparecer exatamente essas
// informações desses 7 cards [...] só os gráficos estão horríveis nos
// exemplos, deixa bonitos pras tvs".
//
// O conteúdo é o do protótipo; o desenho, não. A TV é lida de longe, então:
//   · 4 cards por tela, gráfico à direita e os fatos à esquerda;
//   · número principal grande e nenhum texto abaixo de 20 px no palco 1920×1080;
//   · por contrato, barra deitada: nome inteiro à esquerda, valor na ponta.
//     Linha ligando contratos sugeria uma evolução que não existe;
//   · uma barra só em destaque (a pior); a cor de status não pinta o resto;
//   · a meta é uma linha vertical na mesma escala, nunca um segundo eixo.
// =====================================================================

const COR = {
  fundoCard: "#0f2136", borda: "rgba(255,255,255,0.09)", texto: "#f2f6fc", suave: "#b3c4d9", trilho: "rgba(255,255,255,0.08)",
  barra: "#5b8def", barra2: "#2fc4a0", meta: "#f5f7fa",
};
// Ordem fixa, validada para contraste no fundo escuro; a cor segue a posição na lista.
const FATIAS = ["#5b8def", "#2fc4a0", "#f2b23e", "#e0719b", "#9a86e8", "#7f93a8"];
// O status em tela escura precisa de tom mais claro que o do tema claro.
const TOM: Record<Situacao, string> = { vermelho: "#ff7b73", amarelo: "#f9bf4d", verde: "#4fd38c", neutro: "#8fb4f5", sem_dado: "#9fb0c3" };

export function TelaDocumento({ p, cor, chave, visual, paginas, pagina, duracaoMs, atualizado, onIndicador }: {
  p: PainelGerencial; cor: string; chave: string; visual: VisualGerencial;
  paginas: { chave: string; titulo: string }[]; pagina: number; duracaoMs: number; atualizado: string | null;
  onIndicador?: (i: IndicadorGerencial) => void;
}) {
  const itens = indicadoresDaTela(p, visual, chave);
  const pl = placar(indicadoresDaTv(p));
  const linhas = Math.ceil(itens.length / 2);
  return (
    <div className="flex h-full w-full flex-col" style={{ color: COR.texto }}>
      <FaixaGerencial cor={cor} sobre={`Painel gerencial · ${p.painel?.diretoria ?? ""}`} titulo={`TV ${p.painel?.titulo ?? ""}`} pergunta={p.painel?.pergunta} placarTv={pl} />
      <div className="flex min-h-0 flex-1 flex-col" style={{ padding: "20px 32px 14px", gap: 12 }}>
        <div key={chave} className="grid min-h-0 flex-1" style={{ gap: 16, gridTemplateColumns: "repeat(2,minmax(0,1fr))", gridTemplateRows: `repeat(${linhas},minmax(0,1fr))` }}>
          {itens.map((i, k) => (
            <Card key={i.codigo} i={i} largo={itens.length % 2 === 1 && k === itens.length - 1} onClick={onIndicador ? () => onIndicador(i) : undefined} />
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-5" style={{ height: 36, fontSize: 20, color: COR.suave }}>
          {paginas.length > 1 && <span className="font-extrabold tabular-nums" style={{ color: COR.texto }}>Tela {pagina + 1} de {paginas.length}</span>}
          <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: paginas.length > 1 ? COR.trilho : "transparent" }}>
            {paginas.length > 1 && <div key={`${pagina}-${duracaoMs}`} className="absolute inset-y-0 left-0 rounded-full" style={{ background: cor, animation: `tvd-progresso ${duracaoMs}ms linear forwards` }} />}
          </div>
          <span className="shrink-0 font-semibold">{atualizado ? `Atualizado às ${atualizado}` : "ERP Grupo Nascimento"}</span>
        </div>
      </div>
      <style>{"@keyframes tvd-progresso { from { width: 0% } to { width: 100% } }"}</style>
    </div>
  );
}

function Card({ i, largo, onClick }: { i: IndicadorGerencial; largo: boolean; onClick?: () => void }) {
  const s = situacao(i);
  const st = STATUS[s];
  const tom = TOM[s];
  const r = i.resultado ?? { valor: null };
  const semFonte = i.medida === "sem_fonte";
  const semNumero = semFonte || r.valor == null;
  const rotuloStatus = semFonte ? "Sem fonte" : i.medida === "parcial" ? "Medida parcial" : st.rotulo;
  const Icone = semFonte ? CircleSlash : i.medida === "parcial" ? IconeInfo : st.Icone;
  return (
    <div onClick={onClick} className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden ${onClick ? "cursor-pointer" : ""}`}
      style={{ gridColumn: largo ? "1 / -1" : undefined, background: COR.fundoCard, border: `1px solid ${COR.borda}`, borderRadius: 20, padding: "16px 24px 16px 30px", gap: 10 }}>
      <span className="absolute bottom-0 left-0 top-0" style={{ width: 8, background: tom }} />

      <div className="flex shrink-0 items-start gap-4">
        <p className="min-w-0 flex-1 font-extrabold leading-tight" style={{ fontSize: 29 }}>{i.nome}</p>
        <span className="inline-flex shrink-0 items-center gap-2 rounded-full font-extrabold uppercase" style={{ fontSize: 20, padding: "5px 15px", color: "#0b1626", background: tom }}>
          <Icone style={{ width: 21, height: 21 }} strokeWidth={2.8} />{rotuloStatus}
        </span>
      </div>

      <div className="flex min-h-0 flex-1" style={{ gap: 24 }}>
        <div className="flex min-w-0 flex-col justify-between" style={{ width: largo ? "34%" : "47%", gap: 8 }}>
          <div>
            <p className="font-black leading-none tabular-nums" style={{ fontSize: semNumero ? 36 : i.medida === "parcial" ? 52 : 66, color: semNumero ? COR.suave : tom }}>{resultadoDoCard(i)}</p>
            {i.medida === "parcial" && i.medida_nota &&<p className="mt-2 font-semibold leading-snug" style={{ fontSize: 21, color: COR.suave }}>{i.medida_nota}</p>}
          </div>
          <div className="flex flex-col" style={{ gap: 5 }}>
            <Fato Icone={Target} rotulo="Meta" texto={textoMeta(i)} />
            {!semFonte && <Fato Icone={MapPin} rotulo="Onde" texto={r.afetado} />}
            {!semFonte && <Fato Icone={AlertTriangle} rotulo="Causa" texto={r.causa} />}
            <Fato Icone={UserCheck} rotulo="Dono" texto={i.responsavel} forte />
          </div>
        </div>
        <div className="relative min-h-0 min-w-0 flex-1"><GraficoTv i={i} tom={tom} /></div>
      </div>
    </div>
  );
}

function Fato({ Icone, rotulo, texto, forte }: { Icone: LucideIcon; rotulo: string; texto: string | null | undefined; forte?: boolean }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5" style={{ fontSize: 22, lineHeight: 1.2 }}>
      <Icone className="mt-0.5 shrink-0" style={{ width: 22, height: 22, color: COR.suave }} aria-hidden />
      <span className="shrink-0 font-bold" style={{ color: COR.suave }}>{rotulo}</span>
      <span className={forte ? "font-extrabold" : "font-semibold"} style={{ minWidth: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {(texto ?? "").replace(/^Meta\s+/, "") || "—"}
      </span>
    </div>
  );
}

// ---- Gráficos ----------------------------------------------------------------

function Vazio({ texto, icone }: { texto: string; icone: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-2xl text-center" style={{ gap: 10, padding: 16, background: "rgba(255,255,255,0.04)", color: COR.suave }}>
      {icone}
      <p className="font-semibold leading-snug" style={{ fontSize: 23 }}>{texto}</p>
    </div>
  );
}

function GraficoTv({ i, tom }: { i: IndicadorGerencial; tom: string }) {
  const { ref, w, h } = useTamanho<HTMLDivElement>();
  const g = graficoDo(i);
  const dados = dadosDoGrafico(i, 5);
  const s = situacao(i);
  const unidade = g.unidade ?? i.unidade;
  let corpo: ReactNode = null;
  if (i.medida === "sem_fonte") {
    corpo = <Vazio texto={i.medida_nota ?? "O ERP ainda não tem este dado"} icone={<CircleSlash style={{ width: 42, height: 42, opacity: 0.7 }} />} />;
  } else if (!dados.length) {
    corpo = <Vazio texto={i.resultado?.valor == null ? "Sem dado no momento" : s === "verde" ? "Nada fora da meta" : "Sem abertura por contrato"} icone={<IconeInfo style={{ width: 42, height: 42, opacity: 0.7 }} />} />;
  } else if (w > 0 && h > 0) {
    corpo = g.tipo === "rosca" ? <Rosca dados={dados} w={w} h={h} unidade={unidade} />
      : ehSerieNoTempo(dados) ? <Linha dados={dados} w={w} h={h} unidade={unidade} />
      : dados.some((d) => d.a != null && d.b != null) ? <BarrasDuplas dados={dados} w={w} h={h} series={g.series ?? ["Previsto", "Realizado"]} />
      : <Barras dados={dados} w={w} h={h} unidade={unidade} tom={tom} destaca={s === "vermelho" || s === "amarelo"} meta={g.tipo === "combo" && i.meta != null ? Number(i.meta) : null} />;
  }
  return <div ref={ref} className="absolute inset-0">{corpo}</div>;
}

const larguraTexto = (n: number, fonte: number) => n * fonte * 0.56;

function Barras({ dados, w, h, unidade, tom, destaca, meta }: { dados: LinhaDetalhe[]; w: number; h: number; unidade: IndicadorGerencial["unidade"]; tom: string; destaca: boolean; meta: number | null }) {
  const fonte = 22, topo = meta != null ? 28 : 0;
  const vals = dados.map((d) => Math.abs(Number(d.valor) || 0));
  const rotulos = dados.map((d) => formatarValor(Number(d.valor), unidade));
  const esq = Math.min(w * 0.46, Math.max(...dados.map((d) => larguraTexto(nomeCurto(d.nome, 22).length, fonte))) + 8);
  const dir = Math.max(...rotulos.map((r) => larguraTexto(r.length, fonte + 2))) + 12;
  const area = Math.max(20, w - esq - dir), slot = (h - topo) / dados.length, bh = Math.min(30, slot * 0.58);
  const max = Math.max(1e-9, ...vals, meta != null ? Math.abs(meta) : 0);
  const iMax = vals.indexOf(Math.max(...vals));
  return (
    <svg width={w} height={h} role="img">
      {dados.map((d, k) => {
        const y = topo + k * slot + slot / 2, bw = Math.max(5, (vals[k] / max) * area);
        return (
          <g key={k}>
            <text x={esq - 8} y={y + 8} textAnchor="end" fill={COR.suave} fontSize={fonte} fontWeight={600}>{nomeCurto(d.nome, Math.max(8, Math.floor(esq / (fonte * 0.56))))}</text>
            <rect x={esq} y={y - bh / 2} width={bw} height={bh} rx={4} fill={destaca && k === iMax ? tom : COR.barra} />
            <text x={esq + bw + 8} y={y + 8} fill={COR.texto} fontSize={fonte + 2} fontWeight={800}>{rotulos[k]}</text>
          </g>
        );
      })}
      {meta != null && (
        <g>
          <line x1={esq + (Math.abs(meta) / max) * area} x2={esq + (Math.abs(meta) / max) * area} y1={topo - 2} y2={h} stroke={COR.meta} strokeWidth={2.5} strokeDasharray="7 6" />
          <text x={esq + (Math.abs(meta) / max) * area} y={20} textAnchor="middle" fill={COR.meta} fontSize={20} fontWeight={800}>Meta {formatarValor(meta, unidade)}</text>
        </g>
      )}
    </svg>
  );
}

function BarrasDuplas({ dados, w, h, series }: { dados: LinhaDetalhe[]; w: number; h: number; series: [string, string] }) {
  const fonte = 21, topo = 34, cores = [COR.barra, COR.barra2];
  const esq = Math.min(w * 0.42, Math.max(...dados.map((d) => larguraTexto(nomeCurto(d.nome, 20).length, fonte))) + 8);
  const slot = (h - topo) / dados.length, bh = Math.min(18, (slot - 8) / 2);
  const max = Math.max(1, ...dados.flatMap((d) => [Number(d.a) || 0, Number(d.b) || 0]));
  const area = Math.max(20, w - esq - 62);
  return (
    <svg width={w} height={h} role="img">
      {series.map((s, k) => (
        <g key={s}>
          <rect x={k * 175} y={4} width={18} height={18} rx={4} fill={cores[k]} />
          <text x={k * 175 + 25} y={20} fill={COR.suave} fontSize={20} fontWeight={700}>{s}</text>
        </g>
      ))}
      {dados.map((d, k) => {
        const yc = topo + k * slot + slot / 2;
        return (
          <g key={k}>
            <text x={esq - 8} y={yc + 7} textAnchor="end" fill={COR.suave} fontSize={fonte} fontWeight={600}>{nomeCurto(d.nome, Math.max(8, Math.floor(esq / (fonte * 0.56))))}</text>
            {[Number(d.a) || 0, Number(d.b) || 0].map((v, j) => {
              const y = j === 0 ? yc - bh - 1 : yc + 1, bw = Math.max(4, (v / max) * area);
              return (
                <g key={j}>
                  <rect x={esq} y={y} width={bw} height={bh} rx={4} fill={cores[j]} />
                  <text x={esq + bw + 7} y={y + bh - 2} fill={COR.texto} fontSize={20} fontWeight={800}>{v.toLocaleString("pt-BR")}</text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function Linha({ dados, w, h, unidade }: { dados: LinhaDetalhe[]; w: number; h: number; unidade: IndicadorGerencial["unidade"] }) {
  const fonte = 21, t = 34, b = 34, l = 34, r = 40;
  const vals = dados.map((d) => Number(d.valor) || 0);
  const min = Math.min(0, ...vals), max = Math.max(1e-9, ...vals);
  const x = (k: number) => l + (k / (dados.length - 1)) * (w - l - r);
  const y = (v: number) => t + (1 - (v - min) / (max - min || 1)) * (h - t - b);
  const pts = vals.map((v, k) => `${x(k)},${y(v)}`).join(" ");
  const ultimo = vals.length - 1;
  return (
    <svg width={w} height={h} role="img">
      <line x1={l} x2={w - r} y1={h - b} y2={h - b} stroke={COR.trilho} strokeWidth={2} />
      <polyline points={pts} fill="none" stroke={COR.barra} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
      {vals.map((v, k) => (
        <g key={k}>
          <circle cx={x(k)} cy={y(v)} r={k === ultimo ? 8 : 5} fill={COR.barra} stroke={COR.fundoCard} strokeWidth={2} />
          {(k === 0 || k === ultimo) && <text x={x(k)} y={y(v) - 15} textAnchor="middle" fill={COR.texto} fontSize={fonte + 1} fontWeight={800}>{formatarValor(v, unidade)}</text>}
          {(k === 0 || k === ultimo || dados.length <= 5) && <text x={x(k)} y={h - 8} textAnchor="middle" fill={COR.suave} fontSize={fonte - 1} fontWeight={600}>{dados[k].nome}</text>}
        </g>
      ))}
    </svg>
  );
}

function Rosca({ dados, w, h, unidade }: { dados: LinhaDetalhe[]; w: number; h: number; unidade: IndicadorGerencial["unidade"] }) {
  const total = dados.reduce((s, d) => s + (Number(d.valor) || 0), 0) || 1;
  const esp = 24, r = Math.max(36, Math.min(h / 2 - esp / 2 - 2, w * 0.15)), cx = r + esp / 2 + 2, cy = h / 2;
  let ini = -Math.PI / 2;
  const folga = dados.length > 1 ? 0.04 : 0;
  const arcos = dados.map((d, k) => {
    const ang = ((Number(d.valor) || 0) / total) * Math.PI * 2;
    if (ang >= Math.PI * 2 - 1e-3) return <circle key={k} cx={cx} cy={cy} r={r} fill="none" stroke={FATIAS[k]} strokeWidth={esp} />;
    const a0 = ini + folga / 2, a1 = ini + Math.max(ang - folga / 2, folga / 2 + 0.001);
    ini += ang;
    const p = (a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    return <path key={k} d={`M ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`} fill="none" stroke={FATIAS[k]} strokeWidth={esp} />;
  });
  const lx = cx + r + esp / 2 + 20, larg = w - lx, lh = Math.min(38, h / dados.length);
  return (
    <svg width={w} height={h} role="img">
      {arcos}
      <text x={cx} y={cy + 11} textAnchor="middle" fill={COR.texto} fontSize={unidade === "brl" ? 26 : 34} fontWeight={900}>{formatarValor(total, unidade)}</text>
      {dados.map((d, k) => {
        const y = cy - (dados.length * lh) / 2 + k * lh + lh / 2;
        return (
          <g key={k}>
            <rect x={lx} y={y - 10} width={20} height={20} rx={4} fill={FATIAS[k]} />
            <text x={lx + 28} y={y + 8} fill={COR.suave} fontSize={21} fontWeight={600}>{nomeCurto(d.nome, Math.max(6, Math.floor((larg - 90) / (21 * 0.56))))}</text>
            <text x={w - 2} y={y + 8} textAnchor="end" fill={COR.texto} fontSize={23} fontWeight={800}>{Math.round(((Number(d.valor) || 0) / total) * 100)}%</text>
          </g>
        );
      })}
    </svg>
  );
}
