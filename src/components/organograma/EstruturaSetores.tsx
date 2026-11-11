import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BarChart3, Building2, ChevronDown, ChevronRight, Crown, FileText, GraduationCap, GripVertical, HardHat, Landmark, Maximize, Megaphone, Minus,
  Link2, MapPin, Monitor, Network, Package, Plus, Scale, Search, ShieldCheck, UserCog, Users, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { funcaoDe, type NoPessoa } from "@/lib/organograma/pessoas";
import {
  casaContrato, casaSetor, montarEstrutura,
  type ContratoEstrutura, type Estrutura, type SetorEstrutura,
} from "@/lib/organograma/estruturaSetores";
import { liderancaDoContrato, liderancas, type TurmaEncarregado } from "@/lib/organograma/liderancaContrato";
import { DialogLideranca, DialogPostosEncarregado, DialogVincularEncarregado } from "./VinculoEncarregado";

// =====================================================================
// Organograma › visão ESTRUTURA (06/11/2026) — regra em
// src/lib/organograma/estruturaSetores.ts.
//
// Desenho de organograma de verdade (linhas ligando pai e filhos): Conselho
// no topo, Presidência, e a árvore de SETORES pela cadeia de comando. O
// setor mostra o responsável; clicar abre, logo abaixo do card, quem está
// ligado direto à cadeira dele. Cada pessoa abre a equipe de escritório dela
// e os CONTRATOS que supervisiona; cada contrato abre o pessoal de campo dele
// (encarregado → turma). Ninguém de campo aparece solto: está no contrato da
// Senior. Clicar no nome abre o perfil.
//
// Quem monta o organograma arrasta o contrato para cima do supervisor (ou usa
// "Definir supervisor") — grava em ORGANOGRAMA_CONTRATO_SUPERVISOR (mig
// 20261106021000). Sem isso o supervisor é deduzido pelo cadastro.
//
// "O layout tá bem ruim de ver, preciso que fique EXTREMAMENTE superior" e
// depois "adiciona mais animação" (Pablo): o desenho entra camada por camada
// com as linhas se desenhando, o card abre revelando para baixo, as listas
// entram em cascata. As animações NÃO desligam com prefers-reduced-motion — no
// Windows "efeitos de animação" desligado liga essa preferência sem a pessoa
// saber (mesma decisão do menu lateral, ver index.css .sb-flyout).
// =====================================================================

const sb = supabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const CORES = ["#0f3171", "#1d4ed8", "#0e7490", "#047857", "#7c3aed", "#be123c", "#b45309", "#334155", "#0891b2", "#9333ea"];
const corDe = (s: string) => CORES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % CORES.length];
const tituloNome = (n: string) => n.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, e, l) => e + l.toUpperCase()).replace(/\s(De|Da|Do|Das|Dos|E)\s/g, (m) => m.toLowerCase());
const curto = (n: string) => tituloNome(n.split(/\s+/).slice(0, 2).join(" "));

const ICONES: [RegExp, LucideIcon][] = [
  [/\b(RH|RECURSOS HUMANOS|PESSOAL|RECRUT)/, Users], [/FINANC|TESOUR|CONTAB|FISCAL|CONTROLADOR/, BarChart3],
  [/LICITA|CONTRATO/, FileText], [/SISTEMA|\bTI\b|TECNOLOGIA|INFORMATICA/, Monitor], [/\bSST\b|SEGURANCA|SAUDE/, ShieldCheck],
  [/TREINAMENTO/, GraduationCap], [/JURIDIC/, Scale], [/SUPRIMENTO|COMPRA|ALMOX/, Package], [/OPERAC|CAMPO|OBRA/, HardHat],
  [/MARKETING|COMUNICA/, Megaphone], [/DIRETOR/, Landmark],
];
const iconeDe = (chave: string): LucideIcon => ICONES.find(([re]) => re.test(chave))?.[1] ?? Building2;

const CSS = `
.est-arvore{--est-linha:#cbd5e1;display:flex;flex-direction:column;align-items:center}
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
.est-arvore>ul.est-r{padding-top:0;width:max-content}
.est-arvore ul.est-v{display:flex;flex-direction:column;gap:12px;margin:0 0 0 22px;padding:14px 0 0;list-style:none;align-self:flex-start}
.est-arvore li.est-v{position:relative;padding-left:22px}
.est-arvore li.est-v::before{content:"";position:absolute;left:0;top:-14px;bottom:-12px;border-left:2px solid var(--est-linha)}
.est-arvore li.est-v:not(:first-child)::before{top:-12px}
.est-arvore li.est-v:last-child::before{bottom:auto;height:50px;border-bottom:2px solid var(--est-linha);width:22px;border-bottom-left-radius:10px}
.est-arvore li.est-v:not(:first-child):last-child::before{height:48px}
.est-arvore li.est-v::after{content:"";position:absolute;left:0;top:36px;width:22px;border-top:2px solid var(--est-linha)}
.est-arvore li.est-v:last-child::after{border-top:0}

/* Entrada: cada camada chega depois da de cima, e as linhas se desenham. */
@keyframes est-chega{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}
@keyframes est-linha-x{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes est-linha-y{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.est-arvore .est-no{animation:est-chega .55s cubic-bezier(.22,1,.36,1) backwards;animation-delay:calc(var(--d,0) * 110ms)}
.est-arvore li.est-r::before{transform-origin:right;animation:est-linha-x .45s ease-out backwards;animation-delay:calc(var(--d,0) * 110ms - 60ms)}
.est-arvore li.est-r::after{transform-origin:left;animation:est-linha-x .45s ease-out backwards;animation-delay:calc(var(--d,0) * 110ms - 60ms)}
.est-arvore ul.est-r ul.est-r::before,.est-arvore li.est-v::before{transform-origin:top;animation:est-linha-y .4s ease-out backwards;animation-delay:calc(var(--d,0) * 110ms - 100ms)}

/* Abrir: o conteúdo é revelado de cima para baixo; a lista entra em cascata. */
@keyframes est-revela{from{opacity:0;clip-path:inset(0 0 100% 0);transform:translateY(-4px)}to{opacity:1;clip-path:inset(0 0 0 0);transform:none}}
.est-abre{animation:est-revela .38s cubic-bezier(.22,1,.36,1) backwards}
@keyframes est-item{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}
.est-item{animation:est-item .32s ease-out backwards;animation-delay:calc(min(var(--i,0), 14) * 28ms)}

/* Brilho do anel das cadeiras do topo e alvo do arrastar. */
@keyframes est-gira{to{transform:rotate(360deg)}}
.est-anel{position:relative;isolation:isolate}
.est-anel::before{content:"";position:absolute;inset:-3px;border-radius:9999px;background:conic-gradient(from 0deg,var(--c),transparent 40%,var(--c) 70%,transparent);z-index:-1;animation:est-gira 6s linear infinite;opacity:.85}
@keyframes est-pulsa{0%,100%{box-shadow:0 0 0 0 rgba(37,99,235,.45)}50%{box-shadow:0 0 0 6px rgba(37,99,235,0)}}
.est-alvo{animation:est-pulsa 1s ease-in-out infinite;background:rgba(37,99,235,.10)!important;outline:2px dashed rgba(37,99,235,.7);outline-offset:-2px}
@keyframes est-pop{0%{transform:scale(.6);opacity:0}70%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}
.est-pop{animation:est-pop .35s ease-out backwards}
`;

