import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BarChart3, Building2, ChevronDown, ChevronRight, Crown, FileText, GraduationCap, HardHat, Landmark, Maximize, Megaphone, Minus,
  Monitor, Package, Plus, Scale, Search, ShieldCheck, Users, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { funcaoDe, type NoPessoa } from "@/lib/organograma/pessoas";
import { casaSetor, chaveSetor, montarEstrutura, pessoasNoRamo, type SetorEstrutura } from "@/lib/organograma/estruturaSetores";

// =====================================================================
// Organograma › visão ESTRUTURA (06/11/2026) — regra em
// src/lib/organograma/estruturaSetores.ts.
//
// Desenho de organograma de verdade (linhas ligando pai e filhos): Conselho
// no topo, Presidência, e a árvore de SETORES pela cadeia de comando. O
// setor mostra o responsável; clicar abre, logo abaixo do card, quem está
// ligado direto à cadeira dele, e cada pessoa abre a equipe dela (um nível
// por clique: são ~2.500 pessoas). Clicar no nome abre o perfil.
//
// Pedido do Pablo ao ver a primeira versão: "o layout tá bem ruim de ver,
// preciso que fique EXTREMAMENTE superior de visualizar" — por isso o
// desenho cabe na tela sozinho (zoom de ajuste ao abrir), com cor e ícone
// por setor e o responsável à vista sem precisar abrir nada.
// =====================================================================

const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const CORES = ["#0f3171", "#1d4ed8", "#0e7490", "#047857", "#7c3aed", "#be123c", "#b45309", "#334155", "#0891b2", "#9333ea"];
const corDe = (s: string) => CORES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % CORES.length];
const primeiroNome = (n: string) => n.split(/\s+/).slice(0, 2).map((p) => p[0] + p.slice(1).toLowerCase()).join(" ");
const tituloNome = (n: string) => n.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, e, l) => e + l.toUpperCase()).replace(/\s(De|Da|Do|Das|Dos|E)\s/g, (m) => m.toLowerCase());

const ICONES: [RegExp, LucideIcon][] = [
  [/\b(RH|RECURSOS HUMANOS|PESSOAL|RECRUT)/, Users], [/FINANC|TESOUR|CONTAB|FISCAL|CONTROLADOR/, BarChart3],
  [/LICITA|CONTRATO/, FileText], [/SISTEMA|\bTI\b|TECNOLOGIA|INFORMATICA/, Monitor], [/\bSST\b|SEGURANCA|SAUDE/, ShieldCheck],
  [/TREINAMENTO/, GraduationCap], [/JURIDIC/, Scale], [/SUPRIMENTO|COMPRA|ALMOX/, Package], [/OPERAC|CAMPO|OBRA/, HardHat],
  [/MARKETING|COMUNICA/, Megaphone], [/DIRETOR/, Landmark],
];
const iconeDe = (chave: string): LucideIcon => ICONES.find(([re]) => re.test(chave))?.[1] ?? Building2;

