// Valor do Comparativo individual com o detalhe ao passar o mouse (12/11/2026):
// cada chamado que compõe o total, o valor de cada um, de onde veio (gestor /
// I.A) e a observação. Clicar no chamado abre o chamado numa aba nova — a
// bonificação continua aberta onde estava.
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { EntregaBonificacao } from "@/lib/sistemas/bonificacaoColetiva";
import { ROTULO_ORIGEM, detalheValores, type CampoValor } from "@/lib/sistemas/bonificacaoDetalhe";
import { hrefNaLista } from "@/lib/chamados/navegacaoLista";
import { moeda } from "./comum";

const COR_ORIGEM = { gestor: "text-success", ia: "text-info", "sem valor": "text-muted-foreground" } as const;

export function ValorDetalhado({ entregas, campo, titulo, valor, media = false, className }: {
  entregas: EntregaBonificacao[];
  campo: CampoValor;
  /** Ex.: "Mercado IA — Pablo, Novembro/2026". */
  titulo: string;
  /** O número da célula (o total, ou a média quando `media`). */
  valor: number | null;
  media?: boolean;
  className?: string;
}) {
  const linhas = detalheValores(entregas, campo);
  if (!linhas.length) return <span className={className}>{valor === null ? "—" : moeda(valor)}</span>;
  const total = linhas.reduce((a, l) => a + l.valor, 0);
  // A ordem do detalhe vai junto: no chamado, as setas andam por esta lista.
  const ids = linhas.map((l) => l.chamadoId);
  return (
    <HoverCard openDelay={150} closeDelay={150}>
      <HoverCardTrigger asChild>
        <button type="button" className={`cursor-help whitespace-nowrap underline decoration-dotted underline-offset-4 ${className ?? ""}`}>
          {valor === null ? "—" : moeda(valor)}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-[440px] max-w-[92vw] p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">{titulo}</p>
          <p className="text-xs text-muted-foreground">
            {media
              ? <>Média = {moeda(total)} ÷ {linhas.length} entrega(s) = <b className="text-foreground">{moeda(total / linhas.length)}</b></>
              : <>{linhas.length} entrega(s) concluída(s) no mês · total <b className="text-foreground">{moeda(total)}</b></>}
          </p>
        </div>
        <ul className="max-h-80 divide-y overflow-y-auto">
          {linhas.map((l) => (
            <li key={l.chamadoId}>
              <Link
                to={hrefNaLista(l.chamadoId, ids)}
                target="_blank"
                rel="noopener"
                className="group block px-4 py-2 hover:bg-muted/60"
                title="Abrir o chamado numa aba nova"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium group-hover:underline">
                      {l.numero} · {l.assunto}
                    </span>
                    <span className={`text-[11px] ${COR_ORIGEM[l.origem]}`}>{ROTULO_ORIGEM[l.origem]}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums">
                    {moeda(l.valor)}
                    <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
                  </span>
                </span>
                {l.observacao && <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted-foreground">{l.observacao}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}