// ── Contexto (evita passar 10 props por 6 níveis) ──────────────────────
interface Ctx {
  e: Estrutura;
  abertos: Set<string>; alternar: (k: string) => void; onPerfil: (id: string) => void;
  destaque: (n: NoPessoa) => boolean; termo: string;
  podeMontar: boolean; supIds: Set<string>;
  arrastando: string | null; setArrastando: (k: string | null) => void;
  alvo: string | null; setAlvo: (id: string | null) => void;
  atribuir: (c: ContratoEstrutura, no: string | null) => void;
  definirSupervisor: (c: ContratoEstrutura) => void;
  /** SIS-2026-0770: vincular colaboradores do contrato ao encarregado (grava o "reporta a"). */
  podeVincular: boolean;
  vincular: (c: ContratoEstrutura, marcados?: string[]) => void;
  /** SIS-2026-0770 (11/11): qual encarregado responde por cada posto do contrato. */
  postos: (c: ContratoEstrutura) => void;
}
const C = createContext<Ctx | null>(null);
const useCtx = () => useContext(C)!;
const MIME = "application/x-organograma-contrato";

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

function CadeiraTopo({ no, cor, onPerfil }: { no: NoPessoa; cor: string; onPerfil: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onPerfil(no.id)}
      className="group flex w-[230px] flex-col items-center rounded-2xl bg-card px-4 pb-4 pt-5 text-center shadow-[0_6px_20px_-8px_rgba(15,23,42,.25)] ring-1 ring-black/5 transition duration-300 hover:-translate-y-1 hover:shadow-[0_16px_34px_-12px_rgba(15,23,42,.4)] dark:ring-white/10">
      <span className="est-anel rounded-full p-[3px] transition-transform duration-300 group-hover:scale-105" style={{ "--c": cor, background: "hsl(var(--card))" } as CSSProperties}>
        <Foto no={no} tamanho={68} anel={false} />
      </span>
      <span className="mt-3 line-clamp-2 text-[15px] font-semibold leading-tight group-hover:underline">{tituloNome(no.nome)}</span>
      <span className="mt-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: cor }}>{funcaoDe(no) || "—"}</span>
    </button>
  );
}

function BlocoTopo({ titulo, icone: Icone, cor, pessoas, onPerfil, d }: { titulo: string; icone: LucideIcon; cor: string; pessoas: NoPessoa[]; onPerfil: (id: string) => void; d: number }) {
  return (
    <div className="est-no relative rounded-[22px] border-2 border-dashed px-5 pb-5 pt-7" style={{ borderColor: `${cor}66`, background: `${cor}0a`, "--d": d } as CSSProperties}>
      <span className="absolute -top-3.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white shadow-sm" style={{ background: cor }}>
        <Icone className="h-3.5 w-3.5" /> {titulo}
      </span>
      <div className="flex gap-4">
        {pessoas.map((p) => <CadeiraTopo key={p.id} no={p} cor={cor} onPerfil={onPerfil} />)}
      </div>
    </div>
  );
}

