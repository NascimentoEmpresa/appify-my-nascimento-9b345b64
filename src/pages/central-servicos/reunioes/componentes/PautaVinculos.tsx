import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRightLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReuniaoDecisaoAcao, ReuniaoPauta, ReuniaoTransferenciaRef } from "../types";

// Classes literais (não interpoladas) pro Tailwind não descartar no build.
const LINE_CLAMP: Record<number, string> = { 2: "line-clamp-2", 3: "line-clamp-3", 4: "line-clamp-4" };

/** Heurística barata de "passa de N linhas" (tamanho + quebras), sem medir o DOM. */
function textoLongo(texto: string, linhas: number): boolean {
  return texto.length > linhas * 60 || texto.split("\n").length > linhas;
}

/**
 * Texto de pauta resumido em N linhas (SIS-2026-0373: textos grandes ocupavam
 * a tabela inteira). Com onVerMais, "ver mais" abre o detalhe do item em vez
 * de expandir no lugar.
 */
export function TextoResumido({
  texto, linhas = 2, className, onVerMais,
}: {
  texto: string;
  linhas?: 2 | 3 | 4;
  className?: string;
  onVerMais?: () => void;
}) {
  const [expandido, setExpandido] = useState(false);
  const longo = textoLongo(texto, linhas);

  return (
    <div className="min-w-0">
      <p className={cn("whitespace-pre-line break-words", longo && !expandido && LINE_CLAMP[linhas], className)}>{texto}</p>
      {longo && (
        <button
          type="button"
          className="text-[11px] font-medium text-primary hover:underline"
          onClick={() => (onVerMais ? onVerMais() : setExpandido((e) => !e))}
        >
          {onVerMais || !expandido ? "ver mais" : "ver menos"}
        </button>
      )}
    </div>
  );
}

/** Decisões e ações geradas pelo item, numeradas — ação vinculada ao Plano de Ações vira link pra ela. */
export function AcoesVinculadasPauta({ itens, className }: { itens: ReuniaoDecisaoAcao[]; className?: string }) {
  if (itens.length === 0) return null;

  return (
    <ol className={cn("space-y-1 border-l-2 border-border pl-2", className)}>
      {itens.map((d, i) => {
        const rotulo = `${d.tipo === "decisao" ? "Decisão" : "Ação"}: ${d.texto}`;
        return (
          <li key={d.id} className="flex items-start gap-1.5 text-xs">
            <span className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
              {i + 1}
            </span>
            {d.tipo === "acao" && d.plano_acao_id ? (
              <Link
                to={`/app/plano-acoes/${d.plano_acao_id}`}
                title="Abrir a ação no Plano de Ações"
                className="flex min-w-0 flex-1 items-start gap-0.5 text-primary hover:underline"
              >
                <span className="line-clamp-2 min-w-0">{rotulo}</span>
                <ChevronRight className="mt-px h-3.5 w-3.5 shrink-0" />
              </Link>
            ) : (
              <span className="line-clamp-2 min-w-0 text-muted-foreground">{rotulo}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function SeloReuniao({ rotulo, alvo }: { rotulo: string; alvo: ReuniaoTransferenciaRef | undefined }) {
  const classe = "inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-[10px] text-violet-800";
  if (!alvo) return <span className={classe}><ArrowRightLeft className="h-3 w-3" />{rotulo}</span>;
  const quando = new Date(alvo.data_hora).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  return (
    <Link to={`/app/central-servicos/reunioes/${alvo.reuniao_id}`} title={`${alvo.titulo} — ${quando}`} className={cn(classe, "hover:underline")}>
      <ArrowRightLeft className="h-3 w-3" />{rotulo}
    </Link>
  );
}

/** Rastro de transferência (SIS-2026-0373): "Transferida para REU-…" na origem, "Veio da REU-…" no destino. */
export function SeloTransferencia({ item, reunioes }: { item: ReuniaoPauta; reunioes: Record<string, ReuniaoTransferenciaRef> }) {
  const para = item.transferida_para_pauta_id ? reunioes[item.transferida_para_pauta_id] : undefined;
  const de = item.transferida_de_pauta_id ? reunioes[item.transferida_de_pauta_id] : undefined;

  return (
    <>
      {item.transferida_para_pauta_id && (
        <SeloReuniao rotulo={para ? `Transferida para ${para.numero}` : "Transferida para outra reunião"} alvo={para} />
      )}
      {item.transferida_de_pauta_id && (
        <SeloReuniao rotulo={de ? `Veio da ${de.numero}` : "Veio de outra reunião"} alvo={de} />
      )}
    </>
  );
}
