import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";
import {
  MENU, TABELA, addMeses, contaAvanco, corDaBorda, corDoStatus, faltaPara, fmtBRL,
  mesLegivel, mesPadrao, ordemDoStatus, pct, prazoDoMes,
  STATUS_INICIAL, type StatusPonto,
} from "@/lib/conferenciaPonto/conferencia";
import {
  ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play,
} from "lucide-react";
import { cn } from "@/lib/utils";

const sb = supabase as any;

/**
 * Painel da Conferência de Ponto — a tela de telão.
 *
 * Porte do `painel_tv_ponto.html`. Fica o dia inteiro numa TV, ninguém opera:
 * por isso ela se vira sozinha — passa os contratos de lado em slides, recarrega
 * os dados de tempo em tempo e cabe em tela cheia.
 *
 * DECISÕES QUE VÊM DE SER TELÃO, e não tela de trabalho:
 *
 *  - Tela cheia entra no CONTÊINER, não no documento. Fullscreen no documento
 *    levaria junto a sidebar e o cabeçalho do ERP, que é exatamente o que não
 *    interessa na parede.
 *  - O carrossel PAUSA quando o mouse está em cima e quando alguém usa as
 *    setas. Quem chegou perto está lendo alguma coisa; girar debaixo do dedo
 *    da pessoa é a maneira mais rápida de ela desistir de olhar.
 *  - Quantos por tela é escolha, não chute: 8, 12 ou 16, guardado no
 *    navegador daquela TV. Telão de 43" na parede e monitor de 24" na mesa do
 *    RH não comportam o mesmo tanto, e quem monta cada um sabe disso melhor
 *    que qualquer valor fixo no código.
 *  - Os VALORES continuam atrás de permissão (`ponto_informar_valor` /
 *    `ponto_marcar_pago`) — era a `ver_valores_painel` do sistema antigo.
 *    Painel de corredor não pode expor folha.
 *
 * O que NÃO veio do Flask: confete e MP3 na virada de 100% (prendia autoplay e
 * um overlay eterno pedindo clique numa tela que ninguém toca) e o tema preto
 * fixo — aqui a tela respeita o tema do ERP.
 */

/** Quantos contratos por slide. Grade escolhida para preencher a tela. */
const OPCOES_POR_SLIDE = [
  { n: 8,  grade: "grid-cols-2 grid-rows-4 md:grid-cols-4 md:grid-rows-2" },
  { n: 12, grade: "grid-cols-2 grid-rows-6 md:grid-cols-4 md:grid-rows-3" },
  { n: 16, grade: "grid-cols-2 grid-rows-8 md:grid-cols-4 md:grid-rows-4" },
] as const;

const SEGUNDOS_POR_SLIDE = 12;
const CHAVE_PREF = "gn:ponto-painel:porSlide";

interface Cartao {
  chave: string;
  nome: string | null;
  empresa: string | null;
  filial: number;
  status: StatusPonto;
  valor: number | null;
}

