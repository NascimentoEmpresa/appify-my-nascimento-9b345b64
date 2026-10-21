import {
  BarChart3, Building2, Cog, DollarSign, GraduationCap, Landmark, Monitor, Package, Scale, ShieldCheck, ShoppingCart, Users, Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { iniciais, type TipoConexao } from "@/lib/organograma/estruturaProcessos";

// =====================================================================
// Organograma › Estrutura de Setores e Processos — peças visuais comuns
// às duas telas (mig 20261020000060): a paleta de cada setor, o ícone,
// o avatar e o traço de cada tipo de conexão (a legenda das telas).
// =====================================================================

export interface CorSetor { hex: string; fundo: string; borda: string; texto: string; suave: string; pill: string }

export const CORES: Record<string, CorSetor> = {
  green:  { hex: "#16a34a", fundo: "bg-green-50/70",   borda: "border-green-300",  texto: "text-green-700",  suave: "bg-green-100",  pill: "bg-green-100 text-green-700" },
  purple: { hex: "#9333ea", fundo: "bg-purple-50/70",  borda: "border-purple-300", texto: "text-purple-700", suave: "bg-purple-100", pill: "bg-purple-100 text-purple-700" },
  blue:   { hex: "#2563eb", fundo: "bg-blue-50/70",    borda: "border-blue-300",   texto: "text-blue-700",   suave: "bg-blue-100",   pill: "bg-blue-100 text-blue-700" },
  red:    { hex: "#dc2626", fundo: "bg-red-50/70",     borda: "border-red-300",    texto: "text-red-700",    suave: "bg-red-100",    pill: "bg-red-100 text-red-700" },
  violet: { hex: "#7c3aed", fundo: "bg-violet-50/70",  borda: "border-violet-300", texto: "text-violet-700", suave: "bg-violet-100", pill: "bg-violet-100 text-violet-700" },
  amber:  { hex: "#d97706", fundo: "bg-amber-50/70",   borda: "border-amber-300",  texto: "text-amber-700",  suave: "bg-amber-100",  pill: "bg-amber-100 text-amber-700" },
  teal:   { hex: "#0d9488", fundo: "bg-teal-50/70",    borda: "border-teal-300",   texto: "text-teal-700",   suave: "bg-teal-100",   pill: "bg-teal-100 text-teal-700" },
  rose:   { hex: "#e11d48", fundo: "bg-rose-50/70",    borda: "border-rose-300",   texto: "text-rose-700",   suave: "bg-rose-100",   pill: "bg-rose-100 text-rose-700" },
  sky:    { hex: "#0284c7", fundo: "bg-sky-50/70",     borda: "border-sky-300",    texto: "text-sky-700",    suave: "bg-sky-100",    pill: "bg-sky-100 text-sky-700" },
  orange: { hex: "#ea580c", fundo: "bg-orange-50/70",  borda: "border-orange-300", texto: "text-orange-700", suave: "bg-orange-100", pill: "bg-orange-100 text-orange-700" },
  pink:   { hex: "#db2777", fundo: "bg-pink-50/70",    borda: "border-pink-300",   texto: "text-pink-700",   suave: "bg-pink-100",   pill: "bg-pink-100 text-pink-700" },
  slate:  { hex: "#475569", fundo: "bg-slate-50",      borda: "border-slate-300",  texto: "text-slate-700",  suave: "bg-slate-100",  pill: "bg-slate-100 text-slate-700" },
};
export const cor = (c: string | null | undefined): CorSetor => CORES[c ?? ""] ?? CORES.blue;
export const OPCOES_COR = Object.keys(CORES);

export const ICONES: Record<string, LucideIcon> = {
  chart: BarChart3, money: DollarSign, users: Users, monitor: Monitor, scale: Scale, building: Building2,
  graduation: GraduationCap, cart: ShoppingCart, gear: Cog, shield: ShieldCheck, package: Package, tools: Wrench, bank: Landmark,
};
export const OPCOES_ICONE = Object.keys(ICONES);

export function IconeSetor({ icone, corSetor, tamanho = "md", className }: { icone: string; corSetor: string; tamanho?: "sm" | "md" | "lg"; className?: string }) {
  const I = ICONES[icone] ?? Building2;
  const c = cor(corSetor);
  const t = tamanho === "sm" ? "h-6 w-6" : tamanho === "lg" ? "h-11 w-11" : "h-8 w-8";
  const ti = tamanho === "sm" ? "h-3.5 w-3.5" : tamanho === "lg" ? "h-5 w-5" : "h-4 w-4";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full text-white", t, className)} style={{ background: c.hex }}>
      <I className={ti} />
    </span>
  );
}

export function Avatar({ nome, foto, tamanho = 28, className }: { nome: string | null | undefined; foto?: string | null; tamanho?: number; className?: string }) {
  const s = { width: tamanho, height: tamanho };
  if (foto) return <img src={foto} alt={nome ?? ""} style={s} className={cn("shrink-0 rounded-full object-cover ring-2 ring-white", className)} />;
  return (
    <span style={{ ...s, fontSize: Math.max(9, tamanho * 0.36) }}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-slate-200 font-semibold text-slate-600 ring-2 ring-white", className)}>
      {iniciais(nome)}
    </span>
  );
}

/** O selo do canto das telas de referência. */
export function StatusDesenvolvimento() {
  return (
    <div className="inline-flex items-center gap-2 rounded-xl border bg-card px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground shadow-sm">
      <Wrench className="h-3.5 w-3.5" /> Status de desenvolvimento
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] normal-case text-amber-700">
        <i className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" /> Em homologação
      </span>
    </div>
  );
}

export const TRACO: Record<TipoConexao, { cor: string; dash: string | undefined }> = {
  fluxo:         { cor: "#2563eb", dash: undefined },
  intersetorial: { cor: "#3b82f6", dash: "6 4" },
  retorno:       { cor: "#f97316", dash: "6 4" },
  bloqueado:     { cor: "#ef4444", dash: "6 4" },
  revisao:       { cor: "#eab308", dash: "6 4" },
};

/** A amostra do traço (legenda). */
export function AmostraTraco({ tipo, largura = 34 }: { tipo: TipoConexao; largura?: number }) {
  const t = TRACO[tipo];
  return (
    <svg width={largura} height="8" className="shrink-0">
      <line x1="1" y1="4" x2={largura - 1} y2="4" stroke={t.cor} strokeWidth="2.5" strokeDasharray={t.dash} strokeLinecap="round" />
    </svg>
  );
}

/** Marcadores de seta, um por cor (definir uma vez dentro do <svg>). */
export function DefsSetas({ prefixo }: { prefixo: string }) {
  const cores = Array.from(new Set([...Object.values(TRACO).map((t) => t.cor), ...Object.values(CORES).map((c) => c.hex), "#334155", "#94a3b8"]));
  return (
    <defs>
      {cores.map((c) => (
        <marker key={c} id={`${prefixo}${c.slice(1)}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={c} />
        </marker>
      ))}
    </defs>
  );
}
export const seta = (prefixo: string, corHex: string) => `url(#${prefixo}${corHex.slice(1)})`;
