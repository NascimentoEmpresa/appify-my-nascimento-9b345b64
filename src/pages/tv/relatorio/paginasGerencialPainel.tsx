import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Eye, MapPin, Target, UserCheck, type LucideIcon } from "lucide-react";
import {
  colunasDaTela, corDoGrafico, dadosDoGrafico, formatarValor, graficoDo, indicadoresDaTela, indicadoresDaTv, nomeCurto, notaSubindicadores,
  placar, situacao, textoMeta, visualGerencial, type IndicadorGerencial, type LinhaDetalhe, type PainelGerencial, type Situacao,
  type VisualGerencial,
} from "@/lib/tv/gerencial";
import { misturarCor } from "@/lib/tv/relatorioTv";

// =====================================================================
// TVs gerenciais — o painel (14/10/2026, mig 20261014000002) — SIS-2026-0635
//
// Pedidos do Pablo, na ordem:
//   · "desenvolve igual ao HTML" — o protótipo anexado ao chamado
//     (TVs_Gerenciais_10_Telas_CONFORME_WORD.html): o painel inteiro numa
//     tela, um GRÁFICO por indicador (colunas, agrupadas, linha, rosca,
//     combo) e as informações do Word em cada cartão;
//   · "tira as telas anteriores, coloca só essas, cada painel diferente um
//     do outro como no HTML" — cada indicador tem o tipo e a cor de gráfico
//     do protótipo (gerencial.ts › GRAFICO / COR_GRAFICO);
//   · "mantém as informações do Word, visual parecido com o HTML, mas mais
//     bonito — na qualidade de carmed.vercel.app": fundo cinza-claro, faixa
//     de cor sólida no topo, cartões brancos bem arredondados com sombra
//     suave, Sofia Sans, selos de cor, número grande, muito respiro.
//
// O que cada cartão mostra é o formato obrigatório do Word (Parte IV):
// resultado atual, comparação com a meta, contrato/setor afetado, causa
// principal e responsável pela ação. Tudo no palco 1920×1080 (base.tsx ›
// Palco), que encolhe sem cortar em qualquer TV. Gráficos em SVG próprio:
// nítidos e leves para navegador de TV.
// =====================================================================

export interface Tema {
  fundo: string; cartao: string; sombra: string; texto: string; suave: string; caixa: string; rotulo: string; grade: string; eixo: string; nota: string;
}
export const CLARO: Tema = {
  fundo: "#f4f4f5", cartao: "#ffffff", sombra: "0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.08)",
  texto: "#18181b", suave: "#71717a", caixa: "#f4f4f5", rotulo: "#a1a1aa", grade: "#ececef", eixo: "#d4d4d8", nota: "#ffffff",
};
export const ESCURO: Tema = {
  fundo: "linear-gradient(135deg,#06121f 0%,#091a2c 55%,#0c223b 100%)", cartao: "linear-gradient(180deg,#10233a,#0b1b2e)",
  sombra: "0 14px 30px -8px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
  texto: "#eef4ff", suave: "#a8bed6", caixa: "rgba(255,255,255,0.05)", rotulo: "#7f9bbb", grade: "rgba(255,255,255,0.07)", eixo: "rgba(255,255,255,0.16)", nota: "rgba(255,255,255,0.04)",
};
export const fundoDoPainel = (visual: VisualGerencial) => (visualGerencial(visual).escuro ? ESCURO.fundo : CLARO.fundo);
export const temaDoVisual = (visual: VisualGerencial): Tema => (visualGerencial(visual).escuro ? ESCURO : CLARO);

/** Status no vocabulário do protótipo: crítico / atenção / dentro da meta. */
export const STATUS: Record<Situacao, { cor: string; rotulo: string; Icone: LucideIcon }> = {
  vermelho: { cor: "#dc2626", rotulo: "Crítico", Icone: AlertTriangle },
  amarelo: { cor: "#d97706", rotulo: "Atenção", Icone: Eye },
  verde: { cor: "#16a34a", rotulo: "Dentro da meta", Icone: CheckCircle2 },
  neutro: { cor: "#2563eb", rotulo: "Acompanhar", Icone: Target },
  sem_dado: { cor: "#71717a", rotulo: "Sem dado", Icone: CircleDashed },
};
export const PALETA = ["#ef4444", "#f59e0b", "#3b82f6", "#22c55e", "#a855f7", "#94a3b8", "#fb7185", "#06b6d4"];

