import { AlertTriangle, CheckCircle2, Info as InfoIcone, MapPin, TrendingUp, UserCheck } from "lucide-react";
import {
  destaquesDoDashboard, formatarValor, indicadoresDaTv, ondeAgir, placar, situacao, tendenciaValida, textoMeta,
  type IndicadorGerencial, type PainelGerencial, type TendenciaPainel, type VisualGerencial,
} from "@/lib/tv/gerencial";
import { misturarCor } from "@/lib/tv/relatorioTv";
import { FaixaGerencial, Grafico, Grade, Info, M, STATUS, barra, temaDoVisual, useTamanho, type Tema } from "./paginasGerencialPainel";

// =====================================================================
// TVs gerenciais — DASHBOARD COMPLETO (14/10/2026, mig 20261014000010)
//
// Pedido do Pablo: "por que tá tudo zerado? Preciso que os indicadores
// puxem AUTOMATICAMENTE, nada a preencher. E seja um dashboard pra TV, não
// cada um no seu quadrado — dashboard completo com gráficos e números reais."
//
// Uma tela só, no palco 1920×1080:
//   · faixa de cor com a pergunta da TV, relógio e o placar (crítico/atenção/ok);
//   · FAIXA DE NÚMEROS: todos os indicadores da TV lado a lado — resultado em
//     destaque na cor do semáforo e a meta;
//   · TENDÊNCIA: 12 meses com dado real da área (tvg_tendencia — admissões ×
//     demissões, faturado × recebido, receita × custo do DRE…);
//   · ONDE AGIR AGORA: os que estão fora da meta/atenção, com contrato/setor,
//     causa e responsável (o formato obrigatório do Word);
//   · os GRÁFICOS dos indicadores mais críticos, com o detalhamento real.
// E o indicador SOZINHO (item "ind:<codigo>" da playlist): o gráfico grande.
// =====================================================================

