import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const TOPICOS: { titulo: string; texto: string }[] = [
  {
    titulo: "1. Escolha o veículo",
    texto:
      "Os cards mostram a frota cadastrada no módulo de Patrimônio. Card com selo cinza está indisponível e não pode ser escolhido.",
  },
  {
    titulo: "2. Data e turno",
    texto:
      "Escolha a saída, o retorno e o turno. Se outra pessoa já reservou aquele carro no período, o aviso aparece na hora — antes de você confirmar.",
  },
  {
    titulo: "3. Contratos atendidos",
    texto:
      "Marque todos os contratos que a viagem atende (pelo menos um). É o que permite depois saber quanto a frota rodou para cada contrato.",
  },
  {
    titulo: "4. Confirme",
    texto:
      "Confira o resumo e confirme. A reserva ganha um número de protocolo e passa a aparecer no Calendário Geral para todo mundo.",
  },
  {
    titulo: "Por que um veículo fica indisponível?",
    texto:
      "Porque o Patrimônio o marcou como em manutenção. Quando há previsão de retorno, o carro volta a aceitar reservas a partir do dia seguinte a ela; sem previsão, fica bloqueado por tempo indeterminado. Esta tela não altera nada no Patrimônio — só respeita o que está lá.",
  },
  {
    titulo: "Precisa desmarcar?",
    texto:
      "Em 'Meus Agendamentos', cancele informando o motivo. O veículo volta a ficar livre na mesma hora e o cancelamento fica registrado no histórico.",
  },
];

export function ComoUsarDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <HelpCircle className="h-4 w-4" />
          Como Usar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Como agendar um veículo</DialogTitle>
          <DialogDescription>Quatro passos, do card ao protocolo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {TOPICOS.map((t) => (
            <div key={t.titulo}>
              <h4 className="text-sm font-semibold text-foreground">{t.titulo}</h4>
              <p className="mt-0.5 text-sm text-muted-foreground">{t.texto}</p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
