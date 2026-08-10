import { Send, CheckCircle2, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Trilha de um lote de aprovação de catálogo: quem enviou, quem decidiu,
 * com nome e data/hora.
 *
 * Mesmo desenho da timeline dos cards de Cotações
 * (src/pages/suprimentos/CotacoesCompras.tsx): linha vertical com bolinhas,
 * uma entrada por evento. As duas telas respondem à mesma pergunta — "quem
 * mexeu nisto e quando" — e ler igual nos dois lugares é o que faz a
 * auditoria ser rápida.
 *
 * Os dados já vêm gravados por `sup_cat_enviar_lote` e `sup_cat_decidir_lote`,
 * que resolvem o nome em `profiles` no servidor: ninguém carimba com nome
 * alheio.
 */

export interface LoteHistorico {
  status: string;
  criado_por_nome: string | null;
  data_envio: string;
  decidido_por_nome: string | null;
  data_resposta: string | null;
  comentario: string | null;
}

/** Data local com hora, sem passar por UTC — evita o clássico "andou um dia". */
export function fmtDataHora(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function HistoricoLote({ lote }: { lote: LoteHistorico }) {
  const reprovado = lote.status === "REPROVADO";
  const decidido = !!lote.data_resposta;

  return (
    <div className="mt-4 border-t pt-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Histórico
      </p>

      <div className="relative space-y-3 pl-5">
        <div className="absolute bottom-2 left-1.5 top-2 w-px bg-border" />

        {/* Envio */}
        <Evento
          cor="bg-muted-foreground/50"
          icone={Send}
          titulo="Enviado para aprovação"
          quem={lote.criado_por_nome}
          quando={lote.data_envio}
        />

        {/* Decisão */}
        {decidido ? (
          <Evento
            cor={reprovado ? "bg-red-500" : "bg-emerald-500"}
            icone={reprovado ? XCircle : CheckCircle2}
            titulo={reprovado ? "Reprovado" : "Aprovado"}
            quem={lote.decidido_por_nome}
            quando={lote.data_resposta}
            destaque={reprovado ? "text-red-600" : "text-emerald-600"}
            comentario={lote.comentario}
          />
        ) : (
          <div className="relative">
            <div className="absolute -left-[13px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-amber-400" />
            <p className="flex items-center gap-1 text-xs italic text-muted-foreground">
              <Clock className="h-3 w-3" /> Aguardando decisão…
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Evento({
  cor, icone: Icone, titulo, quem, quando, destaque, comentario,
}: {
  cor: string;
  icone: React.ElementType;
  titulo: string;
  quem: string | null;
  quando: string | null;
  destaque?: string;
  comentario?: string | null;
}) {
  return (
    <div className="relative">
      <div className={cn("absolute -left-[13px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background", cor)} />
      <p className={cn("flex items-center gap-1.5 text-xs font-medium", destaque)}>
        <Icone className="h-3.5 w-3.5" /> {titulo}
      </p>
      <p className="text-xs text-muted-foreground">
        {/* Nome da PESSOA, nunca do setor — é assim que se enxerga quem agiu. */}
        {quem ?? "Usuário sem nome"} · {fmtDataHora(quando)}
      </p>
      {comentario && (
        <p className="mt-1 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs italic text-muted-foreground">
          "{comentario}"
        </p>
      )}
    </div>
  );
}

/** Autoria de uma alteração isolada — o catálogo é editado por várias mãos. */
export function AutorAlteracao({ nome, quando }: { nome: string | null; quando: string }) {
  return (
    <p className="text-[11px] text-muted-foreground">
      por <span className="font-medium">{nome ?? "Usuário sem nome"}</span> · {fmtDataHora(quando)}
    </p>
  );
}