export function TelaDashboardGerencial({ p, cor, visual, atualizado, onIndicador }: {
  p: PainelGerencial; cor: string; visual: VisualGerencial; atualizado: string | null;
  /** Só na prévia da gestão: clicar abre a I.A "de onde vem este número". A TV não passa. */
  onIndicador?: (i: IndicadorGerencial) => void;
}) {
  const clicar = (i: IndicadorGerencial) => (onIndicador ? () => onIndicador(i) : undefined);
  const t = temaDoVisual(visual);
  const itens = indicadoresDaTv(p);
  const agir = ondeAgir(p, 5);
  const tendencia = tendenciaValida(p.tendencia) ? p.tendencia : null;
  // Sem mês a mês (a tela de origem não tem — ex. Plano de Ações), o 1º gráfico vai
  // para o espaço grande e os de baixo são os seguintes, sem repetir.
  const graficos = destaquesDoDashboard(p, tendencia ? 3 : 4);
  const grandeSemTendencia = tendencia ? null : graficos[0] ?? null;
  const destaques = tendencia ? graficos : graficos.slice(1);

  return (
    <div className="flex h-full w-full flex-col" style={{ color: t.texto }}>
      <FaixaGerencial cor={cor} sobre={`Dashboard gerencial · ${p.painel?.diretoria ?? ""}`} titulo={`TV ${p.painel?.titulo ?? ""}`}
        pergunta={p.painel?.pergunta} placarTv={placar(itens)} altura={150} />

      <div className="flex min-h-0 flex-1 flex-col" style={{ padding: "18px 34px 12px", gap: 16 }}>
        {/* Faixa de números: todos os indicadores da TV */}
        {/* Até 10: com os indicadores do que vai bem (14/10/2026) a TV TI/ERP e a
            Presidência passaram de 8 — a fonte do número já encolhe para caber. */}
        <div className="grid shrink-0" style={{ gap: 12, gridTemplateColumns: `repeat(${Math.max(1, Math.min(itens.length, 10))}, minmax(0,1fr))`, height: 138 }}>
          {itens.slice(0, 10).map((i) => <Numero key={i.codigo} i={i} t={t} colunas={Math.min(itens.length, 10)} onClick={clicar(i)} />)}
        </div>

        {/* Tendência de 12 meses + onde agir */}
        <div className="grid min-h-0" style={{ flex: 1.15, gap: 16, gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)" }}>
          <Cartao t={t}>
            <Titulo t={t} Icone={TrendingUp} cor={cor} texto={tendencia?.titulo ?? grandeSemTendencia?.resultado?.grafico_titulo ?? grandeSemTendencia?.nome ?? "Tendência"}
              sub={tendencia ? `${tendencia.meses[0]?.mes} a ${tendencia.meses[tendencia.meses.length - 1]?.mes} · dado do ERP` : "Dado do ERP"} />
            <div className="relative min-h-0 flex-1">
              {tendencia ? <GraficoTendencia tendencia={tendencia} t={t} cor={cor} />
                : grandeSemTendencia ? <Grafico i={grandeSemTendencia} t={t} grande />
                : <Vazio t={t} texto="Sem histórico mensal para esta área" />}
            </div>
          </Cartao>
          <Cartao t={t}>
            <Titulo t={t} Icone={AlertTriangle} cor={agir.length ? STATUS.vermelho.cor : STATUS.verde.cor} texto="Onde agir agora"
              sub={agir.length ? "Fora da meta primeiro, pelo impacto" : "Nenhum indicador fora da meta"} />
            {agir.length ? <ListaAgir agir={agir} t={t} clicar={clicar} /> : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-2xl" style={{ background: misturarCor(STATUS.verde.cor, "#ffffff", 0.9) }}>
                <CheckCircle2 style={{ width: 64, height: 64, color: STATUS.verde.cor }} />
                <p className="font-black" style={{ fontSize: 30, color: STATUS.verde.cor }}>Tudo dentro da meta</p>
              </div>
            )}
          </Cartao>
        </div>

        {/* Os gráficos dos mais críticos, com o detalhamento real */}
        {destaques.length > 0 && (
          <div className="grid min-h-0" style={{ flex: 1, gap: 16, gridTemplateColumns: `repeat(${destaques.length}, minmax(0,1fr))` }}>
            {destaques.map((i) => (
              <Cartao key={i.codigo} t={t} onClick={clicar(i)}>
                <div className="flex shrink-0 items-start gap-3">
                  <p className="min-w-0 flex-1 font-extrabold leading-tight" style={{ fontSize: 21, display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{i.resultado?.grafico_titulo || i.nome}</p>
                  <p className="shrink-0 font-black tabular-nums leading-none" style={{ fontSize: 30, color: STATUS[situacao(i)].cor }}>{formatarValor(i.resultado?.valor, i.unidade)}</p>
                </div>
                <p className="shrink-0 truncate font-semibold" style={{ fontSize: 15, color: t.suave }}>{i.resultado?.afetado || textoMeta(i)}</p>
                <div className="relative min-h-0 flex-1"><Grafico i={i} t={t} grande={false} /></div>
              </Cartao>
            ))}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-4" style={{ height: 24, fontSize: 15, color: t.suave }}>
          <span className="h-2 w-2 rounded-full" style={{ background: cor }} />
          <p className="font-semibold">Tudo calculado do ERP, sem lançamento · regras e metas em <b style={{ color: t.texto }}>TV's › Indicadores gerenciais</b></p>
          <p className="ml-auto font-semibold">{atualizado ? `Atualizado às ${atualizado}` : "ERP Grupo Nascimento"}</p>
        </div>
      </div>
    </div>
  );
}

/** Um indicador sozinho na TV (item "ind:<codigo>"): número, meta, o gráfico grande e as informações do Word. */
export function TelaIndicadorGerencial({ painel, i, cor, visual, atualizado }: {
  painel: PainelGerencial["painel"]; i: IndicadorGerencial; cor: string; visual: VisualGerencial; atualizado: string | null;
}) {
  const t = temaDoVisual(visual);
  const s = situacao(i);
  const st = STATUS[s];
  const r = i.resultado ?? { valor: null };
  return (
    <div className="flex h-full w-full flex-col" style={{ color: t.texto }}>
      <FaixaGerencial cor={cor} sobre={`${painel?.diretoria ?? ""} · TV ${painel?.titulo ?? ""}`} titulo={i.nome}
        pergunta={i.identificar || painel?.pergunta} placarTv={null} altura={150} />
      <div className="grid min-h-0 flex-1" style={{ padding: "24px 36px 16px", gap: 22, gridTemplateColumns: "minmax(0,1fr) minmax(0,2.3fr)" }}>
        <div className="flex min-h-0 flex-col" style={{ gap: 14 }}>
          <Cartao t={t}>
            <span className="inline-flex w-fit items-center gap-2 rounded-full px-4 py-1.5 font-extrabold uppercase" style={{ fontSize: 17, color: st.cor, background: misturarCor(st.cor, "#ffffff", 0.86) }}>
              <st.Icone style={{ width: 20, height: 20 }} strokeWidth={2.6} />{st.rotulo}
            </span>
            <p className="font-black leading-none tabular-nums" style={{ fontSize: r.valor == null ? 44 : 104, color: r.valor == null ? t.suave : st.cor, marginTop: 10 }}>
              {r.valor == null ? "Sem dado" : formatarValor(r.valor, i.unidade)}
            </p>
            <span className="w-fit rounded-full px-4 py-1 font-bold" style={{ fontSize: 20, background: t.caixa, color: t.suave }}>{textoMeta(i)}</span>
          </Cartao>
          <div className="flex min-h-0 flex-1 flex-col" style={{ gap: 10 }}>
            <Info t={t} Icone={MapPin} rotulo="Contrato / setor" texto={r.afetado} grande />
            <Info t={t} Icone={AlertTriangle} rotulo="Causa principal" texto={r.causa} grande />
            <Info t={t} Icone={UserCheck} rotulo="Responsável" texto={i.responsavel} grande forte />
            <Info t={t} Icone={InfoIcone} rotulo="Como é calculado" texto={r.base || i.regra} grande />
          </div>
        </div>
        <Cartao t={t}>
          <Titulo t={t} Icone={TrendingUp} cor={cor} texto="Detalhamento" sub="Dado do ERP, atualizado sozinho" />
          <div className="relative min-h-0 flex-1"><Grafico i={i} t={t} grande /></div>
          <p className="shrink-0 text-right font-semibold" style={{ fontSize: 15, color: t.suave }}>{atualizado ? `Atualizado às ${atualizado}` : ""}</p>
        </Cartao>
      </div>
    </div>
  );
}

// ---- Peças ------------------------------------------------------------------

const DICA_IA = "Clique: a I.A explica de onde vem este número";
const clicavel = (onClick?: () => void) => (onClick ? "cursor-pointer transition hover:brightness-[0.98]" : "");

function Cartao({ t, children, onClick }: { t: Tema; children: React.ReactNode; onClick?: () => void }) {
  return <div onClick={onClick} title={onClick ? DICA_IA : undefined} className={`flex min-h-0 min-w-0 flex-col ${clicavel(onClick)}`} style={{ background: t.cartao, boxShadow: t.sombra, borderRadius: 24, padding: "18px 22px", gap: 10 }}>{children}</div>;
}

function Titulo({ t, Icone, cor, texto, sub }: { t: Tema; Icone: typeof TrendingUp; cor: string; texto: string; sub?: string }) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: misturarCor(cor, "#ffffff", 0.85) }}><Icone style={{ width: 22, height: 22, color: cor }} /></span>
      <div className="min-w-0">
        <p className="truncate font-extrabold leading-tight" style={{ fontSize: 23 }}>{texto}</p>
        {sub && <p className="truncate font-semibold" style={{ fontSize: 14, color: t.suave }}>{sub}</p>}
      </div>
    </div>
  );
}

