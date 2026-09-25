// Card "Ainda falta preencher" — a coluna fixa à esquerda do formulário de
// contrato.
//
// Até 24/09/2026 os campos do formulário eram marcados com "*" e o
// `handleSalvar` conferia UM: a empresa. Dava para gravar contrato sem
// vigência, sem valor mensal e sem quantidade de funcionários — o asterisco
// não significava nada, e quem descobria era o Financeiro meses depois, com
// o contrato já em execução.
//
// POR QUE ELE É FIXO (sticky) E NÃO FICA SÓ NO TOPO. A primeira versão ficava
// no topo do modal, e o modal é longo: sete seções mais os Dados Fiscais. Ao
// chegar no botão "Salvar", lá embaixo, a lista do que falta já tinha rolado
// para fora da tela — a pessoa clicava, tomava o toast de recusa e tinha que
// rolar de volta para descobrir o quê. Grudado na lateral, o que falta fica
// à vista exatamente no momento em que se tenta salvar.
//
// Os rótulos são os MESMOS do formulário ("Qtd. Func. Estip.", não
// "quant_func_estipulado"): quem lê precisa saber onde clicar, não qual
// coluna do banco está nula.

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
  const quantos = pendentes.length + errosQuadro.length;

  // Agrupa por seção na ordem em que elas aparecem no formulário — a lista
  // vira um roteiro de onde ir, de cima para baixo.
  const porSecao = pendentes.reduce<Record<string, string[]>>((acc, i) => {
    (acc[i.secao] ??= []).push(i.campo);
    return acc;
  }, {});

  return (
    <div
      className={cn(
        "rounded-lg border text-xs",
        tudoOk
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-amber-200 bg-amber-50 text-amber-900",
      )}
    >
      <div className="flex items-start gap-1.5 px-3 pb-2 pt-2.5 font-semibold">
        {tudoOk ? (
          <>
            <CheckCircle2 className="mt-px h-4 w-4 shrink-0" aria-hidden />
            <span>Tudo preenchido</span>
          </>
        ) : (
          <>
            <CircleAlert className="mt-px h-4 w-4 shrink-0" aria-hidden />
            <span>
              Ainda falta preencher:
              <span className="ml-1 rounded bg-amber-200/70 px-1.5 py-px text-[10px] font-bold tabular-nums">
                {quantos}
              </span>
            </span>
          </>
        )}
      </div>

      {tudoOk ? (
        <p className="px-3 pb-3 font-medium leading-relaxed">
          O contrato pode ser salvo. Os postos marcados para abrir vaga viram
          solicitações no Recrutamento, com salário, benefícios, escala e local
          já preenchidos.
        </p>
      ) : (
        <div className="space-y-2.5 px-3 pb-3">
          {Object.entries(porSecao).map(([secao, campos]) => (
            <div key={secao}>
              <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700/80">
                {secao}
              </div>
              <ul className="mt-0.5 space-y-0.5">
                {campos.map(c => (
                  <li key={c} className="flex items-start gap-1.5 font-medium leading-snug">
                    <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-amber-500" aria-hidden />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {errosQuadro.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700/80">
                Quadro de Postos
              </div>
              <ul className="mt-0.5 space-y-1">
                {errosQuadro.map((e, i) => (
                  <li key={i} className="flex items-start gap-1.5 font-medium leading-snug">
                    <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-amber-500" aria-hidden />
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* O aviso de divergência é separado de propósito: ele NÃO impede de
          salvar (implantação faseada é normal), então não pode aparecer
          misturado na lista do que bloqueia. */}
      {avisoQuadro && (
        <p className="mx-3 mb-3 rounded border border-sky-200 bg-sky-50 px-2 py-1.5 font-medium leading-snug text-sky-900">
          {avisoQuadro} Isso não impede de salvar — confira se a implantação é em fases.
        </p>
      )}
    </div>
  );
}