export default function ConferenciaPontoPainel() {
  const { can } = usePermissoes();
  const [mes, setMes] = useState(mesPadrao());
  const [linhas, setLinhas] = useState<any[]>([]);
  const [contratos, setContratos] = useState<any[]>([]);
  const [agora, setAgora] = useState(new Date());

  // ── Telão ──────────────────────────────────────────────────────────
  const caixaRef = useRef<HTMLDivElement>(null);
  const [cheia, setCheia] = useState(false);
  const [slide, setSlide] = useState(0);
  const [rodando, setRodando] = useState(true);
  const [pausadoPeloMouse, setPausadoPeloMouse] = useState(false);
  const [porSlide, setPorSlide] = useState<number>(() => {
    const salvo = Number(localStorage.getItem(CHAVE_PREF));
    return OPCOES_POR_SLIDE.some(o => o.n === salvo) ? salvo : 12;
  });

  const pode = useCallback(
    (menu: string) => can("visualizar", undefined, menu) || can("alterar", undefined, menu),
    [can],
  );
  const podeValores = pode(MENU.valor) || pode(MENU.pagar);

  // ── Dados ──────────────────────────────────────────────────────────
  const carregar = useCallback(async () => {
    const [ct, cf] = await Promise.all([
      sb.from("CONTRATOS").select('"Empresa","Filial","NOME EMPRESA","NOME CONTRATO"').eq("ATIVO", "SIM"),
      sb.from(TABELA).select("*").eq("mes_referencia", mes),
    ]);
    setContratos(ct.data ?? []);
    setLinhas(cf.data ?? []);
  }, [mes]);

  useEffect(() => { carregar(); }, [carregar]);

  // Fica aberto o dia inteiro: recarrega sozinho e mantém o relógio andando
  // para o contador do prazo não congelar.
  useEffect(() => {
    const t = setInterval(carregar, 30_000);
    const r = setInterval(() => setAgora(new Date()), 1000);
    return () => { clearInterval(t); clearInterval(r); };
  }, [carregar]);

  const cartoes: Cartao[] = useMemo(() => {
    const idx = new Map(linhas.map(l => [`${l.contrato_empresa}__${l.contrato_filial}`, l]));
    return contratos.map(c => {
      const achada = idx.get(`${c.Empresa}__${c.Filial}`);
      return {
        chave: `${c.Empresa}__${c.Filial}`,
        nome: c["NOME CONTRATO"] ?? null,
        empresa: c["NOME EMPRESA"] ?? null,
        filial: c.Filial as number,
        status: (achada?.status ?? STATUS_INICIAL) as StatusPonto,
        valor: achada?.valor_folha ?? null,
      };
    }).sort((a, b) => ordemDoStatus(a.status) - ordemDoStatus(b.status) ||
                      String(a.nome ?? "").localeCompare(String(b.nome ?? "")));
  }, [contratos, linhas]);

  const slides = useMemo(() => {
    const out: Cartao[][] = [];
    for (let i = 0; i < cartoes.length; i += porSlide) out.push(cartoes.slice(i, i + porSlide));
    return out.length ? out : [[]];
  }, [cartoes, porSlide]);

  // Trocar o mês ou o "por slide" pode deixar o índice além do fim.
  useEffect(() => {
    setSlide(s => (s >= slides.length ? 0 : s));
  }, [slides.length]);

  // ── O giro ─────────────────────────────────────────────────────────
  const girando = rodando && !pausadoPeloMouse && slides.length > 1;
  useEffect(() => {
    if (!girando) return;
    const t = setInterval(() => setSlide(s => (s + 1) % slides.length), SEGUNDOS_POR_SLIDE * 1000);
    return () => clearInterval(t);
  }, [girando, slides.length]);

  /** Mexer na seta pausa: quem está navegando não quer competir com o timer. */
  const irPara = (n: number) => {
    setRodando(false);
    setSlide(((n % slides.length) + slides.length) % slides.length);
  };

  // ── Tela cheia ─────────────────────────────────────────────────────
  const alternarCheia = async () => {
    if (!document.fullscreenElement) await caixaRef.current?.requestFullscreen?.();
    else await document.exitFullscreen?.();
  };

  // Sai da tela cheia pelo Esc também — sem isto o botão continuaria dizendo
  // "sair" com a tela já normal.
  useEffect(() => {
    const h = () => setCheia(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  // Setas do teclado e F: dá para controlar de um controle remoto de TV.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") irPara(slide + 1);
      else if (e.key === "ArrowLeft") irPara(slide - 1);
      else if (e.key.toLowerCase() === "f") alternarCheia();
      else if (e.key === " ") { e.preventDefault(); setRodando(r => !r); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide, slides.length]);

  // ── Números ────────────────────────────────────────────────────────
  const avanco = useMemo(() => contaAvanco(cartoes.map(c => c.status)), [cartoes]);
  const totalPago = cartoes.filter(c => c.status === "Pago").reduce((s, c) => s + Number(c.valor ?? 0), 0);
  const totalLiberado = cartoes.filter(c => c.status === "Liberado Financeiro").reduce((s, c) => s + Number(c.valor ?? 0), 0);
  const prazo = useMemo(() => prazoDoMes(mes), [mes]);
  const falta = faltaPara(prazo, agora);
  const grade = OPCOES_POR_SLIDE.find(o => o.n === porSlide)?.grade ?? OPCOES_POR_SLIDE[1].grade;

  return (
    <div ref={caixaRef}
         className={cn("flex flex-col gap-3 bg-background", cheia ? "h-screen p-5" : "min-h-[80vh] p-4")}
         onMouseEnter={() => setPausadoPeloMouse(true)}
         onMouseLeave={() => setPausadoPeloMouse(false)}>

      {/* ── Cabeçalho ── */}
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card px-5 py-3">
        <div>
          <h1 className={cn("font-bold tracking-tight", cheia ? "text-3xl" : "text-2xl")}>
            Conferência de Ponto
          </h1>
          <p className="text-sm text-muted-foreground">
            {avanco.total} contratos · {mesLegivel(mes)}
          </p>
        </div>

        {podeValores && (
          <div className="flex flex-wrap gap-3">
            <Pill rotulo="Pago" valor={fmtBRL(totalPago)} cor="text-emerald-600" />
            <Pill rotulo="Liberado" valor={fmtBRL(totalLiberado)} cor="text-indigo-600" />
          </div>
        )}

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Prazo de fechamento</p>
            <p className={cn("font-bold tabular-nums", cheia ? "text-2xl" : "text-xl",
                             falta ? "" : "text-destructive")}>
              {falta ?? "encerrado"}
            </p>
          </div>
          <p className={cn("tabular-nums font-semibold text-muted-foreground", cheia ? "text-2xl" : "text-lg")}>
            {agora.toLocaleTimeString("pt-BR")}
          </p>
        </div>
      </header>

      {/* ── Avanço ── */}
      <div className="grid gap-3 md:grid-cols-3">
        <Barra titulo="Operação" sub="enviados ao RH" feito={avanco.operacional} total={avanco.total} cor="bg-orange-500" grande={cheia} />
        <Barra titulo="RH" sub="conferidos" feito={avanco.rh} total={avanco.total} cor="bg-violet-500" grande={cheia} />
        <Barra titulo="Financeiro" sub="pagos" feito={avanco.financeiro} total={avanco.total} cor="bg-emerald-500" grande={cheia} />
      </div>

      {/* ── O carrossel ── */}
      {cartoes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          Nenhum contrato ativo para este mês.
        </div>
      ) : (
        <div className="relative flex-1 overflow-hidden rounded-xl">
          {/* Trilho: todos os slides lado a lado, deslocados por transform —
              é o que dá o "passa pro lado" sem remontar o DOM a cada troca. */}
          <div className="flex h-full transition-transform duration-700 ease-in-out"
               style={{ transform: `translateX(-${slide * 100}%)` }}>
            {slides.map((grupo, i) => (
              <div key={i} className={cn("grid h-full w-full shrink-0 gap-3 px-0.5", grade)}>
                {grupo.map(c => <CartaoContrato key={c.chave} c={c} valores={podeValores} grande={cheia} />)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Controles ── */}
      <footer className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-2">
        <div className="flex items-center gap-1.5">
          <Botao onClick={() => setMes(m => addMeses(m, -1))} titulo="Mês anterior">◀ mês</Botao>
          <Botao onClick={() => setMes(m => addMeses(m, 1))} titulo="Próximo mês">mês ▶</Botao>
        </div>

        <div className="flex items-center gap-2">
          <Botao onClick={() => irPara(slide - 1)} titulo="Slide anterior (←)" icone>
            <ChevronLeft className="h-4 w-4" />
          </Botao>

          {/* Bolinhas: dizem em quantos slides a fila cabe e onde estamos. */}
          <div className="flex items-center gap-1.5">
            {slides.map((_, i) => (
              <button key={i} onClick={() => irPara(i)} aria-label={`Slide ${i + 1}`}
                      className={cn("h-2 rounded-full transition-all",
                                    i === slide ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/60")} />
            ))}
          </div>

          <Botao onClick={() => irPara(slide + 1)} titulo="Próximo slide (→)" icone>
            <ChevronRight className="h-4 w-4" />
          </Botao>

          <span className="ml-1 tabular-nums text-xs text-muted-foreground">
            {slide + 1}/{slides.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Botao onClick={() => setRodando(r => !r)} titulo={rodando ? "Pausar (espaço)" : "Girar (espaço)"} icone>
            {rodando ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Botao>

          {/* Quantos cabem depende da TV — quem monta escolhe e fica guardado. */}
          <div className="flex overflow-hidden rounded-lg border">
            {OPCOES_POR_SLIDE.map(o => (
              <button key={o.n}
                      onClick={() => { setPorSlide(o.n); localStorage.setItem(CHAVE_PREF, String(o.n)); setSlide(0); }}
                      className={cn("px-2.5 py-1 text-xs font-semibold transition-colors",
                                    porSlide === o.n ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
                {o.n}
              </button>
            ))}
          </div>

          <Botao onClick={alternarCheia} titulo={cheia ? "Sair da tela cheia (F)" : "Tela cheia (F)"} icone>
            {cheia ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Botao>
        </div>
      </footer>
    </div>
  );
}

// ── Peças ────────────────────────────────────────────────────────────
function CartaoContrato({ c, valores, grande }: { c: Cartao; valores: boolean; grande: boolean }) {
  return (
    <div className={cn("flex min-h-0 flex-col justify-between overflow-hidden rounded-xl border border-l-4 bg-card p-3",
                       "animate-in fade-in duration-500", corDaBorda(c.status))}>
      <div className="min-w-0">
        <p className={cn("truncate font-bold leading-tight", grande ? "text-lg" : "text-sm")} title={c.nome ?? ""}>
          {c.nome || "—"}
        </p>
        <p className={cn("truncate text-muted-foreground", grande ? "text-sm" : "text-xs")}>
          {c.empresa || "—"} · filial {c.filial}
        </p>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className={cn("truncate rounded-full border px-2 py-0.5 font-semibold",
                            grande ? "text-sm" : "text-[11px]", corDoStatus(c.status))}>
          {c.status}
        </span>
        {valores && c.valor != null && (
          <span className={cn("shrink-0 tabular-nums text-muted-foreground", grande ? "text-sm" : "text-[11px]")}>
            {fmtBRL(c.valor)}
          </span>
        )}
      </div>
    </div>
  );
}

function Pill({ rotulo, valor, cor }: { rotulo: string; valor: string; cor: string }) {
  return (
    <div className="rounded-lg border px-3 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className={cn("tabular-nums font-bold", cor)}>{valor}</p>
    </div>
  );
}

function Barra({ titulo, sub, feito, total, cor, grande }: {
  titulo: string; sub: string; feito: number; total: number; cor: string; grande: boolean;
}) {
  const p = pct(feito, total);
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="min-w-0 truncate">
          <span className={cn("font-semibold", grande ? "text-lg" : "")}>{titulo}</span>
          <span className="ml-2 text-xs text-muted-foreground">{sub}</span>
        </div>
        <span className={cn("shrink-0 tabular-nums font-bold", grande ? "text-xl" : "text-sm")}>{p}%</span>
      </div>
      <div className={cn("overflow-hidden rounded-full bg-muted", grande ? "h-5" : "h-3.5")}>
        <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", cor)}
             style={{ width: `${p}%` }} />
      </div>
      <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">{feito} de {total}</p>
    </div>
  );
}

function Botao({ children, onClick, titulo, icone }: {
  children: React.ReactNode; onClick: () => void; titulo: string; icone?: boolean;
}) {
  return (
    <button onClick={onClick} title={titulo} aria-label={titulo}
            className={cn("rounded-lg border text-xs font-semibold transition-colors hover:bg-muted",
                          icone ? "flex h-8 w-8 items-center justify-center" : "px-2.5 py-1.5")}>
      {children}
    </button>
  );
}