function Vazio({ t, texto }: { t: Tema; texto: string }) {
  return <div className="flex h-full items-center justify-center rounded-2xl font-semibold" style={{ background: t.caixa, color: t.suave, fontSize: 18 }}>{texto}</div>;
}

/** Um número da faixa do topo: nome, resultado na cor do semáforo e a meta. */
function Numero({ i, t, colunas, onClick }: { i: IndicadorGerencial; t: Tema; colunas: number; onClick?: () => void }) {
  const s = situacao(i);
  const st = STATUS[s];
  const v = i.resultado?.valor;
  const texto = formatarValor(v, i.unidade);
  // Largura útil do cartão no palco de 1920 (padding 34+34, gap 12, padding
  // interno 16+16): com 8 cartões ~190 px, e "R$ 968 mil" em 38 px saía cortado
  // ("R$ 968 …"). A fonte encolhe com o tamanho do texto (≈0,6 em por caractere).
  const util = (1920 - 68 - (colunas - 1) * 12) / Math.max(1, colunas) - 32;
  const fonte = Math.max(22, Math.min(38, Math.floor(util / (texto.length * 0.6))));
  return (
    <div onClick={onClick} title={onClick ? DICA_IA : undefined} className={`relative flex min-w-0 flex-col justify-between overflow-hidden ${clicavel(onClick)}`} style={{ background: t.cartao, boxShadow: t.sombra, borderRadius: 20, padding: "14px 16px 12px" }}>
      <span className="absolute inset-x-0 top-0" style={{ height: 5, background: st.cor }} />
      <p className="font-bold leading-tight" style={{ fontSize: 15.5, color: t.suave, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{i.nome}</p>
      <p className="truncate font-black leading-none tabular-nums" style={{ fontSize: fonte, color: v == null ? t.suave : st.cor }}>{texto}</p>
      <p className="truncate font-bold" style={{ fontSize: 13, color: t.rotulo }}>{textoMeta(i).replace(" · acompanhamento", "")}</p>
    </div>
  );
}

// Alturas de uma linha do "Onde agir agora": 3 linhas de texto (nome, onde ·
// causa, responsável) ou compacta em 2 (responsável sobe para o lado do nome).
// Pablo, 14/10/2026, prévia da TV Presidência: "tem alguns números saindo pra
// fora" — 5 linhas de 3 andares (~80 px) num cartão que dava ~48 px a cada uma;
// o texto vazava e o número subia por cima da caixa. Agora a lista mede o
// espaço: cabe folgado → 3 linhas; senão compacta; e só mostra quantas cabem.
const LINHA_AGIR = { cheia: 80, compacta: 46, gap: 8 };

function ListaAgir({ agir, t, clicar }: { agir: IndicadorGerencial[]; t: Tema; clicar: (i: IndicadorGerencial) => (() => void) | undefined }) {
  const { ref, h } = useTamanho<HTMLDivElement>();
  const cabem = (alt: number) => Math.max(1, Math.floor((h + LINHA_AGIR.gap) / (alt + LINHA_AGIR.gap)));
  const compacta = h > 0 && cabem(LINHA_AGIR.cheia) < agir.length;
  const lista = h > 0 ? agir.slice(0, compacta ? cabem(LINHA_AGIR.compacta) : agir.length) : [];
  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ gap: LINHA_AGIR.gap }}>
      {lista.map((i) => <LinhaAgir key={i.codigo} i={i} t={t} compacta={compacta} onClick={clicar(i)} />)}
    </div>
  );
}