/** Pessoa nas listas. `contrato` = está dentro de um contrato (abre a turma dela no contrato). */
function Pessoa({ no, nivel, i, contrato }: { no: NoPessoa; nivel: number; i: number; contrato?: string }) {
  const ctx = useCtx();
  const { e } = ctx;
  const escritorio = contrato ? [] : e.equipeEscritorio(no.id);
  const seus = contrato ? [] : e.contratosDe(no.id);
  const turma = contrato ? e.equipeNoContrato(no.id, contrato) : [];
  const qtd = escritorio.length + seus.length + turma.length;
  const chave = `p:${no.id}:${contrato ?? ""}`;
  const aberto = ctx.abertos.has(chave);
  const ehAlvo = ctx.alvo === no.id;
  const recebe = !contrato && ctx.podeMontar && ctx.supIds.has(no.id) && !!ctx.arrastando;

  const onDragOver = (ev: DragEvent) => {
    if (!recebe || !ev.dataTransfer.types.includes(MIME)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    if (ctx.alvo !== no.id) ctx.setAlvo(no.id);
  };
  const onDrop = (ev: DragEvent) => {
    const k = ev.dataTransfer.getData(MIME);
    ctx.setAlvo(null);
    const c = e.contratos.find((x) => x.chave === k);
    if (c && recebe) { ev.preventDefault(); ctx.atribuir(c, no.id); if (!aberto) ctx.alternar(chave); }
  };

  return (
    <li className="est-item" style={{ "--i": i } as CSSProperties}>
      <div onDragOver={onDragOver} onDragLeave={() => ehAlvo && ctx.setAlvo(null)} onDrop={onDrop}
        className={cn("group flex items-center gap-2 rounded-lg py-1.5 pr-1.5 transition-colors hover:bg-muted/70",
          ctx.destaque(no) && "bg-amber-100 dark:bg-amber-900/40", recebe && "ring-1 ring-dashed ring-primary/30", ehAlvo && "est-alvo")}
        style={{ paddingLeft: 4 + nivel * 16 }}>
        {qtd ? (
          <button type="button" onClick={() => ctx.alternar(chave)} aria-label={aberto ? "Recolher" : "Abrir equipe"}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground">
            <ChevronRight className={cn("h-4 w-4 transition-transform duration-300", aberto && "rotate-90")} />
          </button>
        ) : <span className="w-6 shrink-0" />}
        <Foto no={no} tamanho={30} />
        <button type="button" onClick={() => ctx.onPerfil(no.id)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13px] font-medium leading-tight group-hover:underline">{tituloNome(no.nome)}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {funcaoDe(no) || "—"}{seus.length ? <b className="ml-1 font-semibold text-amber-700 dark:text-amber-300">· {seus.length} contrato{seus.length > 1 ? "s" : ""}</b> : null}
          </span>
        </button>
        {qtd > 0 && (
          <button type="button" onClick={() => ctx.alternar(chave)} title={`${qtd} direto(s) · ${e.totalAbaixo(no.id)} no total abaixo`}
            className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-muted-foreground">
            {qtd}
          </button>
        )}
      </div>
      {aberto && qtd > 0 && (
        <ul className="est-abre">
          {escritorio.map((f, j) => <Pessoa key={f.id} no={f} nivel={nivel + 1} i={j} />)}
          {seus.map((c, j) => <LinhaContrato key={c.chave} c={c} nivel={nivel + 1} i={escritorio.length + j} />)}
          {turma.map((f, j) => <Pessoa key={f.id} no={f} nivel={nivel + 1} i={j} contrato={contrato} />)}
        </ul>
      )}
    </li>
  );
}

// ── SIS-2026-0770: dentro do contrato, a turma de CADA encarregado ─────
// Regra em lib/organograma/liderancaContrato.ts. Contrato sem encarregado
// segue como antes (quem responde direto ao supervisor/escritório).

/** Linha simples de quem está na turma (sem equipe própria para abrir). */
function PessoaTurma({ no, nivel, i, via }: { no: NoPessoa; nivel: number; i: number; via?: NoPessoa | null }) {
  const ctx = useCtx();
  return (
    <li className="est-item" style={{ "--i": i } as CSSProperties}>
      <button type="button" onClick={() => ctx.onPerfil(no.id)}
        className={cn("group flex w-full items-center gap-2 rounded-lg py-1 pr-1.5 text-left transition-colors hover:bg-muted/70", ctx.destaque(no) && "bg-amber-100 dark:bg-amber-900/40")}
        style={{ paddingLeft: 4 + nivel * 16 + 30 }}>
        <Foto no={no} tamanho={24} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] leading-tight group-hover:underline">{tituloNome(no.nome)}</span>
          <span className="block truncate text-[10.5px] text-muted-foreground">{funcaoDe(no) || "—"}{via ? ` · direto: ${curto(via.nome)}` : ""}</span>
        </span>
      </button>
    </li>
  );
}

