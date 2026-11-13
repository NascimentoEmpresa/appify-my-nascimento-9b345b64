// Peças visuais do painel da Implantação por setor (resumo geral e página do
// setor). Tudo aqui só desenha: os números vêm de
// src/lib/implantacao/painelSetores.ts.
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, CircleDashed, Clock,
  ClipboardCheck, Cog, Flag, Pencil, Trophy, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { MENU_EDITAR_CHECKLIST, ACAO_EDITAR_CHECKLIST } from "@/lib/implantacao/permissaoChecklist";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { ImplantacaoContrato } from "@/hooks/useImplantacao";
import {
  ROTULO_STATUS, type PainelImplantacao, type ResumoSetor, type StatusSetor,
} from "@/lib/implantacao/painelSetores";
import { rotaFormulario, rotaSetor } from "./rotasPainel";

// ── Selo de status ─────────────────────────────────────────────────────────

type StatusVisual = StatusSetor | "nao_iniciado";

const ESTILO_STATUS: Record<StatusVisual, { classe: string; Icone: LucideIcon; rotulo: string }> = {
  concluido: { classe: "bg-emerald-600 text-white", Icone: CheckCircle2, rotulo: ROTULO_STATUS.concluido },
  em_andamento: { classe: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300", Icone: Clock, rotulo: ROTULO_STATUS.em_andamento },
  pendente: { classe: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300", Icone: AlertTriangle, rotulo: ROTULO_STATUS.pendente },
  nao_iniciado: { classe: "bg-muted text-muted-foreground", Icone: CircleDashed, rotulo: "Não iniciado" },
};

export function SeloStatus({ status, className }: { status: StatusVisual; className?: string }) {
  const { classe, Icone, rotulo } = ESTILO_STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold", classe, className)}>
      <Icone className="h-3 w-3" /> {rotulo}
    </span>
  );
}

const BORDA_STATUS: Record<StatusVisual, string> = {
  concluido: "border-emerald-300 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-500/10",
  em_andamento: "border-blue-300 bg-blue-50/60 dark:border-blue-500/40 dark:bg-blue-500/10",
  pendente: "border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/10",
  nao_iniciado: "border-border bg-card",
};

// ── Cartão de indicador ──────────────────────────────────────────────────

export function CartaoKpi({
  icone: Icone, rotulo, valor, detalhe, tom = "azul",
}: {
  icone: LucideIcon; rotulo: string; valor: string; detalhe?: string;
  tom?: "azul" | "verde" | "ambar" | "roxo";
}) {
  const cores = {
    azul: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
    verde: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
    ambar: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
    roxo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300",
  }[tom];
  return (
    <div className="card-elevated flex items-center gap-4 p-4">
      <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", cores)}>
        <Icone className="h-6 w-6" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{rotulo}</p>
        <p
          className={cn(
            "line-clamp-2 break-words font-display font-bold leading-tight text-foreground",
            valor.length > 14 ? "text-base sm:text-lg" : "text-xl sm:text-2xl",
          )}
          title={valor}
        >
          {valor}
        </p>
        {detalhe && <p className="truncate text-[11px] text-muted-foreground">{detalhe}</p>}
      </div>
    </div>
  );
}

// ── Seletor de contrato ──────────────────────────────────────────────────

function dataBR(iso: string | null) {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function BarraContrato({
  contratos, contrato, onTrocar, acoes,
}: {
  contratos: ImplantacaoContrato[];
  contrato: ImplantacaoContrato | null;
  onTrocar: (id: string) => void;
  acoes?: React.ReactNode;
}) {
  return (
    <div className="card-elevated flex flex-wrap items-center gap-3 p-3">
      <Select value={contrato?.id ?? ""} onValueChange={onTrocar}>
        <SelectTrigger className="h-9 min-w-[240px] max-w-sm">
          <SelectValue placeholder="Selecione o contrato" />
        </SelectTrigger>
        <SelectContent>
          {contratos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
        </SelectContent>
      </Select>
      {contrato && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>Início: <b className="font-medium text-foreground">{dataBR(contrato.data_inicio)}</b></span>
          <span className="hidden sm:inline">|</span>
          <span>Abertura: <b className="font-medium text-foreground">{contrato.abertura ?? "—"}</b></span>
          <span className="hidden sm:inline">|</span>
          <span>Homologação: <b className="font-medium text-foreground">{contrato.data_homologacao ?? "—"}</b></span>
        </div>
      )}
      {acoes && <div className="ml-auto flex flex-wrap gap-2">{acoes}</div>}
    </div>
  );
}

// ── Barra de progresso ───────────────────────────────────────────────────

export function BarraProgresso({ titulo, detalhe, pct }: { titulo: string; detalhe: string; pct: number }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-muted/30 px-4 py-3">
      <div className="min-w-[180px]">
        <p className="text-sm font-semibold">{titulo}</p>
        <p className="text-[11px] text-muted-foreground">{detalhe}</p>
      </div>
      <div className="h-2.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-bold tabular-nums">{pct}%</span>
    </div>
  );
}

// ── Fluxo de implantação ─────────────────────────────────────────────────

function Etapa({ icone: Icone, titulo, status }: { icone: LucideIcon; titulo: string; status: StatusVisual }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border p-3 xl:min-w-[130px] xl:flex-1", BORDA_STATUS[status])}>
      <div className="flex items-center gap-2">
        <Icone className="h-5 w-5 shrink-0 text-foreground/70" />
        <span className="text-sm font-semibold leading-tight">{titulo}</span>
      </div>
      <SeloStatus status={status} className="self-start" />
    </div>
  );
}

