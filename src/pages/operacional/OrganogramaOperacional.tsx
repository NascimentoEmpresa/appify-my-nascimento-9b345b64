import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRightLeft, ChevronDown, ChevronRight, Crown, HardHat, History, Loader2, MoreVertical, Network, Search, ShieldCheck,
  UserCog, UserMinus, UserPlus, Users, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  acoesDoMenu, contratosDoEncarregado, contratosDoSupervisor, encarregadoEfetivo, montarArvore,
  type AcaoMenu, type AlvoMenu, type ContratoOrg, type HistoricoOrg, type PainelOrg, type PessoaOrg, type RamoEncarregado, type RamoSupervisor,
} from "@/lib/operacional/organogramaOperacional";

// =====================================================================
// Operacional › Organograma › Operacional (17/11/2026, mig
// 20261117000100_ope_organograma_operacional). Regra em
// src/lib/operacional/organogramaOperacional.ts.
//
// GERENTE OPERACIONAL › SUPERVISORES › ENCARREGADOS › CONTRATO › colaboradores.
// É daqui que Ponto do encarregado, Documentos do RH e Solicitar Treinamento
// tiram "quem é o encarregado do contrato" (rh_hier_responsaveis); contrato
// sem encarregado definido aqui fica sem ninguém (a Hierarquia de Postos, que
// era a reserva, foi removida em 17/11/2026 — mig 20261117000300).
// Botão direito (ou o ⋮) em pessoa ou contrato abre as ações.
// =====================================================================

const MENU = "ope_organograma";
const sb = supabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const CHAVE = ["ope-organograma-painel"];

const tituloNome = (n: string) => n.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, e, l) => e + l.toUpperCase()).replace(/\s(De|Da|Do|Das|Dos|E)\s/g, (m) => m.toLowerCase());
const curto = (n: string) => tituloNome(n.split(/\s+/).slice(0, 2).join(" "));
const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const CORES = ["#0f3171", "#1d4ed8", "#0e7490", "#047857", "#7c3aed", "#be123c", "#b45309", "#334155", "#0891b2", "#9333ea"];
const corDe = (s: string) => CORES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % CORES.length];
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const plural = (n: number, um: string, varios: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;

const CSS = `
@keyframes oo-revela{from{opacity:0;clip-path:inset(0 0 100% 0);transform:translateY(-4px)}to{opacity:1;clip-path:inset(0 0 0 0);transform:none}}
.oo-abre{animation:oo-revela .32s cubic-bezier(.22,1,.36,1) backwards}
@keyframes oo-item{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}
.oo-item{animation:oo-item .28s ease-out backwards;animation-delay:calc(min(var(--i,0), 14) * 26ms)}
`;

// ── Dados ─────────────────────────────────────────────────────────────

function usePainel() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: async (): Promise<PainelOrg> => {
      const { data, error } = await sb.rpc("ope_org_painel");
      if (error) throw error;
      return data as PainelOrg;
    },
    staleTime: 30_000,
    retry: false,
  });
}

interface PessoaBuscada { id: number; nome: string; cargo: string | null; contrato: string | null; situacao: string | null }

