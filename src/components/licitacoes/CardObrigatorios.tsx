// Card "Informações obrigatórias" do formulário de contrato.
//
// Até 24/09/2026 os campos do formulário eram marcados com "*" e o
// `handleSalvar` conferia UM: a empresa. Dava para gravar contrato sem
// vigência, sem valor mensal e sem quantidade de funcionários — o asterisco
// não significava nada, e quem descobria era o Financeiro meses depois, com
// o contrato já em execução.
//
// O card lista o que falta usando o MESMO rótulo que o campo tem no
// formulário ("Qtd. Func. Estip.", não "quant_func_estipulado"): quem lê
// precisa saber onde clicar, não qual coluna do banco está nula.

import { CheckCircle2, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ItemObrigatorio } from "@/lib/licitacoes/quadroPostos";

interface Props {
  itens: ItemObrigatorio[];
  /** Erros do quadro de postos — entram no mesmo card, é a mesma conferência. */
  errosQuadro?: string[];
  /** Divergência entre o quadro e a quantidade estipulada. Avisa, não impede. */
  avisoQuadro?: string | null;
}

export function CardObrigatorios({ itens, errosQuadro = [], avisoQuadro = null }: Props) {
  const pendentes = itens.filter(i => !i.ok);
  const tudoOk = pendentes.length === 0 && errosQuadro.length === 0;

  // Agrupa por seção na ordem em que elas aparecem no formulário — a lista
  // vira um roteiro de onde ir, de cima para baixo.
  const porSecao = pendentes.reduce<Record<string, string[]>>((acc, i) => {
    (acc[i.secao] ??= []).push(i.campo);
    return acc;
  }, {});

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 text-xs",
        tudoOk
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-amber-200 bg-amber-50 text-amber-900",
      )}
    >
      <div className="flex items-center gap-1.5 font-semibold">
        {tudoOk
          ? <><CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> Informações obrigatórias completas</>
          : <><CircleAlert className="h-4 w-4 shrink-0" aria-hidden /> Faltam informações obrigatórias</>}
      </div>

      {tudoOk ? (
        <p className="mt-1 font-medium">
          O contrato pode ser salvo. Os postos marcados para abrir vaga viram solicitações
          no Recrutamento, com salário, benefícios, escala e local já preenchidos.
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {Object.entries(porSecao).map(([secao, campos]) => (
            <li key={secao}>
              <span className="font-semibold">{secao}:</span>{" "}
              <span className="font-medium">{campos.join(", ")}</span>
            </li>
          ))}
          {errosQuadro.map((e, i) => (
            <li key={`q${i}`}>
              <span className="font-semibold">Quadro de Postos:</span>{" "}
              <span className="font-medium">{e}</span>
            </li>
          ))}
        </ul>
      )}

      {/* O aviso de divergência é separado de propósito: ele NÃO impede de
          salvar (implantação faseada é normal), então não pode aparecer
          misturado na lista do que bloqueia. */}
      {avisoQuadro && (
        <p className="mt-2 rounded border border-sky-200 bg-sky-50 px-2 py-1.5 font-medium text-sky-900">
          {avisoQuadro} Isso não impede de salvar — confira se a implantação é em fases.
        </p>
      )}
    </div>
  );
}
