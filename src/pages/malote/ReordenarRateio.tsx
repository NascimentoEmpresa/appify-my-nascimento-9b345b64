import { useEffect, useState } from "react";
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useReordenarRateioAjuste, type RateioLinha } from "@/hooks/useMaloteDespesa";
import { fmtMoney } from "./orcamentoUtils";

// [SEM-CHAMADO] (SD-2026-0211): em ajuste de pagamento, quem corrige a despesa escolhe qual linha do Rateio vem primeiro (é a que as listas mostram como
// empresa/contrato). Só a ordem muda — valores e aprovação ficam como estão.

interface Props {
  despesaId: string;
  linhas: RateioLinha[];
  contratos: { id: string; nome: string }[];
  empresas: { id: string; nome: string }[];
  /** ordem ainda não salva (null = nada pendente): o "Salvar"/"Reenviar" da tela também grava, para a ordem não se perder se a pessoa não clicar em "Salvar ordem". */
  onPendente?: (ids: string[] | null) => void;
}

function Item({ linha, posicao, rotulo, onMover, ultimo }: { linha: RateioLinha; posicao: number; rotulo: string; onMover: (d: -1 | 1) => void; ultimo: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: linha.id as string });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm ${isDragging ? "z-10 shadow-md" : ""}`}
    >
      <button type="button" aria-label={`Arrastar a linha ${posicao + 1}`} className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing" {...attributes} {...listeners}>
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-6 text-xs font-semibold text-muted-foreground">{posicao + 1}º</span>
      <span className="flex-1 truncate">{rotulo}</span>
      <span className="whitespace-nowrap font-medium">{fmtMoney(Number(linha.valor) || 0)}</span>
      <span className="flex gap-1">
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={posicao === 0} onClick={() => onMover(-1)} aria-label="Subir linha">↑</Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={ultimo} onClick={() => onMover(1)} aria-label="Descer linha">↓</Button>
      </span>
    </li>
  );
}

export function ReordenarRateio({ despesaId, linhas, contratos, empresas, onPendente }: Props) {
  const reordenar = useReordenarRateioAjuste();
  const salvas = linhas.filter((l) => l.id);
  const [ordem, setOrdem] = useState<RateioLinha[]>(salvas);
  useEffect(() => { setOrdem(linhas.filter((l) => l.id)); }, [linhas]);

  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const rotulo = (l: RateioLinha) => {
    const empresa = l.empresa_id ? empresas.find((e) => e.id === l.empresa_id)?.nome : null;
    const contrato = l.contrato_id ? contratos.find((c) => c.id === l.contrato_id)?.nome : null;
    return [empresa, contrato].filter(Boolean).join(" — ") || "Linha do rateio";
  };

  const idsSalvos = salvas.map((l) => l.id).join("|");
  const mudou = ordem.map((l) => l.id).join("|") !== idsSalvos;

  useEffect(() => { onPendente?.(mudou ? ordem.map((l) => l.id as string) : null); }, [mudou, ordem]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onPendente?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  function aoSoltar(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    setOrdem((atual) => arrayMove(atual, atual.findIndex((l) => l.id === e.active.id), atual.findIndex((l) => l.id === e.over!.id)));
  }
  const mover = (i: number, d: -1 | 1) => setOrdem((atual) => arrayMove(atual, i, i + d));

  async function salvar() {
    try {
      const nova = ordem[0];
      await reordenar.mutateAsync({
        despesaId,
        linhaIds: ordem.map((l) => l.id as string),
        descricao: `Ordem do rateio alterada (1ª linha: ${rotulo(nova)}).`,
      });
      toast.success("Ordem do rateio salva.");
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Erro ao salvar a ordem do rateio.");
    }
  }

  if (salvas.length < 2) return null;
  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <div>
        <p className="text-sm font-semibold">Ordem das linhas do rateio</p>
        <p className="text-xs text-muted-foreground">
          Arraste (ou use as setas) para escolher a ordem. A <span className="font-medium text-foreground">1ª linha</span> é a empresa/contrato mostrada nas listas.
          Mudar só a ordem não altera valores nem reinicia a aprovação.
        </p>
      </div>
      <DndContext sensors={sensores} collisionDetection={closestCenter} onDragEnd={aoSoltar}>
        <SortableContext items={ordem.map((l) => l.id as string)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1.5">
            {ordem.map((l, i) => <Item key={l.id} linha={l} posicao={i} rotulo={rotulo(l)} onMover={(d) => mover(i, d)} ultimo={i === ordem.length - 1} />)}
          </ul>
        </SortableContext>
      </DndContext>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!mudou || reordenar.isPending} onClick={() => setOrdem(salvas)}>Desfazer</Button>
        <Button type="button" size="sm" disabled={!mudou || reordenar.isPending} onClick={salvar}>{reordenar.isPending ? "Salvando..." : "Salvar ordem"}</Button>
      </div>
    </div>
  );
}