function useBusca(termo: string) {
  return useQuery({
    queryKey: ["ope-organograma-busca", termo],
    enabled: termo.length >= 2,
    staleTime: 60_000,
    queryFn: async (): Promise<PessoaBuscada[]> => {
      const { data, error } = await sb.rpc("ope_org_buscar", { p_termo: termo, p_limite: 20 });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ── Peças visuais ─────────────────────────────────────────────────────

function Foto({ p, tamanho = 30 }: { p: PessoaOrg; tamanho?: number }) {
  const [erro, setErro] = useState(false);
  if (p.avatar_url && !erro) {
    return <img src={p.avatar_url} alt={p.nome} onError={() => setErro(true)} className="shrink-0 rounded-full object-cover ring-2 ring-white dark:ring-slate-900" style={{ width: tamanho, height: tamanho }} />;
  }
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-bold text-white ring-2 ring-white dark:ring-slate-900"
      style={{ width: tamanho, height: tamanho, background: corDe(p.nome), fontSize: tamanho * 0.36 }}>
      {iniciais(p.nome)}
    </span>
  );
}

const ROTULO: Record<AcaoMenu, { texto: string; icone: LucideIcon; perigo?: boolean }> = {
  definir_gerente: { texto: "Definir gerente operacional…", icone: Crown },
  incluir_supervisor: { texto: "Incluir supervisor…", icone: UserPlus },
  remover_supervisor: { texto: "Remover supervisor", icone: UserMinus, perigo: true },
  mover_contrato_encarregado: { texto: "Mover contrato para outro encarregado…", icone: ArrowRightLeft },
  mover_contrato_supervisor: { texto: "Mover contrato para outro supervisor…", icone: ArrowRightLeft },
  definir_encarregado: { texto: "Definir encarregado…", icone: HardHat },
  trocar_supervisor: { texto: "Trocar supervisor…", icone: UserCog },
  remover_encarregado: { texto: "Remover encarregado", icone: UserMinus, perigo: true },
  remover_supervisor_contrato: { texto: "Tirar o supervisor do contrato", icone: UserMinus, perigo: true },
  trocar_supervisor_encarregado: { texto: "Trocar supervisor…", icone: UserCog },
  tirar_encarregado_de_todos: { texto: "Remover encarregado", icone: UserMinus, perigo: true },
  tornar_encarregado: { texto: "Definir como encarregado deste contrato", icone: HardHat },
  historico_contrato: { texto: "Histórico do contrato", icone: History },
};

const tituloAlvo = (a: AlvoMenu) => (a.tipo === "contrato" ? a.contrato.nome : a.pessoa ? curto(a.pessoa.nome) : "Gerente operacional");

/** Linha com botão direito + ⋮ (o ⋮ é para quem está no celular ou não sabe do botão direito). */
function ComMenu({ alvo, podeAlterar, onAcao, children, className, style }: {
  alvo: AlvoMenu; podeAlterar: boolean; onAcao: (a: AcaoMenu, alvo: AlvoMenu) => void; children: ReactNode; className?: string; style?: CSSProperties;
}) {
  const acoes = acoesDoMenu(alvo, podeAlterar);
  if (!acoes.length) return <div className={className} style={style}>{children}</div>;
  const itens = (Item: typeof ContextMenuItem | typeof DropdownMenuItem) => acoes.map((a, i) => {
    const r = ROTULO[a];
    const sep = r.perigo && i > 0 && !ROTULO[acoes[i - 1]].perigo;
    return (
      <div key={a}>
        {sep && (Item === ContextMenuItem ? <ContextMenuSeparator /> : <DropdownMenuSeparator />)}
        <Item onSelect={() => onAcao(a, alvo)} className={cn("gap-2", r.perigo && "text-destructive focus:text-destructive")}>
          <r.icone className="h-4 w-4" /> {r.texto}
        </Item>
      </div>
    );
  });
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={cn("group/menu relative", className)} style={style}>
          {children}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={`Ações — ${tituloAlvo(alvo)}`}
                className="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-0 transition hover:bg-background hover:text-foreground focus:opacity-100 group-hover/menu:opacity-100">
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="truncate text-xs">{tituloAlvo(alvo)}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {itens(DropdownMenuItem)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-72">
        <ContextMenuLabel className="truncate text-xs">{tituloAlvo(alvo)}</ContextMenuLabel>
        <ContextMenuSeparator />
        {itens(ContextMenuItem)}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function Seta({ aberto, onClick, rotulo }: { aberto: boolean; onClick: () => void; rotulo: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={rotulo} aria-expanded={aberto}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground">
      <ChevronRight className={cn("h-4 w-4 transition-transform duration-300", aberto && "rotate-90")} />
    </button>
  );
}

// ── Contexto da árvore ────────────────────────────────────────────────

interface Ctx {
  pessoas: Map<number, PessoaOrg>;
  podeAlterar: boolean;
  abertos: Set<string>;
  alternar: (k: string) => void;
  termo: string;
  onAcao: (a: AcaoMenu, alvo: AlvoMenu) => void;
}

const casa = (termo: string, ...txt: (string | null | undefined)[]) => !termo || txt.some((t) => t && semAcento(t).includes(termo));

function Colaboradores({ c, nivel, ctx }: { c: ContratoOrg; nivel: number; ctx: Ctx }) {
  const q = useQuery({
    queryKey: ["ope-organograma-colab", c.id],
    staleTime: 60_000,
    queryFn: async (): Promise<(PessoaOrg & { posto: string | null })[]> => {
      const { data, error } = await sb.rpc("ope_org_colaboradores", { p_contrato: c.id });
      if (error) throw error;
      return data ?? [];
    },
  });
  const pad = { paddingLeft: 4 + nivel * 16 + 30 };
  if (q.isLoading) return <li className="flex items-center gap-2 py-1.5 text-xs text-muted-foreground" style={pad}><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando colaboradores…</li>;
  if (q.isError) return <li className="py-1.5 text-xs text-destructive" style={pad}>{(q.error as Error).message}</li>;
  const lista = (q.data ?? []).filter((p) => casa(ctx.termo, p.nome, p.cargo));
  if (!lista.length) return <li className="py-1.5 text-xs text-muted-foreground" style={pad}>{ctx.termo ? "Ninguém com esse nome aqui." : "Nenhum colaborador ativo ligado a este contrato."}</li>;
  return (
    <>
      {lista.map((p, i) => (
        <li key={p.id} className="oo-item" style={{ "--i": i } as CSSProperties}>
          <ComMenu alvo={{ tipo: "colaborador", pessoa: p, contrato: c }} podeAlterar={ctx.podeAlterar && p.id !== c.encarregado_id} onAcao={ctx.onAcao}
            className="flex items-center gap-2 rounded-lg py-1 pr-8 hover:bg-muted/70" style={pad}>
            <Foto p={p} tamanho={24} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] leading-tight">{tituloNome(p.nome)}</span>
              <span className="block truncate text-[10.5px] text-muted-foreground">
                {p.id === c.encarregado_id && <b className="font-semibold text-sky-700 dark:text-sky-300">Encarregado · </b>}
                {p.cargo || "—"}{p.situacao && p.situacao !== "Trabalhando" ? ` · ${p.situacao}` : ""}
              </span>
            </span>
          </ComMenu>
        </li>
      ))}
    </>
  );
}

function LinhaContrato({ c, nivel, i, ctx }: { c: ContratoOrg; nivel: number; i: number; ctx: Ctx }) {
  const k = `c:${c.id}`;
  const aberto = ctx.abertos.has(k);
  const ef = encarregadoEfetivo(c, ctx.pessoas);
  return (
    <li className="oo-item" style={{ "--i": i } as CSSProperties}>
      <ComMenu alvo={{ tipo: "contrato", contrato: c }} podeAlterar={ctx.podeAlterar} onAcao={ctx.onAcao}
        className="flex items-center gap-1.5 rounded-lg py-1.5 pr-8 transition hover:bg-amber-50 dark:hover:bg-amber-950/30" style={{ paddingLeft: 4 + nivel * 16 }}>
        <Seta aberto={aberto} onClick={() => ctx.alternar(k)} rotulo={aberto ? "Recolher contrato" : "Abrir contrato"} />
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-sm">
          <HardHat className="h-4 w-4" />
        </span>
        <button type="button" onClick={() => ctx.alternar(k)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[12.5px] font-semibold leading-tight">{c.nome}</span>
          <span className="block truncate text-[10.5px] text-muted-foreground">
            {plural(c.colaboradores, "pessoa", "pessoas")} em campo
            {c.status !== "ativo" && ` · ${c.status}`}
            {ef.origem === "nenhum" && <> · <b className="font-semibold text-amber-700 dark:text-amber-300">{c.encarregado_id == null ? "sem encarregado" : "encarregado demitido"}</b></>}
          </span>
        </button>
      </ComMenu>
      {aberto && (
        <ul className="oo-abre ml-4 border-l-2 border-amber-300/60 pl-1 dark:border-amber-700/50">
          <Colaboradores c={c} nivel={nivel} ctx={ctx} />
        </ul>
      )}
    </li>
  );
}

function LinhaEncarregado({ r, sup, nivel, i, ctx }: { r: RamoEncarregado; sup: number | null; nivel: number; i: number; ctx: Ctx }) {
  const k = `e:${sup ?? "sem"}:${r.pessoa.id}`;
  const visiveis = r.contratos.filter((c) => casa(ctx.termo, c.nome, r.pessoa.nome));
  const aberto = ctx.abertos.has(k) || (!!ctx.termo && visiveis.length > 0);
  if (ctx.termo && !visiveis.length) return null;
  const demitido = r.pessoa.situacao === "Demitido";
  return (
    <li className="oo-item" style={{ "--i": i } as CSSProperties}>
      <ComMenu alvo={{ tipo: "encarregado", pessoa: r.pessoa, supervisorId: sup }} podeAlterar={ctx.podeAlterar} onAcao={ctx.onAcao}
        className="flex items-center gap-2 rounded-lg py-1.5 pr-8 hover:bg-muted/70" style={{ paddingLeft: 4 + nivel * 16 }}>
        <Seta aberto={aberto} onClick={() => ctx.alternar(k)} rotulo={aberto ? "Recolher" : "Abrir contratos"} />
        <Foto p={r.pessoa} />
        <button type="button" onClick={() => ctx.alternar(k)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13px] font-semibold leading-tight">{tituloNome(r.pessoa.nome)}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            <b className="font-semibold text-sky-700 dark:text-sky-300">Encarregado</b> · {r.pessoa.cargo || "—"}
            {demitido && <b className="ml-1 font-semibold text-destructive">· demitido — defina outro</b>}
          </span>
        </button>
        <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" title="Contratos">
          {r.contratos.length}
        </span>
      </ComMenu>
      {aberto && (
        <ul className="oo-abre">
          {visiveis.map((c, j) => <LinhaContrato key={c.id} c={c} nivel={nivel + 1} i={j} ctx={ctx} />)}
        </ul>
      )}
    </li>
  );
}

function CorpoSupervisor({ r, ctx }: { r: RamoSupervisor; ctx: Ctx }) {
  const sup = r.pessoa?.id ?? null;
  const semEnc = r.semEncarregado.filter((c) => casa(ctx.termo, c.nome));
  if (!r.encarregados.length && !r.semEncarregado.length) {
    return <p className="px-2 py-2 text-xs text-muted-foreground">Nenhum contrato ainda.{ctx.podeAlterar && " Botão direito num contrato → Trocar supervisor."}</p>;
  }
  return (
    <div className="max-h-[460px] overflow-y-auto overscroll-contain">
      <ul>{r.encarregados.map((e, j) => <LinhaEncarregado key={e.pessoa.id} r={e} sup={sup} nivel={0} i={j} ctx={ctx} />)}</ul>
      {semEnc.length > 0 && (
        <div className="mt-2 rounded-xl border border-dashed border-amber-400/70 bg-amber-50/60 p-1.5 dark:bg-amber-950/20">
          <p className="px-1.5 pb-1 pt-0.5 text-[10.5px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
            Contratos sem encarregado definido · {semEnc.length}
          </p>
          <ul>{semEnc.map((c, j) => <LinhaContrato key={c.id} c={c} nivel={0} i={j} ctx={ctx} />)}</ul>
        </div>
      )}
    </div>
  );
}

function CardSupervisor({ r, ctx, d }: { r: RamoSupervisor; ctx: Ctx; d: number }) {
  const sup = r.pessoa;
  const k = `s:${sup?.id ?? "sem"}`;
  const nContratos = r.encarregados.reduce((a, e) => a + e.contratos.length, 0) + r.semEncarregado.length;
  const nPessoas = [...r.encarregados.flatMap((e) => e.contratos), ...r.semEncarregado].reduce((a, c) => a + c.colaboradores, 0);
  const temAchado = !!ctx.termo && (casa(ctx.termo, sup?.nome) || r.encarregados.some((e) => casa(ctx.termo, e.pessoa.nome) || e.contratos.some((c) => casa(ctx.termo, c.nome))) || r.semEncarregado.some((c) => casa(ctx.termo, c.nome)));
  if (ctx.termo && !temAchado) return null;
  const aberto = ctx.abertos.has(k) || temAchado;
  const cor = sup ? "#047857" : "#b45309";
  return (
    <div className="oo-item w-full overflow-hidden rounded-2xl bg-card text-left shadow-[0_6px_18px_-8px_rgba(15,23,42,.22)] ring-1 ring-black/5 dark:ring-white/10" style={{ "--i": d } as CSSProperties}>
      <button type="button" onClick={() => ctx.alternar(k)} aria-expanded={aberto} className="block w-full text-left">
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 text-white" style={{ background: `linear-gradient(120deg, ${cor}, ${cor}d0)` }}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/20">{sup ? <ShieldCheck className="h-[18px] w-[18px]" /> : <HardHat className="h-[18px] w-[18px]" />}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold leading-tight">{sup ? "Supervisão" : "Sem supervisor"}</span>
            <span className="block text-[11px] text-white/80">
              {plural(r.encarregados.length, "encarregado", "encarregados")} · {plural(nContratos, "contrato", "contratos")} · {plural(nPessoas, "pessoa", "pessoas")}
            </span>
          </span>
          <ChevronDown className={cn("h-5 w-5 shrink-0 opacity-80 transition-transform duration-300", aberto && "rotate-180")} />
        </div>
      </button>
      {sup ? (
        <ComMenu alvo={{ tipo: "supervisor", pessoa: sup }} podeAlterar={ctx.podeAlterar} onAcao={ctx.onAcao} className="flex items-center gap-2.5 px-3.5 py-3 pr-9">
          <Foto p={sup} tamanho={42} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold leading-tight">{tituloNome(sup.nome)}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{sup.cargo || "Supervisor"}</span>
          </span>
        </ComMenu>
      ) : (
        <p className="px-3.5 py-3 text-xs text-muted-foreground">Contratos que ainda não têm supervisor. {ctx.podeAlterar && "Botão direito → Trocar supervisor."}</p>
      )}
      {aberto && (
        <div className="oo-abre border-t bg-muted/30 px-1.5 pb-1.5 pt-1">
          <p className="px-2 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Encarregados e contratos</p>
          <CorpoSupervisor r={r} ctx={ctx} />
        </div>
      )}
    </div>
  );
}

// ── Diálogos ──────────────────────────────────────────────────────────

interface Escolha {
  titulo: string;
  descricao: string;
  sugestoes: PessoaOrg[];
  rotuloSugestoes: string;
  confirmar: (id: number, motivo: string) => Promise<unknown>;
}

function DialogEscolherPessoa({ e, onFechar }: { e: Escolha; onFechar: () => void }) {
  const [texto, setTexto] = useState("");
  const [termo, setTermo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [escolhido, setEscolhido] = useState<{ id: number; nome: string; cargo: string | null } | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setTermo(texto.trim()), 300); return () => window.clearTimeout(t); }, [texto]);
  const busca = useBusca(termo);
  const sug = e.sugestoes.filter((p) => !texto.trim() || semAcento(p.nome).includes(semAcento(texto.trim())));
  const ok = async () => {
    if (!escolhido) return;
    setSalvando(true);
    try { await e.confirmar(escolhido.id, motivo); onFechar(); } catch { /* o toast já avisou */ } finally { setSalvando(false); }
  };
  const Opcao = ({ p, j }: { p: { id: number; nome: string; cargo: string | null; contrato?: string | null }; j: number }) => (
    <button type="button" onClick={() => setEscolhido(p)} style={{ "--i": j } as CSSProperties}
      className={cn("oo-item flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition hover:border-primary/40 hover:bg-primary/5",
        escolhido?.id === p.id && "border-primary/60 bg-primary/10")}>
      <Foto p={{ id: p.id, nome: p.nome, cargo: p.cargo, situacao: null }} tamanho={30} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{tituloNome(p.nome)}</span>
        <span className="block truncate text-xs text-muted-foreground">{[p.cargo, p.contrato].filter(Boolean).join(" · ") || "—"}</span>
      </span>
    </button>
  );
  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{e.titulo}</DialogTitle>
          <DialogDescription>{e.descricao}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus className="pl-8" placeholder="Buscar pelo nome no cadastro de colaboradores…" value={texto} onChange={(ev) => setTexto(ev.target.value)} />
        </div>
        <div className="max-h-[45vh] space-y-1 overflow-y-auto">
          {sug.length > 0 && <p className="px-1 pt-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{e.rotuloSugestoes}</p>}
          {sug.map((p, j) => <Opcao key={`s${p.id}`} p={p} j={j} />)}
          {termo.length >= 2 && (
            <>
              <p className="px-1 pt-2 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Cadastro de colaboradores</p>
              {busca.isLoading && <p className="flex items-center gap-2 p-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando…</p>}
              {busca.isError && <p className="p-2 text-xs text-destructive">{(busca.error as Error).message}</p>}
              {(busca.data ?? []).filter((p) => !sug.some((s) => s.id === p.id)).map((p, j) => <Opcao key={`b${p.id}`} p={p} j={j} />)}
              {busca.isSuccess && !busca.data?.length && <p className="p-2 text-xs text-muted-foreground">Ninguém ativo com esse nome.</p>}
            </>
          )}
          {!sug.length && termo.length < 2 && <p className="py-4 text-center text-xs text-muted-foreground">Digite ao menos 2 letras do nome.</p>}
        </div>
        <Textarea rows={2} maxLength={300} placeholder="Motivo (opcional, vai para o histórico)" value={motivo} onChange={(ev) => setMotivo(ev.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button onClick={ok} disabled={!escolhido || salvando}>
            {salvando ? "Salvando…" : escolhido ? `Confirmar ${curto(escolhido.nome)}` : "Escolha alguém"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Confirmacao { titulo: string; texto: string; confirmar: () => Promise<unknown> }

function DialogConfirmar({ c, onFechar }: { c: Confirmacao; onFechar: () => void }) {
  const [salvando, setSalvando] = useState(false);
  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{c.titulo}</DialogTitle>
          <DialogDescription>{c.texto}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button variant="destructive" disabled={salvando}
            onClick={async () => { setSalvando(true); try { await c.confirmar(); onFechar(); } catch { /* toast */ } finally { setSalvando(false); } }}>
            {salvando ? "Salvando…" : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ACAO_HIST: Record<string, string> = {
  encarregado: "Encarregado", supervisor: "Supervisor", gerente: "Gerente operacional",
  supervisor_incluido: "Supervisor incluído", supervisor_removido: "Supervisor removido",
};

function DialogHistorico({ linhas, contrato, onFechar }: { linhas: HistoricoOrg[]; contrato: ContratoOrg | null; onFechar: () => void }) {
  const lista = contrato ? linhas.filter((h) => h.contrato_id === contrato.id) : linhas;
  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Histórico{contrato ? ` — ${contrato.nome}` : ""}</DialogTitle>
          <DialogDescription>Toda mudança no Organograma Operacional, da mais nova para a mais antiga{contrato ? "" : " (últimas 200)"}.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
          {!lista.length && <p className="py-6 text-center text-sm text-muted-foreground">Nada alterado ainda.</p>}
          {lista.map((h) => (
            <div key={h.id} className="rounded-lg border px-3 py-2 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <b>{ACAO_HIST[h.acao] ?? h.acao}</b>
                {h.contrato_nome && !contrato && <span className="text-muted-foreground">· {h.contrato_nome}</span>}
                <span className="ml-auto text-[11px] text-muted-foreground">{new Date(h.created_at).toLocaleString("pt-BR")} · {h.autor_nome ?? "—"}</span>
              </div>
              <p className="text-[12.5px]">
                {h.antes_nome ? tituloNome(h.antes_nome) : <i className="text-muted-foreground">ninguém</i>}
                {" → "}
                {h.depois_nome ? <b>{tituloNome(h.depois_nome)}</b> : <i className="text-muted-foreground">ninguém</i>}
              </p>
              {h.motivo && <p className="text-[11.5px] text-muted-foreground">Motivo: {h.motivo}</p>}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Tela ──────────────────────────────────────────────────────────────

function Conteudo() {
  const qc = useQueryClient();
  const painel = usePainel();
  const [abertos, setAbertos] = useState<Set<string>>(new Set(["g"]));
  const [busca, setBusca] = useState("");
  const [escolha, setEscolha] = useState<Escolha | null>(null);
  const [confirma, setConfirma] = useState<Confirmacao | null>(null);
  const [hist, setHist] = useState<{ contrato: ContratoOrg | null } | null>(null);

  const dados = painel.data;
  const arvore = useMemo(() => (dados ? montarArvore(dados) : null), [dados]);
  const pessoas = useMemo(() => new Map((dados?.pessoas ?? []).map((p) => [p.id, p])), [dados]);
  const supervisores = useMemo(() => arvore?.supervisores.map((s) => s.pessoa!).filter(Boolean) ?? [], [arvore]);
  const encarregados = useMemo(() => {
    const ids = new Set((dados?.contratos ?? []).map((c) => c.encarregado_id).filter((x): x is number => x != null));
    return [...ids].map((id) => pessoas.get(id)).filter((p): p is PessoaOrg => !!p).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [dados, pessoas]);
  const alternar = (k: string) => setAbertos((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; });
  const termo = busca.trim().length >= 2 ? semAcento(busca.trim()) : "";

  const gravar = useMutation({
    mutationFn: async ({ rpc, args }: { rpc: string; args: Record<string, unknown>; ok: string }) => {
      const { error } = await sb.rpc(rpc, args);
      if (error) throw error;
    },
    onSuccess: (_d, v) => { toast.success(v.ok); },
    onError: (e: Error) => toast.error(e.message || "Não deu para salvar."),
    onSettled: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
  const definir = (contratos: ContratoOrg[], campo: "encarregado" | "supervisor", id: number | null, motivo: string, ok: string) =>
    gravar.mutateAsync({ rpc: "ope_org_definir", args: { p_contratos: contratos.map((c) => c.id), p_campo: campo, p_empregado: id, p_motivo: motivo || null }, ok });
  const papel = (id: number, p: "gerente" | "supervisor", ativo: boolean, ok: string) =>
    gravar.mutateAsync({ rpc: "ope_org_papel", args: { p_empregado: id, p_papel: p, p_ativo: ativo }, ok });

  const nomeDe = (id: number) => curto(pessoas.get(id)?.nome ?? `#${id}`);

  const onAcao = (a: AcaoMenu, alvo: AlvoMenu) => {
    const contratos = dados?.contratos ?? [];
    switch (a) {
      case "definir_gerente":
        return setEscolha({
          titulo: "Gerente operacional", descricao: "Quem fica no topo do Organograma Operacional (um só; troca o atual).",
          sugestoes: [], rotuloSugestoes: "",
          confirmar: (id) => papel(id, "gerente", true, "Gerente operacional definido."),
        });
      case "incluir_supervisor":
        return setEscolha({
          titulo: "Incluir supervisor", descricao: "A pessoa passa a aparecer como supervisor, pronta para receber contratos.",
          sugestoes: [], rotuloSugestoes: "",
          confirmar: (id) => papel(id, "supervisor", true, "Supervisor incluído."),
        });
      case "remover_supervisor": {
        if (alvo.tipo !== "supervisor") return;
        const n = contratosDoSupervisor(contratos, alvo.pessoa.id).length;
        return setConfirma({
          titulo: `Remover ${curto(alvo.pessoa.nome)} da supervisão?`,
          texto: n ? `Os ${plural(n, "contrato", "contratos")} dele(a) ficam sem supervisor (os encarregados continuam).` : "Ele(a) não tem contratos.",
          confirmar: () => papel(alvo.pessoa.id, "supervisor", false, "Supervisor removido."),
        });
      }
      case "mover_contrato_encarregado":
      case "definir_encarregado":
      case "tornar_encarregado": {
        if (alvo.tipo !== "contrato" && alvo.tipo !== "colaborador") return;
        const c = alvo.contrato;
        if (alvo.tipo === "colaborador") {
          return setConfirma({
            titulo: `${curto(alvo.pessoa.nome)} como encarregado(a) de ${c.nome}?`,
            texto: c.encarregado_id ? `Substitui ${nomeDe(c.encarregado_id)}. É quem vai conferir o ponto e receber os documentos do RH deste contrato.` : "É quem vai conferir o ponto e receber os documentos do RH deste contrato.",
            confirmar: () => definir([c], "encarregado", alvo.pessoa.id, "", `${c.nome}: encarregado definido.`),
          });
        }
        return setEscolha({
          titulo: a === "mover_contrato_encarregado" ? "Mover contrato para outro encarregado" : "Encarregado do contrato",
          descricao: `${c.nome}${c.encarregado_id ? ` — hoje com ${nomeDe(c.encarregado_id)}` : ""}. Passa a ser quem confere o ponto, recebe os documentos do RH e vê o contrato no Solicitar Treinamento.`,
          sugestoes: encarregados.filter((p) => p.id !== c.encarregado_id), rotuloSugestoes: "Encarregados do organograma",
          confirmar: (id, motivo) => definir([c], "encarregado", id, motivo, `${c.nome}: encarregado agora é ${nomeDe(id)}.`),
        });
      }
      case "mover_contrato_supervisor":
      case "trocar_supervisor": {
        if (alvo.tipo !== "contrato") return;
        const c = alvo.contrato;
        return setEscolha({
          titulo: a === "mover_contrato_supervisor" ? "Mover contrato para outro supervisor" : "Supervisor do contrato",
          descricao: `${c.nome}${c.supervisor_id ? ` — hoje com ${nomeDe(c.supervisor_id)}` : ""}.`,
          sugestoes: supervisores.filter((p) => p.id !== c.supervisor_id), rotuloSugestoes: "Supervisores",
          confirmar: (id, motivo) => definir([c], "supervisor", id, motivo, `${c.nome} agora fica com ${nomeDe(id)}.`),
        });
      }
      case "remover_encarregado": {
        if (alvo.tipo !== "contrato" || alvo.contrato.encarregado_id == null) return;
        const c = alvo.contrato;
        return setConfirma({
          titulo: `Tirar ${nomeDe(c.encarregado_id!)} de ${c.nome}?`,
          texto: "O contrato fica sem encarregado: ninguém confere o ponto nem recebe os documentos do RH dele até alguém ser definido.",
          confirmar: () => definir([c], "encarregado", null, "", `${c.nome}: encarregado removido.`),
        });
      }
      case "remover_supervisor_contrato": {
        if (alvo.tipo !== "contrato") return;
        const c = alvo.contrato;
        return setConfirma({
          titulo: `Tirar o supervisor de ${c.nome}?`, texto: "O contrato vai para a caixa \"Sem supervisor\".",
          confirmar: () => definir([c], "supervisor", null, "", `${c.nome}: sem supervisor.`),
        });
      }
      case "trocar_supervisor_encarregado": {
        if (alvo.tipo !== "encarregado") return;
        const cs = contratosDoEncarregado(contratos, alvo.pessoa.id).filter((c) => c.supervisor_id === alvo.supervisorId);
        return setEscolha({
          titulo: `Supervisor de ${curto(alvo.pessoa.nome)}`,
          descricao: `Muda o supervisor dos ${plural(cs.length, "contrato", "contratos")} dele(a) que estão aqui: ${cs.map((c) => c.nome).join(", ")}.`,
          sugestoes: supervisores.filter((p) => p.id !== alvo.supervisorId), rotuloSugestoes: "Supervisores",
          confirmar: (id, motivo) => definir(cs, "supervisor", id, motivo, `${curto(alvo.pessoa.nome)} agora responde a ${nomeDe(id)}.`),
        });
      }
      case "tirar_encarregado_de_todos": {
        if (alvo.tipo !== "encarregado") return;
        const cs = contratosDoEncarregado(contratos, alvo.pessoa.id);
        return setConfirma({
          titulo: `Remover ${curto(alvo.pessoa.nome)} como encarregado?`,
          texto: `Sai de ${plural(cs.length, "contrato", "contratos")} (${cs.map((c) => c.nome).join(", ")}). Eles ficam sem encarregado (sem conferência de ponto nem documentos do RH) até alguém ser definido.`,
          confirmar: () => definir(cs, "encarregado", null, "", "Encarregado removido."),
        });
      }
      case "historico_contrato":
        if (alvo.tipo === "contrato") setHist({ contrato: alvo.contrato });
        return;
    }
  };

  if (painel.isLoading) return <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Montando o organograma…</div>;
  if (painel.isError || !dados || !arvore) {
    const msg = (painel.error as Error | null)?.message ?? "";
    return (
      <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        {/schema cache|does not exist|não existe|Could not find/i.test(msg)
          ? "A tela fica disponível quando a atualização do banco entrar (sai junto com o merge)."
          : `Não foi possível carregar o organograma. ${msg}`}
      </p>
    );
  }

  const ctx: Ctx = { pessoas, podeAlterar: dados.pode_alterar, abertos, alternar, termo, onAcao };
  const g = arvore.gerente;
  const blocos: RamoSupervisor[] = [...arvore.supervisores, ...(arvore.semSupervisor.encarregados.length || arvore.semSupervisor.semEncarregado.length ? [arvore.semSupervisor] : [])];
  const nPessoas = dados.contratos.reduce((a, c) => a + c.colaboradores, 0);

  return (
    <div className="space-y-4">
      <style>{CSS}</style>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 w-80 max-w-full pl-8 pr-8" placeholder="Buscar supervisor, encarregado ou contrato…" value={busca} onChange={(ev) => setBusca(ev.target.value)} />
          {busca && (
            <button type="button" aria-label="Limpar busca" onClick={() => setBusca("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setHist({ contrato: null })}><History className="mr-1.5 h-3.5 w-3.5" /> Histórico</Button>
        {dados.pode_alterar && (
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onAcao("incluir_supervisor", { tipo: "gerente", pessoa: g })}><UserPlus className="mr-1.5 h-3.5 w-3.5" /> Incluir supervisor</Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {plural(arvore.supervisores.length, "supervisor", "supervisores")} · {plural(arvore.totalContratos, "contrato", "contratos")} · {plural(nPessoas, "pessoa", "pessoas")} em campo
          {arvore.contratosSemEncarregado > 0 && <b className="font-semibold text-amber-700 dark:text-amber-300"> · {arvore.contratosSemEncarregado} sem encarregado definido</b>}
        </span>
      </div>
      {!dados.pode_alterar && <p className="text-xs text-muted-foreground">Você vê o organograma; mudar encarregado e supervisor pede a permissão de alterar nesta tela.</p>}

      <div className="rounded-3xl border bg-[radial-gradient(circle,_hsl(var(--muted))_1px,_transparent_1px)] p-4 [background-size:20px_20px] sm:p-6">
        {/* Topo: o gerente operacional */}
        <div className="mx-auto w-full max-w-sm">
          <ComMenu alvo={{ tipo: "gerente", pessoa: g }} podeAlterar={dados.pode_alterar} onAcao={onAcao}
            className="overflow-hidden rounded-2xl bg-card shadow-[0_10px_28px_-12px_rgba(15,23,42,.4)] ring-1 ring-black/5 dark:ring-white/10">
            <div className="flex items-center gap-2.5 bg-gradient-to-r from-emerald-700 to-emerald-600 px-3.5 py-2.5 text-white">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/20"><HardHat className="h-[18px] w-[18px]" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold leading-tight">Operacional</span>
                <span className="block text-[11px] text-white/80">{plural(arvore.supervisores.length, "supervisor", "supervisores")} · {plural(arvore.totalContratos, "contrato", "contratos")}</span>
              </span>
              <Network className="h-5 w-5 opacity-80" />
            </div>
            <div className="flex items-center gap-2.5 px-3.5 py-3 pr-9">
              {g ? (
                <>
                  <Foto p={g} tamanho={42} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold leading-tight">{tituloNome(g.nome)}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">Gerente operacional · {g.cargo || "—"}</span>
                  </span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Gerente operacional não definido.{dados.pode_alterar && <> <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onAcao("definir_gerente", { tipo: "gerente", pessoa: null })}>Definir</button></>}
                </span>
              )}
            </div>
          </ComMenu>
        </div>
        <div className="mx-auto h-6 w-0.5 bg-slate-300 dark:bg-slate-600" />

        {blocos.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] items-start gap-4">
            {blocos.map((r, i) => <CardSupervisor key={r.pessoa?.id ?? "sem"} r={r} ctx={ctx} d={i} />)}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhum contrato da Licitação em andamento.</p>
        )}
        {termo && blocos.every((r) => r.pessoa && !casa(termo, r.pessoa.nome) && !r.encarregados.some((e) => casa(termo, e.pessoa.nome) || e.contratos.some((c) => casa(termo, c.nome))) && !r.semEncarregado.some((c) => casa(termo, c.nome))) && (
          <p className="pt-6 text-center text-sm text-muted-foreground">Nada com “{busca.trim()}”.</p>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        Botão direito (ou ⋮) em pessoa ou contrato abre as ações. O encarregado definido aqui é quem confere o ponto, recebe os documentos do RH e vê o contrato no Solicitar Treinamento.
      </p>

      {escolha && <DialogEscolherPessoa e={escolha} onFechar={() => setEscolha(null)} />}
      {confirma && <DialogConfirmar c={confirma} onFechar={() => setConfirma(null)} />}
      {hist && <DialogHistorico linhas={dados.historico} contrato={hist.contrato} onFechar={() => setHist(null)} />}
    </div>
  );
}

export default function OrganogramaOperacional() {
  return (
    <div className="space-y-2">
      <PageHeader module="Operacional" breadcrumb={["Organograma", "Operacional"]} title="Organograma Operacional"
        subtitle="Gerente › supervisores › encarregados › contratos › colaboradores. Fonte do encarregado de cada contrato." />
      <AcessoGate menu={MENU} acao="visualizar" fallback={<p className="py-10 text-center text-sm text-muted-foreground">Você não tem acesso a esta tela. Peça em Administração › Acesso por Usuário.</p>}>
        <Conteudo />
      </AcessoGate>
    </div>
  );
}