const inicialMaiuscula = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A faixa de cor do topo (diretoria, a TV, a pergunta, relógio e placar) — também a do dashboard. */
export function FaixaGerencial({ cor, sobre, titulo, pergunta, placarTv, altura = 168 }: {
  cor: string; sobre: string; titulo: string; pergunta: string | null | undefined;
  placarTv: Record<Situacao, number> | null; altura?: number;
}) {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => { const id = window.setInterval(() => setAgora(new Date()), 15_000); return () => window.clearInterval(id); }, []);
  const corEscura = misturarCor(cor, "#000000", 0.3);
  return (
    <div className="relative flex shrink-0 items-center gap-8 overflow-hidden px-12" style={{ height: altura, background: `linear-gradient(115deg, ${cor} 0%, ${corEscura} 100%)`, color: "#fff" }}>
      <div className="pointer-events-none absolute -right-24 -top-32 h-[440px] w-[440px] rounded-full" style={{ background: "rgba(255,255,255,0.07)" }} />
      <div className="pointer-events-none absolute right-80 -bottom-44 h-[300px] w-[300px] rounded-full" style={{ background: "rgba(255,255,255,0.05)" }} />
      <div className="relative min-w-0 flex-1">
        <p className="font-extrabold uppercase" style={{ fontSize: 17, letterSpacing: ".16em", opacity: 0.85 }}>{sobre}</p>
        <p className="truncate font-black leading-none tracking-tight" style={{ fontSize: 52, marginTop: 6 }}>{titulo}</p>
        {pergunta && (
          <p className="mt-3 font-semibold leading-snug" style={{ fontSize: 22, opacity: 0.95, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>“{pergunta}”</p>
        )}
      </div>
      <div className="relative flex shrink-0 flex-col items-end gap-3">
        <div className="flex items-end gap-5">
          <div className="text-right">
            <p className="font-black leading-none tabular-nums" style={{ fontSize: 62 }}>{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
            <p className="mt-1.5 font-semibold" style={{ fontSize: 18, opacity: 0.9 }}>{inicialMaiuscula(agora.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }))}</p>
          </div>
          <div className="rounded-2xl px-4 py-2.5 text-center font-black uppercase leading-tight tracking-wider" style={{ fontSize: 17, background: "#f97316", color: "#fff", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.2)" }}>
            Grupo<br />Nascimento
          </div>
        </div>
        {placarTv && (
          <div className="flex gap-2">
            {(["vermelho", "amarelo", "verde"] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1 font-extrabold uppercase" style={{ fontSize: 15, color: STATUS[s].cor, opacity: placarTv[s] ? 1 : 0.55 }}>
                <span className="tabular-nums" style={{ fontSize: 18 }}>{placarTv[s]}</span> {STATUS[s].rotulo}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TelaPainelGerencial({ p, cor, visual, chave, paginas, pagina, duracaoMs, atualizado, onIndicador }: {
  p: PainelGerencial; cor: string; visual: VisualGerencial; chave: string;
  paginas: { chave: string; titulo: string }[]; pagina: number; duracaoMs: number; atualizado: string | null;
  /** Só na prévia da gestão (14/10/2026): clicar no indicador abre a I.A "de onde vem". A TV não passa. */
  onIndicador?: (i: IndicadorGerencial) => void;
}) {
  const escuro = visualGerencial(visual).escuro;
  const t = escuro ? ESCURO : CLARO;
  const itens = indicadoresDaTela(p, visual, chave);
  const pl = placar(indicadoresDaTv(p));
  const nota = notaSubindicadores(p);
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => { const id = window.setInterval(() => setAgora(new Date()), 15_000); return () => window.clearInterval(id); }, []);
  const colunas = colunasDaTela(visual, itens.length);
  const linhas = Math.max(1, Math.ceil(itens.length / colunas));
  const compacto = colunas >= 4;
  const corEscura = misturarCor(cor, "#000000", 0.3);

  return (
    <div className="flex h-full w-full flex-col" style={{ color: t.texto }}>
      {/* Faixa de cor sólida (carmed): diretoria, a TV e a pergunta que ela responde */}
      <div className="relative flex shrink-0 items-center gap-8 overflow-hidden px-12" style={{ height: 168, background: `linear-gradient(115deg, ${cor} 0%, ${corEscura} 100%)`, color: "#fff" }}>
        <div className="pointer-events-none absolute -right-24 -top-32 h-[440px] w-[440px] rounded-full" style={{ background: "rgba(255,255,255,0.07)" }} />
        <div className="pointer-events-none absolute right-80 -bottom-44 h-[300px] w-[300px] rounded-full" style={{ background: "rgba(255,255,255,0.05)" }} />
        <div className="relative min-w-0 flex-1">
          <p className="font-extrabold uppercase" style={{ fontSize: 17, letterSpacing: ".16em", opacity: 0.85 }}>Painel gerencial · {p.painel?.diretoria ?? ""}</p>
          <p className="truncate font-black leading-none tracking-tight" style={{ fontSize: 54, marginTop: 6 }}>TV {p.painel?.titulo ?? ""}</p>
          <p className="mt-3 font-semibold leading-snug" style={{ fontSize: 23, opacity: 0.95, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            “{p.painel?.pergunta}”
          </p>
        </div>
        <div className="relative flex shrink-0 flex-col items-end gap-3">
          <div className="flex items-end gap-5">
            <div className="text-right">
              <p className="font-black leading-none tabular-nums" style={{ fontSize: 66 }}>{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
              <p className="mt-1.5 font-semibold" style={{ fontSize: 18, opacity: 0.9 }}>{inicialMaiuscula(agora.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }))}</p>
            </div>
            <div className="rounded-2xl px-4 py-2.5 text-center font-black uppercase leading-tight tracking-wider" style={{ fontSize: 17, background: "#f97316", color: "#fff", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.2)" }}>
              Grupo<br />Nascimento
            </div>
          </div>
          <div className="flex gap-2">
            {(["vermelho", "amarelo", "verde"] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1 font-extrabold uppercase" style={{ fontSize: 15, color: STATUS[s].cor, opacity: pl[s] ? 1 : 0.55 }}>
                <span className="tabular-nums" style={{ fontSize: 18 }}>{pl[s]}</span> {STATUS[s].rotulo}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col" style={{ padding: "22px 40px 18px", gap: 16 }}>
        {nota && (
          <div className="flex shrink-0 items-center gap-3 rounded-full px-5" style={{ height: 40, background: t.nota, boxShadow: escuro ? undefined : "0 1px 2px rgba(0,0,0,0.05)", fontSize: 16, color: t.suave }}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cor }} />
            <span className="truncate">{nota}</span>
          </div>
        )}

        {/* O painel inteiro (como no HTML) — cartões brancos com sombra suave (carmed) */}
        <div key={chave} className="grid min-h-0 flex-1" style={{ gap: 18, gridTemplateColumns: `repeat(${colunas}, minmax(0,1fr))`, gridTemplateRows: `repeat(${linhas}, minmax(0,1fr))`, animation: "tvg-entra 600ms ease-out" }}>
          {itens.map((i) => <CartaoPainel key={i.codigo} i={i} t={t} grande={colunas <= 2} compacto={compacto} onClick={onIndicador ? () => onIndicador(i) : undefined} />)}
        </div>

        {/* Rodapé: telas, tempo da tela e onde está o detalhe */}
        <div className="flex shrink-0 items-center gap-5" style={{ height: 34 }}>
          {paginas.length > 1 && (
            <div className="flex gap-2">
              {paginas.map((x, k) => (
                <span key={x.chave} className="rounded-full px-4 py-1 font-bold" style={{ fontSize: 16, background: k === pagina ? cor : escuro ? "rgba(255,255,255,0.08)" : "#e4e4e7", color: k === pagina ? "#fff" : t.suave }}>{x.titulo}</span>
              ))}
            </div>
          )}
          <p className="shrink-0 font-semibold" style={{ fontSize: 16, color: t.suave }}>Fora da meta primeiro, pelo impacto · Detalhe em <b style={{ color: t.texto }}>TV's › Indicadores gerenciais</b></p>
          <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: paginas.length > 1 ? (escuro ? "rgba(255,255,255,0.1)" : "#e4e4e7") : "transparent" }}>
            {paginas.length > 1 && <div key={`${pagina}-${duracaoMs}`} className="absolute inset-y-0 left-0 rounded-full" style={{ background: cor, animation: `tvg-progresso ${duracaoMs}ms linear forwards` }} />}
          </div>
          <p className="shrink-0 font-semibold" style={{ fontSize: 16, color: t.suave }}>{atualizado ? `Atualizado às ${atualizado}` : "ERP Grupo Nascimento"}</p>
        </div>
      </div>
      <style>{"@keyframes tvg-progresso { from { width: 0% } to { width: 100% } } @keyframes tvg-entra { from { transform: translateY(16px) } to { transform: none } }"}</style>
    </div>
  );
}

function CartaoPainel({ i, t, grande, compacto, onClick }: { i: IndicadorGerencial; t: Tema; grande: boolean; compacto: boolean; onClick?: () => void }) {
  const s = situacao(i);
  const st = STATUS[s];
  const r = i.resultado ?? { valor: null };
  const semValor = r.valor == null;
  const destaque = s === "vermelho";
  return (
    <div onClick={onClick} title={onClick ? "Clique: a I.A explica de onde vem este número" : undefined}
      className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden ${onClick ? "cursor-pointer transition hover:brightness-[0.98]" : ""}`} style={{ background: t.cartao, boxShadow: t.sombra, borderRadius: 26, padding: grande ? "22px 26px 20px" : "18px 20px 16px", gap: 10, outline: destaque ? `3px solid ${misturarCor(st.cor, "#ffffff", 0.55)}` : undefined }}>
      <span className="absolute inset-x-0 top-0" style={{ height: 6, background: st.cor }} />

      {/* Indicador + status */}
      <div className="flex shrink-0 items-start gap-3 pt-1">
        <p className="min-w-0 flex-1 font-extrabold leading-tight tracking-tight" style={{ fontSize: grande ? 27 : compacto ? 20 : 22, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{i.nome}</p>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 font-extrabold uppercase" style={{ fontSize: 13, letterSpacing: ".04em", color: st.cor, background: misturarCor(st.cor, t === ESCURO ? "#0b1b2e" : "#ffffff", 0.86) }}>
          <st.Icone style={{ width: 15, height: 15 }} strokeWidth={2.6} />{st.rotulo}
        </span>
      </div>

      {/* Resultado atual × meta (Word: "resultado atual" e "comparação com a meta") */}
      <div className="flex shrink-0 items-baseline gap-3">
        <p className="truncate font-black leading-none tabular-nums" style={{ fontSize: semValor ? (grande ? 26 : 21) : grande ? 46 : compacto ? 34 : 38, color: semValor ? t.suave : st.cor }}>
          {semValor ? (i.fonte === "manual" ? "Aguardando lançamento" : "Sem dado") : formatarValor(r.valor, i.unidade, true, r.casas)}
        </p>
        <span className="shrink-0 rounded-full px-3 py-0.5 font-bold" style={{ fontSize: grande ? 16 : 14, background: t.caixa, color: t.suave }}>{textoMeta(i)}</span>
      </div>

      {/* O gráfico do indicador (tipo e cor do protótipo) */}
      <div className="relative min-h-0 flex-1" style={{ minHeight: 84 }}>
        <Grafico i={i} t={t} grande={grande} />
      </div>

      {/* Contrato/setor afetado, causa principal e responsável pela ação */}
      <div className="flex shrink-0 flex-col" style={{ gap: 6 }}>
        <Info t={t} Icone={MapPin} rotulo={compacto ? "Onde" : "Contrato / setor"} texto={r.afetado} grande={grande} />
        <div className="grid grid-cols-2" style={{ gap: 6 }}>
          <Info t={t} Icone={AlertTriangle} rotulo="Causa" texto={r.causa} grande={grande} />
          <Info t={t} Icone={UserCheck} rotulo="Responsável" texto={i.responsavel} grande={grande} forte />
        </div>
      </div>
    </div>
  );
}

export function Info({ t, Icone, rotulo, texto, grande, forte = false }: { t: Tema; Icone: LucideIcon; rotulo: string; texto: string | null | undefined; grande: boolean; forte?: boolean }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-xl" style={{ background: t.caixa, padding: "7px 11px" }}>
      <Icone className="mt-0.5 shrink-0" style={{ width: 15, height: 15, color: t.rotulo }} />
      <div className="min-w-0">
        <p className="font-extrabold uppercase leading-none" style={{ fontSize: 11, letterSpacing: ".1em", color: t.rotulo }}>{rotulo}</p>
        <p className={`mt-1 leading-snug ${forte ? "font-extrabold" : "font-semibold"}`} style={{ fontSize: grande ? 16 : 14, minHeight: grande ? 20 : 17, display: "-webkit-box", WebkitLineClamp: grande ? 2 : 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {texto || "—"}
        </p>
      </div>
    </div>
  );
}

// ---- Gráficos (SVG) ----------------------------------------------------------

export function useTamanho<T extends HTMLElement>() {
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

export function Grafico({ i, t, grande }: { i: IndicadorGerencial; t: Tema; grande: boolean }) {
  const { ref, w, h } = useTamanho<HTMLDivElement>();
  const g = graficoDo(i);
  const dados = dadosDoGrafico(i, g.tipo === "lista" ? 12 : grande ? 8 : 6);
  const s = situacao(i);
  const cor = corDoGrafico(i.codigo) ?? STATUS[s].cor;
  const unidade = g.unidade ?? i.unidade;
  const fonte = grande ? 16 : 13;

  let corpo: ReactNode = null;
  if (!dados.length) {
    const msg = i.resultado?.valor == null ? (i.fonte === "manual" ? "O número entra pelo lançamento no ERP" : "Sem dado")
      : s === "verde" ? "Nada fora da meta" : "Sem detalhamento por contrato";
    corpo = (
      <div className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl" style={{ background: t.caixa, color: t.suave }}>
        <CircleDashed style={{ width: 26, height: 26, opacity: 0.6 }} />
        <p className="font-semibold" style={{ fontSize: fonte + 1 }}>{msg}</p>
      </div>
    );
  } else if (w > 0 && h > 0) {
    corpo = g.tipo === "lista" ? <Lista dados={dados} h={h} t={t} grande={grande} />
      : g.tipo === "rosca" ? <Rosca dados={dados} w={w} h={h} t={t} fonte={fonte} unidade={unidade} />
      : g.tipo === "linha" ? <Linha dados={dados} w={w} h={h} t={t} fonte={fonte} cor={corDoGrafico(i.codigo) ?? "#06b6d4"} unidade={unidade} id={i.codigo} />
      : g.tipo === "agrupado" ? <Agrupado dados={dados} w={w} h={h} t={t} fonte={fonte} series={g.series ?? ["A", "B"]} />
      : <Colunas dados={dados} w={w} h={h} t={t} fonte={fonte} cor={g.tipo === "combo" ? "#3b82f6" : cor} unidade={unidade} meta={g.tipo === "combo" && i.meta != null ? Number(i.meta) : null} id={i.codigo} />;
  }
  return <div ref={ref} className="absolute inset-0">{corpo}</div>;
}

// Lista de alertas (lic_prazo, 14/10/2026). Pablo, mostrando o gráfico de
// barras "0 d / 1 d / 2 d" ao lado do slide Alertas da TV de Licitações:
// "consegue trocar esse gráfico por algo assim? seria a mesma informação mas
// com mais detalhes". Selo com a data (vermelho até 3 dias, âmbar até 7 — a
// mesma régua de aberturaUrgencia), "edital · objeto" e "responsável · fase ·
// cidade · horário". Mostra quantas linhas cabem; o resto vira "+N".
const COR_PRAZO = { critica: "#dc2626", proxima: "#d97706", normal: "#16a34a" };

function Lista({ dados, h, t, grande }: { dados: LinhaDetalhe[]; h: number; t: Tema; grande: boolean }) {
  const alto = grande ? 76 : 38, gap = grande ? 10 : 5;
  const cabem = Math.max(1, Math.floor((h + gap) / (alto + gap)));
  const mostra = dados.length > cabem ? dados.slice(0, cabem - 1) : dados;
  const resto = dados.length - mostra.length;
  // Tema escuro: o cartão é gradiente (misturarCor só mistura hex) — base sólida próxima.
  const base = /^#[0-9a-f]{6}$/i.test(t.cartao) ? t.cartao : "#0e1f33";
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ gap }}>
      {mostra.map((l, k) => {
        const d = l.data ? new Date(`${l.data.slice(0, 10)}T00:00:00`) : null;
        const dias = d ? Math.round((d.getTime() - hoje.getTime()) / 86_400_000) : null;
        const cor = dias == null || dias <= 3 ? COR_PRAZO.critica : dias <= 7 ? COR_PRAZO.proxima : COR_PRAZO.normal;
        return (
          <div key={k} className={`flex shrink-0 items-center gap-3 overflow-hidden ${grande ? "rounded-2xl" : "rounded-xl"}`}
            style={{ height: alto, padding: grande ? "0 18px" : "0 12px", background: misturarCor(cor, base, 0.93), border: `1.5px solid ${misturarCor(cor, base, 0.7)}` }}>
            <span className="shrink-0 rounded-lg font-black tabular-nums" style={{ fontSize: grande ? 17 : 12, padding: grande ? "6px 12px" : "3px 7px", color: cor, background: misturarCor(cor, base, 0.82) }}>
              {d ? d.toLocaleDateString("pt-BR") : "—"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-extrabold leading-tight" style={{ fontSize: grande ? 19 : 13.5, color: t.texto }}>{l.titulo || l.nome}</p>
              {l.sub && <p className="truncate font-semibold leading-tight" style={{ fontSize: grande ? 15 : 11, color: t.suave }}>{l.sub}</p>}
            </div>
            {l.rotulo && <span className="shrink-0 font-extrabold" style={{ fontSize: grande ? 16 : 12.5, color: cor }}>{l.rotulo}</span>}
          </div>
        );
      })}
      {resto > 0 && <p className="shrink-0 text-center font-bold" style={{ fontSize: grande ? 15 : 12, color: t.suave }}>+{resto} edital(is)</p>}
    </div>
  );
}

export const M = { l: 6, r: 6, t: 24, b: 36 };

export function Rotulo({ x, y, texto, largura, t, fonte }: { x: number; y: number; texto: string; largura: number; t: Tema; fonte: number }) {
  // Duas linhas no máximo, quebrando por palavra, sem o código do contrato.
  const porLinha = Math.max(6, Math.floor(largura / (fonte * 0.55)));
  const palavras = nomeCurto(texto, porLinha * 2).split(" ");
  const ls: string[] = [""];
  for (const p of palavras) {
    const teste = `${ls[ls.length - 1]} ${p}`.trim();
    if (teste.length > porLinha && ls[ls.length - 1]) ls.push(p); else ls[ls.length - 1] = teste;
  }
  return <text x={x} y={y} textAnchor="middle" fill={t.suave} fontSize={fonte - 1} fontWeight={600}>{ls.slice(0, 2).map((l, k) => <tspan key={k} x={x} dy={k ? fonte : 0}>{l}</tspan>)}</text>;
}

/** Linhas de grade suaves (carmed: tracejado discreto, sem eixo pesado). */
export function Grade({ w, y0, ch, t }: { w: number; y0: number; ch: number; t: Tema }) {
  return <>{[0.33, 0.66].map((f) => <line key={f} x1={M.l} x2={w - M.r} y1={y0 + ch * f} y2={y0 + ch * f} stroke={t.grade} strokeDasharray="5 7" />)}<line x1={M.l} x2={w - M.r} y1={y0 + ch} y2={y0 + ch} stroke={t.eixo} strokeWidth={1.5} /></>;
}

/** Barra com só o topo arredondado. */
export const barra = (x: number, y: number, bw: number, bh: number, r: number) => {
  const rr = Math.min(r, bw / 2, bh);
  return `M ${x} ${y + bh} V ${y + rr} Q ${x} ${y} ${x + rr} ${y} H ${x + bw - rr} Q ${x + bw} ${y} ${x + bw} ${y + rr} V ${y + bh} Z`;
};

function Colunas({ dados, w, h, t, fonte, cor, unidade, meta, id }: { dados: LinhaDetalhe[]; w: number; h: number; t: Tema; fonte: number; cor: string; unidade: IndicadorGerencial["unidade"]; meta: number | null; id: string }) {
  const vals = dados.map((d) => Math.abs(Number(d.valor) || 0));
  const max = Math.max(1, ...vals, meta != null ? Math.abs(meta) : 0) * 1.08;
  const ch = h - M.t - M.b, n = dados.length, slot = (w - M.l - M.r) / n, bw = Math.min(slot * 0.62, 90);
  const yMeta = meta != null ? M.t + ch - (Math.abs(meta) / max) * ch : null;
  const gid = `g-${id}`;
  return (
    <svg width={w} height={h}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={cor} /><stop offset="100%" stopColor={misturarCor(cor, "#ffffff", 0.25)} /></linearGradient></defs>
      <Grade w={w} y0={M.t} ch={ch} t={t} />
      {dados.map((d, k) => {
        const v = vals[k], bh = Math.max(3, (v / max) * ch), cx = M.l + k * slot + slot / 2, x = cx - bw / 2, y = M.t + ch - bh;
        const negativoBom = Number(d.valor) < 0 && unidade === "pct";
        return (
          <g key={k}>
            <path d={barra(x, y, bw, bh, 9)} fill={negativoBom ? "#22c55e" : `url(#${gid})`} />
            <text x={cx} y={y - 7} textAnchor="middle" fill={t.texto} fontSize={fonte} fontWeight={800}>{formatarValor(Number(d.valor), unidade)}</text>
            <Rotulo x={cx} y={M.t + ch + fonte + 4} texto={d.nome} largura={slot} t={t} fonte={fonte} />
          </g>
        );
      })}
      {yMeta != null && (
        <g>
          <line x1={M.l} x2={w - M.r} y1={yMeta} y2={yMeta} stroke="#16a34a" strokeWidth={2.5} strokeDasharray="9 6" />
          <rect x={M.l} y={yMeta - 22} width={96} height={20} rx={10} fill="#16a34a" />
          <text x={M.l + 48} y={yMeta - 8} textAnchor="middle" fill="#fff" fontSize={fonte - 2} fontWeight={800}>Meta {formatarValor(meta, unidade)}</text>
        </g>
      )}
    </svg>
  );
}

function Agrupado({ dados, w, h, t, fonte, series }: { dados: LinhaDetalhe[]; w: number; h: number; t: Tema; fonte: number; series: [string, string] }) {
  const cores = ["#3b82f6", "#22c55e"];
  const max = Math.max(1, ...dados.flatMap((d) => [Number(d.a) || 0, Number(d.b) || 0])) * 1.08;
  const top = M.t + 16; // espaço da legenda
  const ch = h - top - M.b, n = dados.length, slot = (w - M.l - M.r) / n, bw = Math.min(30, (slot - 18) / 2);
  return (
    <svg width={w} height={h}>
      {series.map((s, k) => (
        <g key={s}>
          <rect x={M.l + k * 118} y={0} width={12} height={12} rx={4} fill={cores[k]} />
          <text x={M.l + k * 118 + 18} y={10} fill={t.suave} fontSize={fonte - 1} fontWeight={700}>{s}</text>
        </g>
      ))}
      <Grade w={w} y0={top} ch={ch} t={t} />
      {dados.map((d, k) => {
        const cx = M.l + k * slot + slot / 2;
        return (
          <g key={k}>
            {[Number(d.a) || 0, Number(d.b) || 0].map((v, j) => {
              const bh = Math.max(3, (v / max) * ch), x = cx - bw - 2 + j * (bw + 4), y = top + ch - bh;
              return (
                <g key={j}>
                  <path d={barra(x, y, bw, bh, 7)} fill={cores[j]} />
                  <text x={x + bw / 2} y={y - 5} textAnchor="middle" fill={t.texto} fontSize={fonte - 1} fontWeight={800}>{v.toLocaleString("pt-BR")}</text>
                </g>
              );
            })}
            <Rotulo x={cx} y={top + ch + fonte + 4} texto={d.nome} largura={slot} t={t} fonte={fonte} />
          </g>
        );
      })}
    </svg>
  );
}

function Linha({ dados, w, h, t, fonte, cor, unidade, id }: { dados: LinhaDetalhe[]; w: number; h: number; t: Tema; fonte: number; cor: string; unidade: IndicadorGerencial["unidade"]; id: string }) {
  const vals = dados.map((d) => Number(d.valor) || 0);
  const max = Math.max(1, ...vals.map(Math.abs)) * 1.12;
  const n = dados.length, slot = (w - M.l - M.r) / n, ch = h - M.t - M.b;
  const pts = vals.map((v, k) => ({ x: M.l + k * slot + slot / 2, y: M.t + ch - (Math.abs(v) / max) * ch }));
  const area = `M ${pts[0].x} ${M.t + ch} ${pts.map((p) => `L ${p.x} ${p.y}`).join(" ")} L ${pts[pts.length - 1].x} ${M.t + ch} Z`;
  const gid = `l-${id}`;
  return (
    <svg width={w} height={h}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={cor} stopOpacity={0.28} /><stop offset="100%" stopColor={cor} stopOpacity={0} /></linearGradient></defs>
      <Grade w={w} y0={M.t} ch={ch} t={t} />
      <path d={area} fill={`url(#${gid})`} />
      <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={cor} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, k) => (
        <g key={k}>
          <circle cx={p.x} cy={p.y} r={6.5} fill={t === ESCURO ? "#0b1b2e" : "#fff"} stroke={cor} strokeWidth={3.5} />
          <text x={p.x} y={p.y - 13} textAnchor="middle" fill={t.texto} fontSize={fonte} fontWeight={800}>{formatarValor(vals[k], unidade)}</text>
          <Rotulo x={p.x} y={M.t + ch + fonte + 4} texto={dados[k].nome} largura={slot} t={t} fonte={fonte} />
        </g>
      ))}
    </svg>
  );
}