const CSS = `
.est-arvore ul.est-r{display:flex;justify-content:center;position:relative;padding-top:28px;margin:0;list-style:none}
.est-arvore li.est-r{position:relative;display:flex;flex-direction:column;align-items:center;padding:28px 10px 0}
.est-arvore li.est-r::before,.est-arvore li.est-r::after{content:"";position:absolute;top:0;right:50%;width:50%;height:28px;border-top:2px solid var(--est-linha)}
.est-arvore li.est-r::after{right:auto;left:50%;border-left:2px solid var(--est-linha)}
.est-arvore li.est-r:only-child::before,.est-arvore li.est-r:only-child::after{display:none}
.est-arvore li.est-r:only-child{padding-top:0}
.est-arvore li.est-r:first-child::before,.est-arvore li.est-r:last-child::after{border:0 none}
.est-arvore li.est-r:last-child::before{border-right:2px solid var(--est-linha);border-top-right-radius:10px}
.est-arvore li.est-r:first-child::after{border-top-left-radius:10px}
.est-arvore ul.est-r ul.est-r::before{content:"";position:absolute;top:0;left:50%;height:28px;border-left:2px solid var(--est-linha)}
.est-arvore{display:flex;flex-direction:column;align-items:center}
.est-arvore>ul.est-r{padding-top:0;width:max-content}
.est-arvore{--est-linha:#cbd5e1}
.est-arvore ul.est-v{display:flex;flex-direction:column;gap:12px;margin:0 0 0 22px;padding:14px 0 0;list-style:none;align-self:flex-start}
.est-arvore li.est-v{position:relative;padding-left:22px}
.est-arvore li.est-v::before{content:"";position:absolute;left:0;top:-14px;bottom:-12px;border-left:2px solid var(--est-linha)}
.est-arvore li.est-v:not(:first-child)::before{top:-12px}
.est-arvore li.est-v:last-child::before{bottom:auto;height:calc(36px + 14px);border-bottom-left-radius:10px}
.est-arvore li.est-v:not(:first-child):last-child::before{height:calc(36px + 12px)}
.est-arvore li.est-v::after{content:"";position:absolute;left:0;top:36px;width:22px;border-top:2px solid var(--est-linha)}
.est-arvore li.est-v:last-child::after{border-top:0}
.est-arvore li.est-v:last-child::before{border-bottom:2px solid var(--est-linha);width:22px}
.dark .est-arvore{--est-linha:#475569}
@keyframes est-abre{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.est-abre{animation:est-abre .22s ease-out}
@media (prefers-reduced-motion: reduce){.est-abre{animation:none}}
`;

function Foto({ no, tamanho = 40, anel = true }: { no: NoPessoa; tamanho?: number; anel?: boolean }) {
  const [erro, setErro] = useState(false);
  const cls = cn("shrink-0 rounded-full", anel && "ring-2 ring-white shadow-sm dark:ring-slate-900");
  if (no.avatar_url && !erro) {
    return <img src={no.avatar_url} alt={no.nome} onError={() => setErro(true)} className={cn(cls, "object-cover")} style={{ width: tamanho, height: tamanho }} />;
  }
  return (
    <span className={cn(cls, "grid place-items-center font-bold text-white")}
      style={{ width: tamanho, height: tamanho, background: no.cor || corDe(no.nome), fontSize: tamanho * 0.36 }}>
      {iniciais(no.nome)}
    </span>
  );
}

/** Cadeira do topo: foto grande, nome e função. */
function CadeiraTopo({ no, cor, onPerfil }: { no: NoPessoa; cor: string; onPerfil: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onPerfil(no.id)}
      className="group flex w-[230px] flex-col items-center rounded-2xl bg-card px-4 pb-4 pt-5 text-center shadow-[0_6px_20px_-8px_rgba(15,23,42,.25)] ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-10px_rgba(15,23,42,.35)] dark:ring-white/10">
      <span className="rounded-full p-[3px]" style={{ background: `linear-gradient(135deg, ${cor}, ${cor}55)` }}>
        <Foto no={no} tamanho={68} anel={false} />
      </span>
      <span className="mt-3 line-clamp-2 text-[15px] font-semibold leading-tight group-hover:underline">{tituloNome(no.nome)}</span>
      <span className="mt-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: cor }}>{funcaoDe(no) || "—"}</span>
    </button>
  );
}

function BlocoTopo({ titulo, icone: Icone, cor, pessoas, onPerfil }: { titulo: string; icone: LucideIcon; cor: string; pessoas: NoPessoa[]; onPerfil: (id: string) => void }) {
  return (
    <div className="relative rounded-[22px] border-2 border-dashed px-5 pb-5 pt-7" style={{ borderColor: `${cor}66`, background: `${cor}0a` }}>
      <span className="absolute -top-3.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white shadow-sm" style={{ background: cor }}>
        <Icone className="h-3.5 w-3.5" /> {titulo}
      </span>
      <div className="flex gap-4">
        {pessoas.map((p) => <CadeiraTopo key={p.id} no={p} cor={cor} onPerfil={onPerfil} />)}
      </div>
    </div>
  );
}