function Seta() {
  return <ArrowRight className="hidden h-5 w-5 shrink-0 self-center text-muted-foreground xl:block" />;
}

export function FluxoImplantacao({ painel, contratoId }: { painel: PainelImplantacao; contratoId: string | null }) {
  const algum = painel.acionados > 0;
  const todosConfirmados = painel.totalSetores > 0 && painel.confirmados === painel.totalSetores;
  const etapaConfirmacao: StatusVisual = todosConfirmados
    ? "concluido"
    : painel.confirmados > 0 || painel.setores.some((s) => s.prontoParaConfirmar)
      ? "em_andamento"
      : algum ? "pendente" : "nao_iniciado";

  return (
    <div className="card-elevated space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold">Fluxo de Implantação</h2>
          <p className="text-xs text-muted-foreground">Acompanhe o fluxo do processo e o status de cada etapa e setor envolvido.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["concluido", "em_andamento", "pendente", "nao_iniciado"] as const).map((s) => <SeloStatus key={s} status={s} />)}
        </div>
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-stretch">
        {/* O contrato existir na Implantação já é a licitação ganha + o processo aberto. */}
        <Etapa icone={Trophy} titulo="Licitação vence o contrato" status="concluido" />
        <Seta />
        <Etapa icone={Cog} titulo="ERP abre processo de implantação" status="concluido" />
        <Seta />
        <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[340px] xl:flex-[3]">
          {painel.setores.map((s) => (
            <Link
              key={s.setor}
              to={rotaSetor(s.slug, contratoId)}
              className={cn("flex items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-shadow hover:shadow-sm", BORDA_STATUS[s.status])}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{s.setor}</p>
                <SeloStatus status={s.status} />
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
        <Seta />
        <Etapa icone={ClipboardCheck} titulo="Confirmação de recebimento por setor" status={etapaConfirmacao} />
        <Seta />
        <Etapa icone={Flag} titulo="Implantação preparada" status={todosConfirmados ? "concluido" : "nao_iniciado"} />
      </div>
    </div>
  );
}

// ── Cartão "Detalhes por setor" ──────────────────────────────────────────

export function LinhaCampo({ pergunta, valor, respondido, comum }: { pergunta: string; valor: string; respondido: boolean; comum?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-1.5 text-xs">
      <span className="min-w-0 flex-1 text-foreground/90">
        {pergunta}
        {comum && <span className="ml-1 rounded bg-muted px-1 text-[9px] font-semibold uppercase text-muted-foreground">comum</span>}
      </span>
      <span className={cn("max-w-[45%] truncate text-right", respondido ? "text-foreground" : "font-medium text-amber-600")} title={valor}>
        {respondido ? valor : "Não preenchido"}
      </span>
      {respondido
        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />}
    </div>
  );
}

export function CartaoSetor({ resumo, contratoId, limite = 7 }: { resumo: ResumoSetor; contratoId: string | null; limite?: number }) {
  // Pendentes primeiro: é o que o setor precisa ver batendo o olho.
  const linhas = [...resumo.linhas].sort((a, b) => Number(a.respondido) - Number(b.respondido)).slice(0, limite);
  const resto = resumo.linhas.length - linhas.length;
  return (
    <div className="card-elevated flex flex-col p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="truncate font-display text-sm font-bold">{resumo.setor}</h3>
        <SeloStatus status={resumo.status} />
      </div>
      <p className="mb-1 text-[11px] text-muted-foreground">
        {resumo.respondidos}/{resumo.total} respondidos
        {resumo.confirmacaoDesatualizada && <span className="ml-1 font-semibold text-amber-600">· resposta alterada após a confirmação</span>}
      </p>
      <div className="flex-1 divide-y divide-border/60">
        {linhas.map((l) => <LinhaCampo key={l.row_index} {...l} />)}
        {resumo.linhas.length === 0 && <p className="py-3 text-xs text-muted-foreground">Nenhuma pergunta para este setor.</p>}
      </div>
      {resto > 0 && <p className="pt-1 text-[11px] text-muted-foreground">+ {resto} campo{resto > 1 ? "s" : ""} na página do setor</p>}
      {resumo.pendentes > 0 && resumo.status !== "concluido" && (
        <p className="mt-2 rounded-md bg-blue-50 px-2.5 py-1.5 text-[11px] text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
          Preencha os {resumo.pendentes} campo{resumo.pendentes > 1 ? "s" : ""} pendente{resumo.pendentes > 1 ? "s" : ""} para habilitar a confirmação do setor.
        </p>
      )}
      <div className="mt-3 flex flex-wrap justify-between gap-2">
        <Button asChild size="sm" variant="outline" className="h-8 text-xs">
          <Link to={rotaSetor(resumo.slug, contratoId)}>Abrir setor <ChevronRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
        <AcessoGate menu={MENU_EDITAR_CHECKLIST} acao={ACAO_EDITAR_CHECKLIST}>
          <Button asChild size="sm" className="h-8 text-xs">
            <Link to={rotaFormulario(contratoId, resumo.setor)}><Pencil className="mr-1 h-3.5 w-3.5" /> Preencher / Atualizar</Link>
          </Button>
        </AcessoGate>
      </div>
    </div>
  );
}

export function Vazio({ titulo, mensagem, tom = "muted" }: { titulo: string; mensagem?: string; tom?: "muted" | "error" }) {
  return (
    <div className={cn(
      "rounded-lg border px-4 py-12 text-center text-sm",
      tom === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border bg-muted/30 text-muted-foreground",
    )}>
      <p className="text-base font-semibold">{titulo}</p>
      {mensagem && <p className="mt-1 text-xs">{mensagem}</p>}
    </div>
  );
}
