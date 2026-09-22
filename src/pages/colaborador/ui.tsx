import type { ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// =====================================================================
// PORTAL DO COLABORADOR — peças de UI compartilhadas entre as telas.
//
// O portal é usado no CELULAR do colaborador de campo, muitas vezes numa
// tela pequena e com internet fraca: tudo aqui é uma coluna só, com texto
// grande e sem tabela larga. Os componentes shadcn continuam valendo
// (Button, Input, Dialog…); estes são só os blocos repetidos.
// =====================================================================

export function Secao({ titulo, descricao, acao, children, className }: {
  titulo?: string; descricao?: string; acao?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card p-4 shadow-sm", className)}>
      {(titulo || acao) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {titulo && <h2 className="font-display text-base font-bold leading-tight">{titulo}</h2>}
            {descricao && <p className="mt-0.5 text-xs text-muted-foreground">{descricao}</p>}
          </div>
          {acao}
        </header>
      )}
      {children}
    </section>
  );
}

/** Par rótulo/valor, empilhado. Some quando o valor é vazio e `sempre` não foi pedido. */
export function Dado({ rotulo, valor, sempre, mono }: { rotulo: string; valor: ReactNode; sempre?: boolean; mono?: boolean }) {
  const vazio = valor == null || valor === "" || valor === "—";
  if (vazio && !sempre) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className={cn("mt-0.5 break-words text-sm font-medium text-foreground", mono && "font-mono")}>{vazio ? "—" : valor}</dd>
    </div>
  );
}

export function GradeDados({ children, colunas = 2 }: { children: ReactNode; colunas?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-4 gap-y-3", colunas === 1 ? "grid-cols-1" : colunas === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
      {children}
    </dl>
  );
}

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {texto}
    </div>
  );
}

export function Erro({ erro, acao }: { erro: unknown; acao?: ReactNode }) {
  const msg = erro instanceof Error ? erro.message : "Não foi possível carregar.";
  return (
    <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        <p>{msg}</p>
        {acao && <div className="mt-2">{acao}</div>}
      </div>
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function Chip({ children, tom = "neutro" }: { children: ReactNode; tom?: "neutro" | "ok" | "alerta" | "erro" | "info" }) {
  const cores = {
    neutro: "bg-muted text-muted-foreground",
    ok: "bg-success/15 text-success",
    alerta: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    erro: "bg-destructive/15 text-destructive",
    info: "bg-primary/10 text-primary",
  }[tom];
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", cores)}>{children}</span>;
}

/** Tom do chip a partir do texto de status que vem do banco. */
export function tomStatus(status: string | null | undefined): "neutro" | "ok" | "alerta" | "erro" | "info" {
  const s = (status ?? "").toLowerCase();
  if (/aprovad|conclu|pago|ativo|aplicad|liberad/.test(s)) return "ok";
  if (/reprov|negad|cancel|arquiv|bloque|devolvid|problema/.test(s)) return "erro";
  if (/pendente|aguard|andamento|análise|analise/.test(s)) return "alerta";
  return "neutro";
}