/** Linha de uma pessoa na lista do setor aberto. */
function Pessoa({ no, nivel, ctx }: { no: NoPessoa; nivel: number; ctx: Ctx }) {
  const equipe = ctx.equipeDe(no.id);
  const chave = `p:${no.id}`;
  const aberto = ctx.abertos.has(chave);
  const achado = ctx.destaque(no);
  return (
    <li>
      <div className={cn("group flex items-center gap-2 rounded-lg py-1.5 pr-1.5 transition hover:bg-muted/70", achado && "bg-amber-100 dark:bg-amber-900/40")}
        style={{ paddingLeft: 4 + nivel * 16 }}>
        {equipe.length ? (
          <button type="button" onClick={() => ctx.alternar(chave)} aria-label={aberto ? "Recolher equipe" : "Abrir equipe"}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground">
            <ChevronRight className={cn("h-4 w-4 transition-transform", aberto && "rotate-90")} />
          </button>
        ) : <span className="w-6 shrink-0" />}
        <Foto no={no} tamanho={30} />
        <button type="button" onClick={() => ctx.onPerfil(no.id)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13px] font-medium leading-tight group-hover:underline">{tituloNome(no.nome)}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{funcaoDe(no) || "—"}</span>
        </button>
        {equipe.length > 0 && (
          <button type="button" onClick={() => ctx.alternar(chave)} title={`${equipe.length} direto(s) · ${ctx.totalAbaixo(no.id)} no total abaixo`}
            className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-muted-foreground">
            {equipe.length}
          </button>
        )}
      </div>
      {aberto && equipe.length > 0 && (
        <ul className="est-abre">
          {equipe.map((f) => <Pessoa key={f.id} no={f} nivel={nivel + 1} ctx={ctx} />)}
        </ul>
      )}
    </li>
  );
}

interface Ctx {
  abertos: Set<string>; alternar: (k: string) => void; onPerfil: (id: string) => void;
  equipeDe: (id: string) => NoPessoa[]; totalAbaixo: (id: string) => number;
  destaque: (n: NoPessoa) => boolean; termo: string;
}

