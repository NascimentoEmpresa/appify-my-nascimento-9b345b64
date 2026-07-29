import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Ban } from "lucide-react";
import { COMPLEXIDADE_LABEL, type AapDados, type EtapaPanelProps } from "./types";
import { RecusadoPanel } from "./RecusadoPanel";
import { AapDocumento } from "./AapDocumento";

export function AprovacaoPriorizacaoPanel({
  card, papeis, usuarios, totalNaColuna, prioridadesUsadas, onUpdate, onExcluir,
}: EtapaPanelProps) {
  const [aap, setAap] = useState<AapDados>(card.aap_dados ?? {});
  useEffect(() => { setAap(card.aap_dados ?? {}); }, [card.aap_dados]);

  const podeAgir = papeis.comite || papeis.gerenteSistemas;
  const podeRecusar = papeis.comite || papeis.gerenteSistemas;

  function patch(novo: AapDados) {
    setAap(novo);
    onUpdate({ aap_dados: novo });
  }

  const opcoes = Array.from({ length: totalNaColuna }, (_, i) => i + 1).filter(
    (n) => n === card.prioridade || !prioridadesUsadas.includes(n),
  );
  const podeAvancar = papeis.gerenteSistemas && card.prioridade === 1 && !!card.responsavel_user_id && !!card.complexidade;

  if (card.recusado) {
    return (
      <RecusadoPanel
        podeReativar={papeis.controladoria}
        onReativar={() => onUpdate({ etapa: "solicitacao_demanda", recusado: false })}
        onExcluir={onExcluir}
      />
    );
  }

  return (
    <div className="space-y-4">
      <AapDocumento dados={aap} card={card} isReadOnly={!podeAgir} onPatch={patch} />

      <div className="border-t pt-4 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Campos de aprovação</p>

        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Prioridade (Comitê)</label>
          <Select
            value={card.prioridade != null ? String(card.prioridade) : undefined}
            onValueChange={(v) => onUpdate({ prioridade: Number(v) })}
            disabled={!papeis.comite}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Selecionar prioridade…" />
            </SelectTrigger>
            <SelectContent>
              {opcoes.map((n) => (
                <SelectItem key={n} value={String(n)}>Prioridade {n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Responsável (Gerente de Sistemas)</label>
          <SearchableSelect
            value={card.responsavel_user_id}
            onChange={(v) => onUpdate({ responsavel_user_id: v })}
            options={usuarios.map((u) => ({ value: u.id, label: u.display_name }))}
            placeholder="Selecionar responsável…"
            searchPlaceholder="Buscar usuário..."
            disabled={!papeis.gerenteSistemas}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Complexidade (Gerente de Sistemas)</label>
          <Select
            value={card.complexidade ?? undefined}
            onValueChange={(v) => onUpdate({ complexidade: v })}
            disabled={!papeis.gerenteSistemas}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Selecionar complexidade…" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(COMPLEXIDADE_LABEL).map(([v, label]) => (
                <SelectItem key={v} value={v}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex gap-2">
        <Button className="gap-1.5" disabled={!podeAvancar} onClick={() => onUpdate({ etapa: "desenvolvimento" })}>
          <ArrowRight className="h-3.5 w-3.5" /> Avançar para Desenvolvimento
        </Button>
        <Button variant="destructive" className="gap-1.5" disabled={!podeRecusar} onClick={() => onUpdate({ recusado: true })}>
          <Ban className="h-3.5 w-3.5" /> Encerrar Demanda
        </Button>
      </div>

      {!papeis.gerenteSistemas && <p className="text-[11px] text-muted-foreground">Só o Gerente de Sistemas define responsável/complexidade e avança esta etapa.</p>}
      {papeis.gerenteSistemas && card.prioridade !== 1 && (
        <p className="text-[11px] text-muted-foreground">Só é possível avançar o card que estiver com prioridade 1. Avance-o primeiro.</p>
      )}
    </div>
  );
}