function LinhaTurma({ t, c, nivel, i }: { t: TurmaEncarregado; c: ContratoEstrutura; nivel: number; i: number }) {
  const ctx = useCtx();
  const k = `t:${c.chave}:${t.encarregado.id}`;
  const aberto = ctx.abertos.has(k) || (!!ctx.termo && t.equipe.some(ctx.destaque));
  const porId = useMemo(() => new Map(c.membros.map((m) => [m.id, m])), [c.membros]);
  return (
    <li className="est-item" style={{ "--i": i } as CSSProperties}>
      <div className={cn("group flex items-center gap-2 rounded-lg py-1.5 pr-1.5 transition-colors hover:bg-muted/70", ctx.destaque(t.encarregado) && "bg-amber-100 dark:bg-amber-900/40")}
        style={{ paddingLeft: 4 + nivel * 16 }}>
        {t.equipe.length ? (
          <button type="button" onClick={() => ctx.alternar(k)} aria-label={aberto ? "Recolher turma" : "Abrir turma"} aria-expanded={aberto}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground">
            <ChevronRight className={cn("h-4 w-4 transition-transform duration-300", aberto && "rotate-90")} />
          </button>
        ) : <span className="w-6 shrink-0" />}
        <Foto no={t.encarregado} tamanho={30} />
        <button type="button" onClick={() => ctx.onPerfil(t.encarregado.id)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13px] font-semibold leading-tight group-hover:underline">{tituloNome(t.encarregado.nome)}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            <b className="font-semibold text-sky-700 dark:text-sky-300">Encarregado</b> · {funcaoDe(t.encarregado) || "—"}{t.acima ? ` · responde a ${curto(t.acima.nome)}` : ""}
          </span>
        </button>
        <button type="button" onClick={() => t.equipe.length && ctx.alternar(k)} title={`${t.equipe.length} se reportam a este encarregado`}
          className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">
          {t.equipe.length}
        </button>
      </div>
      {aberto && t.equipe.length > 0 && (
        <ul className="est-abre">
          {t.equipe.map((p, j) => (
            <PessoaTurma key={p.id} no={p} nivel={nivel} i={j} via={p.parent_id && p.parent_id !== t.encarregado.id ? porId.get(p.parent_id) ?? null : null} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ConteudoContrato({ c, nivel }: { c: ContratoEstrutura; nivel: number }) {
  const ctx = useCtx();
  const lid = useMemo(() => liderancaDoContrato(c), [c]);
  if (!lid.encarregados.length) {
    return <>{c.cabecas.map((p, j) => <Pessoa key={p.id} no={p} nivel={nivel} i={j} contrato={c.chave} />)}</>;
  }
  return (
    <>
      {lid.encarregados.map((t, j) => <LinhaTurma key={t.encarregado.id} t={t} c={c} nivel={nivel} i={j} />)}
      {lid.semEncarregado.length > 0 && (
        <li className="est-item mt-1 rounded-lg border border-dashed border-amber-400/70 bg-amber-50/60 p-1 dark:bg-amber-950/20" style={{ "--i": lid.encarregados.length } as CSSProperties}>
          <div className="flex flex-wrap items-center gap-2 px-1.5 py-1">
            <p className="flex-1 text-[10.5px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              Sem encarregado · {lid.semEncarregado.length}
            </p>
            {ctx.podeVincular && (
              <button type="button" onClick={() => ctx.vincular(c, lid.semEncarregado.map((p) => p.id))}
                className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-white transition hover:bg-amber-700">
                <Link2 className="h-3 w-3" /> Vincular ao encarregado
              </button>
            )}
          </div>
          <ul>{lid.semEncarregado.map((p, j) => <PessoaTurma key={p.id} no={p} nivel={nivel} i={j} />)}</ul>
        </li>
      )}
    </>
  );
}

/** Contrato como "pasta" dentro do supervisor: arrastável, abre o pessoal de campo. */
function LinhaContrato({ c, nivel, i }: { c: ContratoEstrutura; nivel: number; i: number }) {
  const ctx = useCtx();
  const k = `c:${c.chave}`;
  const aberto = ctx.abertos.has(k) || (!!ctx.termo && c.membros.some(ctx.destaque));
  const arrasta = ctx.podeMontar && c.chave !== "sem";
  return (
    <li className="est-item" style={{ "--i": i } as CSSProperties}>
      <div draggable={arrasta}
        onDragStart={(ev) => { ev.dataTransfer.setData(MIME, c.chave); ev.dataTransfer.effectAllowed = "move"; ctx.setArrastando(c.chave); }}
        onDragEnd={() => { ctx.setArrastando(null); ctx.setAlvo(null); }}
        className={cn("group flex items-center gap-1.5 rounded-lg py-1.5 pr-1.5 transition hover:bg-amber-50 dark:hover:bg-amber-950/30",
          ctx.arrastando === c.chave && "opacity-50", arrasta && "cursor-grab active:cursor-grabbing")}
        style={{ paddingLeft: 4 + nivel * 16 }}>
        <button type="button" onClick={() => ctx.alternar(k)} aria-label={aberto ? "Recolher contrato" : "Abrir contrato"}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground">
          <ChevronRight className={cn("h-4 w-4 transition-transform duration-300", aberto && "rotate-90")} />
        </button>
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-sm transition-transform duration-300 group-hover:rotate-[-6deg] group-hover:scale-105">
          <HardHat className="h-4 w-4" />
        </span>
        <button type="button" onClick={() => ctx.alternar(k)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[12.5px] font-semibold leading-tight">{c.nome}</span>
          <span className="block truncate text-[10.5px] text-muted-foreground">
            {c.membros.length.toLocaleString("pt-BR")} pessoa{c.membros.length === 1 ? "" : "s"} em campo
            {c.origem === "cadastro" && " · supervisor pelo cadastro"}
          </span>
        </button>
        {ctx.podeMontar && c.chave !== "sem" && (
          <button type="button" title="Definir supervisor do contrato" onClick={() => ctx.definirSupervisor(c)}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition hover:bg-background hover:text-foreground group-hover:opacity-100">
            <UserCog className="h-3.5 w-3.5" />
          </button>
        )}
        {ctx.podeVincular && c.chave !== "sem" && (
          <button type="button" title="Vincular colaboradores ao encarregado" aria-label={`Vincular colaboradores ao encarregado — ${c.nome}`} onClick={() => ctx.vincular(c)}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition hover:bg-background hover:text-foreground focus:opacity-100 group-hover:opacity-100">
            <Link2 className="h-3.5 w-3.5" />
          </button>
        )}
        {ctx.podeVincular && c.chave !== "sem" && (
          <button type="button" title="Encarregado por posto" aria-label={`Encarregado por posto — ${c.nome}`} onClick={() => ctx.postos(c)}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition hover:bg-background hover:text-foreground focus:opacity-100 group-hover:opacity-100">
            <MapPin className="h-3.5 w-3.5" />
          </button>
        )}
        {arrasta && <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50 opacity-0 transition group-hover:opacity-100" />}
      </div>
      {aberto && (
        <ul className="est-abre ml-4 border-l-2 border-amber-300/60 pl-1 dark:border-amber-700/50">
          <ConteudoContrato c={c} nivel={nivel} />
        </ul>
      )}
    </li>
  );
}

/** O que abre no setor: a equipe de escritório ligada à cadeira e os contratos do responsável. */
function ListaLigados({ s }: { s: SetorEstrutura }) {
  const ctx = useCtx();
  const { e } = ctx;
  const r = s.responsavel;
  const pessoas = useMemo(() => {
    const vistos = new Set<string>(r ? [r.id] : []);
    const deFora = s.chave === e.setorOperacional ? e.supervisoresDeFora : [];
    return [...(r ? e.equipeEscritorio(r.id) : []), ...s.cabecas.slice(1), ...deFora].filter((n) => !vistos.has(n.id) && !!vistos.add(n.id));
  }, [r, s.cabecas, e]);
  const doResp = r ? e.contratosDe(r.id) : [];
  // Contratos sem dono aparecem no setor operacional, prontos para arrastar.
  const ehOperacional = s.chave === e.setorOperacional;
  const soltos = ehOperacional ? e.semSupervisor.filter((c) => casaContrato(c, ctx.termo)) : [];
  if (!pessoas.length && !doResp.length && !soltos.length) return <p className="px-2 py-2 text-xs text-muted-foreground">Ninguém ligado a este setor.</p>;
  return (
    <div className="max-h-[460px] overflow-y-auto overscroll-contain">
      <ul>
        {pessoas.map((p, j) => <Pessoa key={p.id} no={p} nivel={0} i={j} />)}
        {doResp.map((c, j) => <LinhaContrato key={c.chave} c={c} nivel={0} i={pessoas.length + j} />)}
      </ul>
      {soltos.length > 0 && (
        <div className="mt-2 rounded-xl border border-dashed border-amber-400/70 bg-amber-50/60 p-1.5 dark:bg-amber-950/20">
          <p className="px-1.5 pb-1 pt-0.5 text-[10.5px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
            Contratos sem supervisor · {soltos.length}
            {ctx.podeMontar && <span className="ml-1 font-medium normal-case tracking-normal text-amber-700/80 dark:text-amber-300/80">— arraste para um supervisor</span>}
          </p>
          <ul>{soltos.map((c, j) => <LinhaContrato key={c.chave} c={c} nivel={0} i={j} />)}</ul>
        </div>
      )}
    </div>
  );
}

function CardSetor({ s, d }: { s: SetorEstrutura; d: number }) {
  const ctx = useCtx();
  const k = `s:${s.chave}`;
  const aberto = ctx.abertos.has(k);
  const cor = corDe(s.chave);
  const Icone = iconeDe(s.chave);
  const r = s.responsavel;
  // Contratos debaixo do setor inteiro (no Operacional = todos), não só os do responsável.
  const nContratos = ctx.e.contratosDoSetor(s.chave).length;
  return (
    <div className={cn("est-no group/card relative overflow-hidden rounded-2xl bg-card text-left ring-1 ring-black/5 transition-[width,box-shadow,transform] duration-300 dark:ring-white/10",
      aberto ? "w-[360px] shadow-[0_18px_40px_-14px_rgba(15,23,42,.45)]" : "w-[248px] shadow-[0_6px_18px_-8px_rgba(15,23,42,.22)] hover:-translate-y-1 hover:shadow-[0_14px_30px_-10px_rgba(15,23,42,.35)]")}
      style={{ "--d": d } as CSSProperties}>
      <button type="button" onClick={() => ctx.alternar(k)} aria-expanded={aberto} className="block w-full text-left">
        <div className="relative flex items-center gap-2.5 overflow-hidden px-3.5 py-2.5 text-white" style={{ background: `linear-gradient(120deg, ${cor}, ${cor}d0)` }}>
          {/* brilho que passa no hover */}
          <span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 -skew-x-12 bg-white/20 opacity-0 transition-all duration-700 group-hover/card:left-[120%] group-hover/card:opacity-100" />
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/20 transition-transform duration-300 group-hover/card:scale-110"><Icone className="h-[18px] w-[18px]" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold leading-tight">{s.nome}</span>
            <span className="block text-[11px] text-white/80">
              {s.membros.length.toLocaleString("pt-BR")} pessoa{s.membros.length === 1 ? "" : "s"}
              {s.filhos.length ? ` · ${s.filhos.length} setor${s.filhos.length === 1 ? "" : "es"} abaixo` : ""}
              {nContratos ? ` · ${nContratos} contrato${nContratos === 1 ? "" : "s"}` : ""}
            </span>
          </span>
          <ChevronDown className={cn("h-5 w-5 shrink-0 opacity-80 transition-transform duration-300", aberto && "rotate-180")} />
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
          <p className="px-2 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Ligados à cadeira</p>
          <ListaLigados s={s} />
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
function RamoSetor({ s, nivel, d, vertical = false }: { s: SetorEstrutura; nivel: number; d: number; vertical?: boolean }) {
  const ctx = useCtx();
  const filhos = s.filhos.filter((f) => casaSetor(f, ctx.termo));
  const pendurar = vertical || nivel >= 1;
  return (
    <li className={vertical ? "est-v" : "est-r"} style={{ "--d": d } as CSSProperties}>
      <div className="flex flex-col">
        <CardSetor s={s} d={d} />
        {filhos.length > 0 && (pendurar
          ? <ul className="est-v" style={{ "--d": d + 1 } as CSSProperties}>{filhos.map((f, j) => <RamoSetor key={f.chave} s={f} nivel={nivel + 1} d={d + 1 + j * 0.5} vertical />)}</ul>
          : <ul className="est-r self-center" style={{ "--d": d + 1 } as CSSProperties}>{filhos.map((f) => <RamoSetor key={f.chave} s={f} nivel={nivel + 1} d={d + 1} />)}</ul>)}
      </div>
    </li>
  );
}

/** Caixa rolável com zoom: abre cabendo na largura; +/− e "caber" à mão; arrastar o fundo move. */
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
    setZoom(+Math.min(1, Math.max(0.5, (c.clientWidth - 16) / larg)).toFixed(2));
  }, [zoom]);
  useLayoutEffect(() => { if (!manual) caber(); }, [dep]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (manual || !caixa.current) return;
    const ro = new ResizeObserver(() => caber());
    ro.observe(caixa.current);
    return () => ro.disconnect();
  }, [manual, caber]);
  const passo = (d: number) => { setManual(true); setZoom((z) => Math.min(1.5, Math.max(0.35, +(z + d).toFixed(2)))); };
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
        onMouseDown={(ev) => {
          if ((ev.target as HTMLElement).closest("button,a,input,[draggable=true]")) return;
          arrasto.current = { x: ev.clientX, y: ev.clientY, l: caixa.current!.scrollLeft, t: caixa.current!.scrollTop };
        }}
        onMouseMove={(ev) => {
          const a = arrasto.current;
          if (!a || !caixa.current) return;
          caixa.current.scrollLeft = a.l - (ev.clientX - a.x);
          caixa.current.scrollTop = a.t - (ev.clientY - a.y);
        }}
        onMouseUp={() => (arrasto.current = null)} onMouseLeave={() => (arrasto.current = null)}
        className="max-h-[calc(100vh-250px)] min-h-[460px] cursor-grab overflow-auto rounded-3xl border bg-[radial-gradient(circle,_hsl(var(--muted))_1px,_transparent_1px)] [background-size:20px_20px] active:cursor-grabbing print:max-h-none print:overflow-visible">
        <div ref={conteudo} className="mx-auto w-max min-w-full px-6 pb-12 pt-10" style={{ zoom }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Escolher o supervisor do contrato (alternativa ao arrastar). */
function DialogSupervisor({ c, supervisores, onFechar, onEscolher }: {
  c: ContratoEstrutura; supervisores: NoPessoa[]; onFechar: () => void; onEscolher: (no: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const lista = supervisores.filter((s) => !q || sem(`${s.nome} ${funcaoDe(s)} ${s.setor ?? ""}`).includes(sem(q)));
  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Supervisor do contrato</DialogTitle>
          <DialogDescription>{c.nome} · {c.membros.length.toLocaleString("pt-BR")} pessoa(s). O contrato e o pessoal dele passam a ficar dentro de quem você escolher.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus className="pl-8" placeholder="Buscar supervisor…" value={q} onChange={(ev) => setQ(ev.target.value)} />
        </div>
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {lista.map((s, j) => (
            <button key={s.id} type="button" onClick={() => onEscolher(s.id)} style={{ "--i": j } as CSSProperties}
              className={cn("est-item flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition hover:border-primary/40 hover:bg-primary/5",
                c.supervisor?.id === s.id && "border-primary/60 bg-primary/5")}>
              <Foto no={s} tamanho={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{tituloNome(s.nome)}</span>
                <span className="block truncate text-xs text-muted-foreground">{funcaoDe(s)}{s.setor ? ` · ${s.setor}` : ""}</span>
              </span>
              {c.supervisor?.id === s.id && <span className="text-[11px] font-semibold text-primary">{c.origem === "definido" ? "atual" : "pelo cadastro"}</span>}
            </button>
          ))}
          {!lista.length && <p className="py-6 text-center text-sm text-muted-foreground">Nenhum supervisor encontrado.</p>}
        </div>
        {c.origem === "definido" && (
          <Button variant="ghost" className="text-muted-foreground" onClick={() => onEscolher(null)}>Tirar a escolha (volta ao que o cadastro diz)</Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "2 encarregados · 5 sem encarregado" no card do contrato. */
function ResumoEncarregados({ c }: { c: ContratoEstrutura }) {
  const ctx = useCtx();
  const lid = useMemo(() => liderancaDoContrato(c), [c]);
  if (!lid.encarregados.length && !ctx.podeVincular) return null;
  if (!lid.encarregados.length) {
    return (
      <div className="flex items-center gap-2 border-t px-2.5 py-1.5 text-[11px]">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-sky-600" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">Nenhum encarregado reconhecido</span>
        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => ctx.postos(c)}>Postos</button>
      </div>
    );
  }
  const sem = lid.semEncarregado.length;
  return (
    <div className="flex items-center gap-2 border-t px-2.5 py-1.5 text-[11px]">
      <Network className="h-3.5 w-3.5 shrink-0 text-sky-600" />
      <span className="min-w-0 flex-1 truncate">
        <b className="font-semibold">{lid.encarregados.length} encarregado{lid.encarregados.length > 1 ? "s" : ""}</b>
        {sem ? <b className="font-semibold text-amber-700 dark:text-amber-300"> · {sem} sem encarregado</b> : <span className="text-muted-foreground"> · todos vinculados</span>}
      </span>
      {ctx.podeVincular && sem > 0 && (
        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => ctx.vincular(c, lid.semEncarregado.map((p) => p.id))}>Vincular</button>
      )}
      {ctx.podeVincular && (
        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => ctx.postos(c)}>Postos</button>
      )}
    </div>
  );
}

function CardContrato({ c, i }: { c: ContratoEstrutura; i: number }) {
  const ctx = useCtx();
  return (
    <div className="est-item w-full rounded-2xl border bg-card p-1.5 shadow-sm transition hover:shadow-md" style={{ "--i": i } as CSSProperties}>
      <ul><LinhaContrato c={c} nivel={0} i={0} /></ul>
      <ResumoEncarregados c={c} />
      <div className="flex items-center gap-2 border-t px-2.5 pb-1 pt-2 text-[11px]">
        {c.supervisor ? (
          <>
            <Foto no={c.supervisor} tamanho={20} />
            <span className="min-w-0 flex-1 truncate"><b className="font-semibold">{curto(c.supervisor.nome)}</b><span className="text-muted-foreground"> · {c.origem === "definido" ? "supervisor" : "pelo cadastro"}</span></span>
          </>
        ) : <span className="flex-1 font-semibold text-amber-700 dark:text-amber-300">Sem supervisor</span>}
        {ctx.podeMontar && c.chave !== "sem" && (
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => ctx.definirSupervisor(c)}>{c.supervisor ? "Trocar" : "Definir"}</button>
        )}
      </div>
    </div>
  );
}

export function EstruturaSetores({ nos, onPerfil, podeMontar = false }: { nos: NoPessoa[]; onPerfil: (id: string) => void; podeMontar?: boolean }) {
  const qc = useQueryClient();
  // Supervisor gravado por contrato. Tabela nova (mig 20261106021000): se ainda
  // não existe no banco, a tela segue só com o que o cadastro diz.
  const definidosQ = useQuery({
    queryKey: ["organograma-contrato-supervisor"],
    queryFn: async () => {
      const { data, error } = await sb.from("ORGANOGRAMA_CONTRATO_SUPERVISOR").select("empresa, filial, no_id").range(0, 4999);
      if (error) throw error;
      return new Map<string, string>((data ?? []).map((r: { empresa: number; filial: number; no_id: string }) => [`${r.empresa}-${r.filial}`, r.no_id]));
    },
    retry: false, staleTime: 60_000,
  });
  const definidos = useMemo(() => definidosQ.data ?? new Map<string, string>(), [definidosQ.data]);
  const bancoPronto = definidosQ.isSuccess;
  const e = useMemo(() => montarEstrutura(nos, definidos), [nos, definidos]);

  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [verOperacao, setVerOperacao] = useState(false);
  const [filtroOp, setFiltroOp] = useState<"todos" | "sem">("todos");
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [escolhendo, setEscolhendo] = useState<ContratoEstrutura | null>(null);
  const [vinculando, setVinculando] = useState<{ c: ContratoEstrutura; marcados?: string[] } | null>(null);
  // Pela chave: depois de salvar a árvore recarrega e o diálogo mostra o contrato novo.
  const [postosDe, setPostosDe] = useState<string | null>(null);
  const contratoPostos = postosDe ? e.contratos.find((x) => x.chave === postosDe) ?? null : null;
  const [verLideranca, setVerLideranca] = useState(false);
  const linhasLideranca = useMemo(() => (verLideranca ? liderancas(nos, e) : []), [verLideranca, nos, e]);
  const alternar = useCallback((k: string) => setAbertos((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; }), []);

  const salvar = useMutation({
    mutationFn: async ({ c, no }: { c: ContratoEstrutura; no: string | null }) => {
      const { error } = await sb.rpc("organograma_definir_supervisor_contrato", { p_empresa: c.empresa, p_filial: c.filial, p_no: no });
      if (error) throw error;
    },
    onMutate: ({ c, no }) => {
      const antes = qc.getQueryData<Map<string, string>>(["organograma-contrato-supervisor"]);
      const novo = new Map(antes ?? []);
      if (no) novo.set(c.chave, no); else novo.delete(c.chave);
      qc.setQueryData(["organograma-contrato-supervisor"], novo);
      return { antes };
    },
    onError: (err: Error, _v, ctx) => {
      qc.setQueryData(["organograma-contrato-supervisor"], ctx?.antes);
      toast.error(err.message || "Não deu para salvar o supervisor do contrato.");
    },
    onSuccess: (_d, { c, no }) => {
      const p = no ? nos.find((n) => n.id === no) : null;
      toast.success(p ? `${c.nome} agora fica com ${curto(p.nome)}.` : `${c.nome}: supervisor volta a ser o do cadastro.`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["organograma-contrato-supervisor"] }),
  });

  const podeAtribuir = podeMontar && bancoPronto;
  const termo = busca.trim().length >= 2 ? busca.trim() : "";
  const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const destaque = useCallback((n: NoPessoa) => !!termo && (sem(n.nome).includes(sem(termo)) || sem(funcaoDe(n)).includes(sem(termo))), [termo]);
  const supIds = useMemo(() => new Set(e.supervisores.map((s) => s.id)), [e]);

  const ctx: Ctx = {
    e, abertos, alternar, onPerfil, destaque, termo, podeMontar: podeAtribuir, supIds,
    arrastando, setArrastando, alvo, setAlvo,
    atribuir: (c, no) => { if (c.supervisor?.id !== no || c.origem !== "definido") salvar.mutate({ c, no }); },
    definirSupervisor: (c) => setEscolhendo(c),
    podeVincular: podeMontar,
    vincular: (c, marcados) => setVinculando({ c, marcados }),
    postos: (c) => setPostosDe(c.chave),
  };

  const idsConselho = new Set(e.conselho.map((c) => c.id));
  const raizFiltrada = e.raiz.filter((s) => casaSetor(s, termo));
  const doConselho = raizFiltrada.filter((s) => s.ligadoA && idsConselho.has(s.ligadoA));
  const daPresidencia = raizFiltrada.filter((s) => !doConselho.includes(s));
  const contratosVisiveis = e.contratos.filter((c) => casaContrato(c, termo) && (filtroOp === "todos" || !c.supervisor));

  const abrirAchados = () => {
    if (!termo) return;
    const k = new Set(abertos);
    const marcar = (s: SetorEstrutura) => { if (s.membros.some(destaque)) k.add(`s:${s.chave}`); s.filhos.forEach(marcar); };
    e.setores.forEach(marcar);
    if (e.contratos.some((c) => c.membros.some(destaque))) setVerOperacao(true);
    setAbertos(k);
  };

  const dPres = e.conselho.length ? 1 : 0;
  const presid = e.presidencia.length > 0 && (
    <li className="est-r" style={{ "--d": dPres } as CSSProperties}>
      <BlocoTopo titulo="Presidência" icone={Crown} cor="#0f3171" pessoas={e.presidencia} onPerfil={onPerfil} d={dPres} />
      {daPresidencia.length > 0 && (
        <ul className="est-r" style={{ "--d": dPres + 1 } as CSSProperties}>
          {daPresidencia.map((s) => <RamoSetor key={s.chave} s={s} nivel={0} d={dPres + 1} />)}
        </ul>
      )}
    </li>
  );

  const semSup = e.semSupervisor.length;

  return (
    <C.Provider value={ctx}>
      <div className="space-y-4">
        <style>{CSS}</style>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-9 w-80 max-w-full pl-8 pr-8" placeholder="Buscar setor, pessoa, função ou contrato… (Enter abre)" value={busca}
              onChange={(ev) => setBusca(ev.target.value)} onKeyDown={(ev) => ev.key === "Enter" && abrirAchados()} />
            {busca && (
              <button type="button" aria-label="Limpar busca" onClick={() => setBusca("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {termo && <Button variant="outline" size="sm" className="h-8 text-xs" onClick={abrirAchados}>Abrir onde aparece</Button>}
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setVerLideranca(true)}>
            <Network className="mr-1.5 h-3.5 w-3.5" /> Liderança por colaborador
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {e.setores.length} setores · {e.contratos.length} contratos{semSup ? <b className="font-semibold text-amber-700 dark:text-amber-300"> · {semSup} sem supervisor</b> : null}
          </span>
          {abertos.size > 0 && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setAbertos(new Set())}>Recolher tudo</Button>}
        </div>
        {podeMontar && !bancoPronto && definidosQ.isError && (
          <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            Definir o supervisor de cada contrato fica disponível quando a atualização do banco for aplicada. Por enquanto, os contratos seguem o que o cadastro diz.
          </p>
        )}

        <Tela dep={`${nos.length}|${termo}`}>
          <div className="est-arvore">
            {e.conselho.length > 0 ? (
              <ul className="est-r">
                <li className="est-r" style={{ "--d": 0 } as CSSProperties}>
                  <BlocoTopo titulo="Conselho" icone={Landmark} cor="#7c3aed" pessoas={e.conselho} onPerfil={onPerfil} d={0} />
                  {(presid || doConselho.length > 0) && (
                    <ul className="est-r" style={{ "--d": 1 } as CSSProperties}>
                      {presid}
                      {doConselho.map((s) => <RamoSetor key={s.chave} s={s} nivel={0} d={1} />)}
                    </ul>
                  )}
                </li>
              </ul>
            ) : presid ? <ul className="est-r">{presid}</ul> : (
              <ul className="est-r">{raizFiltrada.map((s) => <RamoSetor key={s.chave} s={s} nivel={0} d={0} />)}</ul>
            )}
            {termo && raizFiltrada.length === 0 && <p className="pt-8 text-center text-sm text-muted-foreground">Nenhum setor com “{busca.trim()}”.</p>}
          </div>
        </Tela>

        {e.contratos.length > 0 && (
          <div className="overflow-hidden rounded-3xl border bg-card">
            <button type="button" onClick={() => setVerOperacao((v) => !v)} className="group flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-muted/40">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-sm transition-transform duration-300 group-hover:rotate-[-8deg] group-hover:scale-110"><HardHat className="h-5 w-5" /></span>
              <span className="flex-1">
                <span className="block text-[15px] font-semibold">Operação — todos os contratos</span>
                <span className="block text-xs text-muted-foreground">
                  {e.contratos.length} contratos · {e.contratos.reduce((a, c) => a + c.membros.length, 0).toLocaleString("pt-BR")} pessoas em campo, cada uma no contrato da Senior
                </span>
              </span>
              {semSup > 0 && <span className="est-pop rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">{semSup} sem supervisor</span>}
              <ChevronDown className={cn("h-5 w-5 text-muted-foreground transition-transform duration-300", verOperacao && "rotate-180")} />
            </button>
            {verOperacao && (
              <div className="est-abre border-t bg-muted/20 p-5">
                <div className="mb-3 inline-flex rounded-xl border bg-background p-1 text-xs font-semibold">
                  {([["todos", "Todos"], ["sem", `Sem supervisor (${semSup})`]] as const).map(([v, r]) => (
                    <button key={v} type="button" onClick={() => setFiltroOp(v)}
                      className={cn("rounded-lg px-3 py-1.5 transition", filtroOp === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{r}</button>
                  ))}
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-3">
                  {contratosVisiveis.map((c, i) => <CardContrato key={c.chave} c={c} i={i} />)}
                </div>
                {!contratosVisiveis.length && <p className="py-6 text-center text-sm text-muted-foreground">Nenhum contrato aqui.</p>}
              </div>
            )}
          </div>
        )}

        {vinculando && (
          <DialogVincularEncarregado c={vinculando.c} marcadosIniciais={vinculando.marcados} onFechar={() => setVinculando(null)} />
        )}
        {contratoPostos && <DialogPostosEncarregado c={contratoPostos} nos={nos} onFechar={() => setPostosDe(null)} />}
        {verLideranca && (
          <DialogLideranca linhas={linhasLideranca} onPerfil={onPerfil} onFechar={() => setVerLideranca(false)} />
        )}
        {escolhendo && (
          <DialogSupervisor c={escolhendo} supervisores={e.supervisores}
            onFechar={() => setEscolhendo(null)}
            onEscolher={(no) => { ctx.atribuir(escolhendo, no); setEscolhendo(null); }} />
        )}
      </div>
    </C.Provider>
  );
}