/** Uma linha do "Onde agir agora": o formato do Word (onde, causa, responsável). */
function LinhaAgir({ i, t, compacta, onClick }: { i: IndicadorGerencial; t: Tema; compacta: boolean; onClick?: () => void }) {
  const st = STATUS[situacao(i)];
  const r = i.resultado ?? { valor: null };
  const responsavel = <>Responsável: <span style={{ color: t.texto }}>{i.responsavel || "—"}</span></>;
  return (
    <div onClick={onClick} title={onClick ? DICA_IA : undefined} className={`flex shrink-0 items-center gap-3 overflow-hidden rounded-2xl ${clicavel(onClick)}`}
      style={{ background: t.caixa, padding: compacta ? "5px 14px" : "8px 14px", height: compacta ? LINHA_AGIR.compacta : LINHA_AGIR.cheia }}>
      <span className="w-1.5 shrink-0 self-stretch rounded-full" style={{ background: st.cor }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate font-extrabold leading-tight" style={{ fontSize: compacta ? 16 : 18 }}>{i.nome}</p>
          {compacta && <p className="shrink truncate font-extrabold leading-tight" style={{ fontSize: 12, color: t.rotulo, maxWidth: "38%" }}>{responsavel}</p>}
        </div>
        <p className="truncate font-semibold leading-tight" style={{ fontSize: compacta ? 13 : 14, color: t.suave }}>
          {[r.afetado, r.causa].filter(Boolean).join(" · ") || "—"}
        </p>
        {!compacta && <p className="truncate font-extrabold leading-tight" style={{ fontSize: 13, color: t.rotulo }}>{responsavel}</p>}
      </div>
      <p className="shrink-0 font-black leading-none tabular-nums" style={{ fontSize: compacta ? 22 : 26, color: st.cor }}>{formatarValor(r.valor, i.unidade)}</p>
    </div>
  );
}

/** 12 meses, duas séries lado a lado (a × b), valores sobre as barras. */
function GraficoTendencia({ tendencia, t, cor }: { tendencia: TendenciaPainel; t: Tema; cor: string }) {
  const { ref, w, h } = useTamanho<HTMLDivElement>();
  const cores = [cor, "#94a3b8"];
  const meses = tendencia.meses;
  const vals = meses.flatMap((m) => [Number(m.a) || 0, Number(m.b) || 0]);
  const max = Math.max(1, ...vals) * 1.12;
  const fonte = 15;
  const top = M.t + 18;
  const ch = h - top - M.b, n = meses.length, slot = n ? (w - M.l - M.r) / n : 0, bw = Math.min(34, (slot - 14) / 2);
  const curto = (v: number) => formatarValor(v, tendencia.unidade);
  return (
    <div ref={ref} className="absolute inset-0">
      {w > 0 && h > 0 && (
        <svg width={w} height={h}>
          {tendencia.series.map((s, k) => (
            <g key={s}>
              <rect x={w - M.r - (2 - k) * 170} y={0} width={14} height={14} rx={4} fill={cores[k]} />
              <text x={w - M.r - (2 - k) * 170 + 20} y={12} fill={t.suave} fontSize={fonte} fontWeight={700}>{s}</text>
            </g>
          ))}
          <Grade w={w} y0={top} ch={ch} t={t} />
          {meses.map((m, k) => {
            const cx = M.l + k * slot + slot / 2;
            const par = [Number(m.a) || 0, Number(m.b) || 0];
            const alto = (v: number) => Math.max(2, (v / max) * ch);
            // Sem folga, o rótulo da série principal vai centrado sobre o PAR, acima da
            // barra mais alta — antes ia na altura da própria barra e a segunda barra,
            // desenhada depois, o cobria ("R$ 9…" no DRE quando o custo passa a receita).
            const yPar = top + ch - Math.max(alto(par[0]), alto(par[1]));
            return (
              <g key={m.mes}>
                {par.map((v, j) => {
                  const bh = alto(v), x = cx - bw - 2 + j * (bw + 4), y = top + ch - bh;
                  return <path key={j} d={barra(x, y, bw, bh, 7)} fill={cores[j]} />;
                })}
                {/* Rótulos por cima das barras: a principal sempre; a segunda só com folga (senão os dois se atropelam). */}
                {par.map((v, j) => {
                  if (v <= 0 || (j === 1 && slot < 150)) return null;
                  const x = cx - bw - 2 + j * (bw + 4);
                  return <text key={`r${j}`} x={slot < 150 ? cx : x + bw / 2} y={(slot < 150 ? yPar : top + ch - alto(v)) - 6} textAnchor="middle" fill={t.texto} fontSize={fonte - 2} fontWeight={800}>{curto(v)}</text>;
                })}
                {/* Texto simples: o Rotulo apaga "10/26" (feito para tirar o nº do edital). */}
                <text x={cx} y={top + ch + fonte + 6} textAnchor="middle" fill={t.suave} fontSize={fonte} fontWeight={700}>{m.mes}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