/** Card do setor; aberto, mostra quem está ligado à cadeira logo abaixo. */
function CardSetor({ s, ctx }: { s: SetorEstrutura; ctx: Ctx }) {
  const k = `s:${s.tipo}:${s.chave}`;
  const aberto = ctx.abertos.has(k);
  const cor = corDe(s.chave);
  const Icone = s.tipo === "contrato" ? HardHat : iconeDe(s.chave);
  const r = s.responsavel;
  const total = pessoasNoRamo(s);
  // "Quem está diretamente ligado à cadeira": a equipe direta do responsável
  // (ele já está no card) + as outras cabeças do setor, que respondem para fora.
  const ligados = useMemo(() => {
    const vistos = new Set<string>(r ? [r.id] : []);
    return [...(r ? ctx.equipeDe(r.id) : []), ...s.cabecas.slice(1)].filter((n) => !vistos.has(n.id) && !!vistos.add(n.id));
  }, [r, s.cabecas, ctx]);
  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-card text-left ring-1 ring-black/5 transition-[width,box-shadow] duration-200 dark:ring-white/10",
      aberto ? "w-[340px]" : "w-[248px]",
      aberto ? "shadow-[0_14px_34px_-12px_rgba(15,23,42,.4)]" : "shadow-[0_6px_18px_-8px_rgba(15,23,42,.22)] hover:shadow-[0_12px_28px_-10px_rgba(15,23,42,.32)]")}>
      <button type="button" onClick={() => ctx.alternar(k)} aria-expanded={aberto} className="block w-full text-left">
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 text-white" style={{ background: `linear-gradient(120deg, ${cor}, ${cor}d0)` }}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/20"><Icone className="h-[18px] w-[18px]" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold leading-tight">{s.nome}</span>
            <span className="block text-[11px] text-white/80">
              {s.membros.length.toLocaleString("pt-BR")} pessoa{s.membros.length === 1 ? "" : "s"}
              {s.filhos.length ? ` · ${s.filhos.length} setor${s.filhos.length === 1 ? "" : "es"} abaixo` : ""}
            </span>
          </span>
          <ChevronDown className={cn("h-5 w-5 shrink-0 opacity-80 transition-transform", aberto && "rotate-180")} />
        </div>
        <div className="flex items-center gap-2.5 px-3.5 py-3">
          {r ? (
            <>
              <Foto no={r} tamanho={42} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold leading-tight">{tituloNome(r.nome)}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{funcaoDe(r) || "Responsável"}</span>
              </span>
            </>
          ) : <span className="text-xs text-muted-foreground">Sem responsável definido</span>}
        </div>
      </button>
      {aberto && (
        <div className="est-abre border-t bg-muted/30 px-1.5 pb-1.5 pt-1">
          <p className="px-2 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
            Ligados à cadeira · {ligados.length}{r ? ` · ${(ctx.totalAbaixo(r.id) + s.cabecas.length - 1).toLocaleString("pt-BR")} no total` : ""}
          </p>
          {ligados.length ? <ListaLigados ligados={ligados} s={s} ctx={ctx} /> : <p className="px-2 py-2 text-xs text-muted-foreground">Ninguém ligado a este setor.</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Um setor e os de baixo. Até a 2ª camada abaixo da presidência os filhos
 * abrem para os lados (organograma clássico); dali para baixo PENDURAM numa
 * coluna com trilho lateral. Sem isso as 6+ áreas debaixo das diretorias
 * ficavam lado a lado e o desenho passava de 2.000 px — abria a 45%, ilegível.
 */
/**
 * O que abre no setor. Gente de escritório e de contrato se misturam debaixo
 * da mesma cadeira (ex.: 219 pessoas da limpeza respondem à gerência de RH
 * no cadastro) — numa lista corrida não se lê nada. Primeiro a equipe do
 * próprio setor (ou de outro setor do escritório); a operação vem agrupada
 * por contrato, cada grupo fechado com a contagem.
 */
function ListaLigados({ ligados, s, ctx }: { ligados: NoPessoa[]; s: SetorEstrutura; ctx: Ctx }) {
  const doEscritorio = ligados.filter((n) => !!chaveSetor(n.setor));
  const porContrato = new Map<string, NoPessoa[]>();
  ligados.filter((n) => !chaveSetor(n.setor)).forEach((n) => {
    const c = n.contrato?.trim() || "Sem contrato";
    porContrato.set(c, [...(porContrato.get(c) ?? []), n]);
  });
  const grupos = [...porContrato.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "pt-BR"));
  return (
    <div className="max-h-[420px] overflow-y-auto">
      {doEscritorio.length > 0 && (
        <ul>{doEscritorio.map((c) => <Pessoa key={c.id} no={c} nivel={0} ctx={ctx} />)}</ul>
      )}
      {grupos.map(([nome, pessoas]) => {
        const k = `g:${s.chave}:${nome}`;
        const aberto = ctx.abertos.has(k) || (!!ctx.termo && pessoas.some(ctx.destaque));
        return (
          <div key={k} className="mt-1">
            <button type="button" onClick={() => ctx.alternar(k)}
              className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-muted/70">
              <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-90")} />
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300"><HardHat className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{nome}</span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-muted-foreground">{pessoas.length}</span>
            </button>
            {aberto && <ul className="est-abre ml-3 border-l pl-1">{pessoas.map((c) => <Pessoa key={c.id} no={c} nivel={0} ctx={ctx} />)}</ul>}
          </div>
        );
      })}
    </div>
  );
}

function RamoSetor({ s, ctx, nivel, vertical = false }: { s: SetorEstrutura; ctx: Ctx; nivel: number; vertical?: boolean }) {
  const filhos = s.filhos.filter((f) => casaSetor(f, ctx.termo));
  const pendurar = vertical || nivel >= 1;
  return (
    <li className={vertical ? "est-v" : "est-r"}>
      <div className="flex flex-col">
        <CardSetor s={s} ctx={ctx} />
        {filhos.length > 0 && (pendurar
          ? <ul className="est-v">{filhos.map((f) => <RamoSetor key={f.chave} s={f} ctx={ctx} nivel={nivel + 1} vertical />)}</ul>
          : <ul className="est-r self-center">{filhos.map((f) => <RamoSetor key={f.chave} s={f} ctx={ctx} nivel={nivel + 1} />)}</ul>)}
      </div>
    </li>
  );
}

/** Caixa rolável com zoom: abre cabendo na largura; +/− e "caber" à mão. */
function Tela({ children, dep }: { children: ReactNode; dep: unknown }) {
  const caixa = useRef<HTMLDivElement>(null);
  const conteudo = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [manual, setManual] = useState(false);
  const caber = useCallback(() => {
    const c = caixa.current, d = conteudo.current;
    if (!c || !d) return;
    // Mede o DESENHO (a 1ª lista da árvore), não a caixa: a caixa estica até a
    // largura da tela e, dividida pelo zoom, só crescia — o ajuste travava no mínimo.
    const arvore = d.querySelector(".est-arvore > ul") as HTMLElement | null;
    const larg = (arvore?.getBoundingClientRect().width ?? d.scrollWidth) / (zoom || 1) + 48;
    const z = Math.min(1, Math.max(0.5, (c.clientWidth - 16) / larg));
    setZoom(+z.toFixed(2));
  }, [zoom]);
  useLayoutEffect(() => { if (!manual) caber(); }, [dep]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (manual || !caixa.current) return;
    const ro = new ResizeObserver(() => caber());
    ro.observe(caixa.current);
    return () => ro.disconnect();
  }, [manual, caber]);
  const passo = (d: number) => { setManual(true); setZoom((z) => Math.min(1.5, Math.max(0.35, +(z + d).toFixed(2)))); };

  // Arrastar o fundo para mover (como no organograma de pessoas).
  const arrasto = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  return (
    <div className="relative">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-xl border bg-background/95 p-0.5 shadow-sm backdrop-blur print:hidden">
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Diminuir" onClick={() => passo(-0.1)}><Minus className="h-3.5 w-3.5" /></Button>
        <button type="button" className="w-11 text-center text-xs font-semibold tabular-nums" title="Tamanho real" onClick={() => { setManual(true); setZoom(1); }}>{Math.round(zoom * 100)}%</button>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Aumentar" onClick={() => passo(0.1)}><Plus className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Caber na tela" onClick={() => { setManual(false); caber(); }}><Maximize className="h-3.5 w-3.5" /></Button>
      </div>
      <div ref={caixa}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("button,a,input")) return;
          arrasto.current = { x: e.clientX, y: e.clientY, l: caixa.current!.scrollLeft, t: caixa.current!.scrollTop };
        }}
        onMouseMove={(e) => {
          const a = arrasto.current;
          if (!a || !caixa.current) return;
          caixa.current.scrollLeft = a.l - (e.clientX - a.x);
          caixa.current.scrollTop = a.t - (e.clientY - a.y);
        }}
        onMouseUp={() => (arrasto.current = null)} onMouseLeave={() => (arrasto.current = null)}
        className="max-h-[calc(100vh-250px)] min-h-[460px] cursor-grab overflow-auto rounded-3xl border bg-gradient-to-b from-slate-50 to-white active:cursor-grabbing dark:from-slate-900 dark:to-slate-950 print:max-h-none print:overflow-visible">
        <div ref={conteudo} className="mx-auto w-max min-w-full px-6 pb-12 pt-10" style={{ zoom }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function EstruturaSetores({ nos, onPerfil }: { nos: NoPessoa[]; onPerfil: (id: string) => void }) {
  const e = useMemo(() => montarEstrutura(nos), [nos]);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [verOperacao, setVerOperacao] = useState(false);
  const alternar = useCallback((k: string) => setAbertos((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; }), []);

  const termo = busca.trim().length >= 2 ? busca.trim() : "";
  const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const destaque = (n: NoPessoa) => !!termo && (sem(n.nome).includes(sem(termo)) || sem(funcaoDe(n)).includes(sem(termo)));
  const ctx: Ctx = { abertos, alternar, onPerfil, equipeDe: e.equipeDe, totalAbaixo: e.totalAbaixo, destaque, termo };

  const idsConselho = new Set(e.conselho.map((c) => c.id));
  const raizFiltrada = e.raiz.filter((s) => casaSetor(s, termo));
  // Setor que responde direto a um conselheiro sai do Conselho, ao lado da Presidência.
  const doConselho = raizFiltrada.filter((s) => s.ligadoA && idsConselho.has(s.ligadoA));
  const daPresidencia = raizFiltrada.filter((s) => !doConselho.includes(s));
  const contratos = e.contratos.filter((s) => casaSetor(s, termo));

  const abrirAchados = () => {
    if (!termo) return;
    const k = new Set(abertos);
    const marcar = (s: SetorEstrutura) => {
      if (s.membros.some(destaque)) k.add(`s:${s.tipo}:${s.chave}`);
      s.filhos.forEach(marcar);
    };
    e.setores.forEach(marcar);
    contratos.forEach(marcar);
    if (contratos.some((s) => s.membros.some(destaque))) setVerOperacao(true);
    setAbertos(k);
  };

  const presid = e.presidencia.length > 0 && (
    <li className="est-r">
      <BlocoTopo titulo="Presidência" icone={Crown} cor="#0f3171" pessoas={e.presidencia} onPerfil={onPerfil} />
      {daPresidencia.length > 0 && <ul className="est-r">{daPresidencia.map((s) => <RamoSetor key={s.chave} s={s} ctx={ctx} nivel={0} />)}</ul>}
    </li>
  );

  return (
    <div className="space-y-4">
      <style>{CSS}</style>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 w-80 max-w-full pl-8 pr-8" placeholder="Buscar setor, pessoa ou função… (Enter abre)" value={busca}
            onChange={(ev) => setBusca(ev.target.value)} onKeyDown={(ev) => ev.key === "Enter" && abrirAchados()} />
          {busca && (
            <button type="button" aria-label="Limpar busca" onClick={() => setBusca("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {termo && <Button variant="outline" size="sm" className="h-8 text-xs" onClick={abrirAchados}>Abrir onde aparece</Button>}
        <span className="ml-auto text-xs text-muted-foreground">
          {e.setores.length} setores · {e.contratos.length} contratos · clique num setor para ver quem está ligado a ele
        </span>
        {abertos.size > 0 && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setAbertos(new Set())}>Recolher tudo</Button>}
      </div>

      <Tela dep={`${nos.length}|${termo}`}>
        <div className="est-arvore">
          {e.conselho.length > 0 ? (
            <ul className="est-r">
              <li className="est-r">
                <BlocoTopo titulo="Conselho" icone={Landmark} cor="#7c3aed" pessoas={e.conselho} onPerfil={onPerfil} />
                {(presid || doConselho.length > 0) && (
                  <ul className="est-r">
                    {presid}
                    {doConselho.map((s) => <RamoSetor key={s.chave} s={s} ctx={ctx} nivel={0} />)}
                  </ul>
                )}
              </li>
            </ul>
          ) : presid ? <ul className="est-r">{presid}</ul> : (
            <ul className="est-r">{raizFiltrada.map((s) => <RamoSetor key={s.chave} s={s} ctx={ctx} nivel={0} />)}</ul>
          )}
          {termo && raizFiltrada.length === 0 && <p className="pt-8 text-center text-sm text-muted-foreground">Nenhum setor com “{busca.trim()}”.</p>}
        </div>
      </Tela>

      {e.contratos.length > 0 && (
        <div className="overflow-hidden rounded-3xl border bg-card">
          <button type="button" onClick={() => setVerOperacao((v) => !v)} className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-muted/40">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-sm"><HardHat className="h-5 w-5" /></span>
            <span className="flex-1">
              <span className="block text-[15px] font-semibold">Operação — por contrato</span>
              <span className="block text-xs text-muted-foreground">
                {e.contratos.length} contratos · {e.contratos.reduce((a, c) => a + c.membros.length, 0).toLocaleString("pt-BR")} pessoas em campo, cada contrato com a sua linha de comando
              </span>
            </span>
            <ChevronDown className={cn("h-5 w-5 text-muted-foreground transition-transform", verOperacao && "rotate-180")} />
          </button>
          {verOperacao && (
            <div className="est-abre grid grid-cols-[repeat(auto-fill,minmax(264px,1fr))] items-start justify-items-center gap-4 border-t bg-muted/20 p-5">
              {contratos.map((s) => <CardSetor key={s.chave} s={s} ctx={ctx} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
