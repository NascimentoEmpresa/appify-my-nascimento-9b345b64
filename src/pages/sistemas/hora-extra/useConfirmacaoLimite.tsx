import { useCallback, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buscarPontoMesHoraExtra } from "@/hooks/useHoraExtra";
import {
  LIMITE_HE_MES_MIN,
  confirmarLimiteHoraExtra,
  mesDaData,
  resumirMesHoraExtra,
  rotuloMesHoraExtra,
} from "@/lib/horaExtraLimite";
import { formatarDuracao } from "./horaExtraUtils";

interface Pergunta {
  titulo: string;
  descricao: string;
}

export interface HeParaConferir {
  colaboradorId: string;
  data: string;
  minutos: number;
  /** A própria HE, quando já existe: o valor antigo sai da conta. */
  ignorarId?: string | null;
}

/**
 * O limite de 48h na hora de confirmar. `conferirLimite` lê o mês de novo e
 * responde se pode salvar: abaixo do limite responde sim sem perguntar nada;
 * acima, faz as três perguntas. Quem usa renderiza `dialogoLimite` e só salva
 * com `true`.
 *
 * AlertDialog, não window.confirm: o Chrome oferece "impedir esta página de
 * criar mais caixas de diálogo" a partir da segunda seguida, e quem marca passa
 * a receber `false` para sempre, sem conseguir confirmar nunca mais.
 *
 * Se a leitura falhar, não dá para saber o total: a tela diz isso e a pessoa
 * decide, porque o limite é confirmação e não pode travar uma HE por causa de
 * uma falha de rede. O que não pode é pular a conferência calada.
 */
export function useConfirmacaoLimite() {
  const [pergunta, setPergunta] = useState<Pergunta | null>(null);
  const resolver = useRef<((resposta: boolean) => void) | null>(null);

  const perguntar = useCallback(
    (titulo: string, descricao: string) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setPergunta({ titulo, descricao });
      }),
    [],
  );

  const responder = (resposta: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setPergunta(null);
    resolve?.(resposta);
  };

  const conferirLimite = useCallback(
    async ({ colaboradorId, data, minutos, ignorarId }: HeParaConferir): Promise<boolean> => {
      if (!colaboradorId || !data) return true;
      const mes = mesDaData(data);
      let resumo;
      try {
        // Sempre do banco, sem cache: outra HE pode ter entrado depois que a tela abriu.
        const resposta = await buscarPontoMesHoraExtra(mes, colaboradorId);
        resumo = resumirMesHoraExtra(resposta, { ignorarId, novaHe: { data, minutos } });
      } catch {
        return perguntar(
          "NÃO FOI POSSÍVEL CONFERIR O LIMITE DE HORAS EXTRAS. DESEJA CONFIRMAR MESMO ASSIM?",
          `Não consegui ler o total de ${rotuloMesHoraExtra(mes)}. Esta hora extra será salva sem a conferência das ${LIMITE_HE_MES_MIN / 60}h.`,
        );
      }
      if (!resumo.passouLimite) return true;
      const descricao =
        `Com esta hora extra, o total de ${rotuloMesHoraExtra(mes)} fica em ` +
        `${formatarDuracao(resumo.total, true)} (limite de ${LIMITE_HE_MES_MIN / 60}h).`;
      return confirmarLimiteHoraExtra((mensagem) => perguntar(mensagem, descricao));
    },
    [perguntar],
  );

  const dialogoLimite = (
    <AlertDialog open={!!pergunta} onOpenChange={(aberto) => !aberto && responder(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pergunta?.titulo}</AlertDialogTitle>
          <AlertDialogDescription>{pergunta?.descricao}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => responder(false)}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => responder(true)}>Confirmar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { conferirLimite, dialogoLimite };
}