function Rosca({ dados, w, h, t, fonte, unidade }: { dados: LinhaDetalhe[]; w: number; h: number; t: Tema; fonte: number; unidade: IndicadorGerencial["unidade"] }) {
  const total = dados.reduce((s, d) => s + (Number(d.valor) || 0), 0) || 1;
  const r = Math.max(22, Math.min(h * 0.36, w * 0.17)), esp = Math.max(14, r * 0.42);
  const cx = r + esp / 2 + 10, cy = h / 2;
  let ini = -Math.PI / 2;
  const arcos = dados.map((d, k) => {
    const ang = ((Number(d.valor) || 0) / total) * Math.PI * 2;
    const folga = dados.length > 1 ? 0.035 : 0;
    const a0 = ini + folga / 2, a1 = ini + Math.max(ang - folga / 2, folga / 2 + 0.001);
    ini += ang;
    const p = (a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    return <path key={k} d={`M ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`} fill="none" stroke={PALETA[k % PALETA.length]} strokeWidth={esp} strokeLinecap="butt" />;
  });
  const lx = cx + r + esp / 2 + 22, linhaH = Math.min(fonte + 12, (h - 8) / dados.length);
  const larg = w - lx - 8;
  return (
    <svg width={w} height={h}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={t.caixa} strokeWidth={esp} />
      {arcos}
      <text x={cx} y={cy + fonte * 0.35} textAnchor="middle" fill={t.texto} fontSize={fonte + 7} fontWeight={900}>{formatarValor(total, unidade)}</text>
      <text x={cx} y={cy + fonte * 1.45} textAnchor="middle" fill={t.suave} fontSize={fonte - 3} fontWeight={700}>TOTAL</text>
      {dados.map((d, k) => {
        const y = cy - (dados.length * linhaH) / 2 + k * linhaH + linhaH / 2;
        const pct = Math.round(((Number(d.valor) || 0) / total) * 100);
        return (
          <g key={k}>
            <rect x={lx} y={y - 7} width={13} height={13} rx={4} fill={PALETA[k % PALETA.length]} />
            <text x={lx + 21} y={y + 4} fill={t.texto} fontSize={fonte} fontWeight={600}>{nomeCurto(d.nome, Math.max(8, Math.floor((larg - 70) / (fonte * 0.55))))}</text>
            <text x={w - 8} y={y + 4} textAnchor="end" fill={t.suave} fontSize={fonte} fontWeight={800}>{pct}%</text>
          </g>
        );
      })}
    </svg>
  );
}
