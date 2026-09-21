import { Link } from "react-router-dom";
import { Move3d } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { parseEndereco } from "@/lib/suprimentos/enderecoEstoque";

/**
 * O botãozinho "ver a localização em 3D" (SIS-2026-0442).
 *
 * Do pedido: "assim que der entrada de um item e dizer a localização já ter
 * opção bem pequena em formato de botão de ver a localização 3d do item nas
 * baias". Por isso ele é um ícone, não um botão com texto: fica colado no
 * endereço, sem competir com o que já está na linha.
 *
 * Só aparece quando há endereço LEGÍVEL — mandar a pessoa para o mapa 3D para
 * ela descobrir lá que o endereço é "TESTE" seria pior que não ter botão. E
 * some inteiro para quem não tem acesso ao mapa.
 */
export function BotaoVer3D({
  itemEstoqueId,
  localizacao,
  className,
}: {
  itemEstoqueId: string;
  localizacao: string | null | undefined;
  className?: string;
}) {
  if (!parseEndereco(localizacao)) return null;

  return (
    <AcessoGate menu="sup_estoque_mapa" acao="visualizar">
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={`/app/suprimentos/estoque-mapa?item=${itemEstoqueId}`}
            onClick={(e) => e.stopPropagation()}
            aria-label="Ver a localização em 3D"
            className={
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded " +
              "text-muted-foreground transition hover:bg-accent hover:text-amber-600 " +
              (className ?? "")
            }
          >
            <Move3d className="h-3.5 w-3.5" />
          </Link>
        </TooltipTrigger>
        <TooltipContent>Ver a baia em 3D</TooltipContent>
      </Tooltip>
    </AcessoGate>
  );
}
