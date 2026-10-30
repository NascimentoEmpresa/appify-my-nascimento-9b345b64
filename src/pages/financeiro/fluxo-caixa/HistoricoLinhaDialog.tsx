import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useHistoricoLinhaFluxo, type EventoHistoricoLinhaFluxo } from "@/hooks/useFluxoCaixaMalote";
import { ROTULO_CAMPO_AJUSTE, formatarCampoAjuste } from "./HistoricoAjusteFluxo";

// SIS-2026-0712: histórico da linha desde a origem. Abre com duplo clique na linha ou pelo botão de histórico.
const ROTULO_TIPO: Record<string, string> = {
  rateio_criado: "Rateio criado",
  rateio_alterado: "Rateio refeito",
  rateio_desfeito: "Rateio desfeito",
  excluido: "Excluído",
  restaurado: "Restaurado",
  ajuste_criado: "Ajuste criado",
  ajuste_alterado: "Ajuste alterado",
  ajuste_desfeito: "Ajuste desfeito",
  importado: "Importado",
  criacao: "Criação",
  edicao: "Edição",
  pagamento: "Pagamento",
  exclusao: "Exclusão",
  // Eventos do Malote (malote_despesa_evento.tipo_evento).
  aguardando_cotacao: "Aguardando cotação",
  cotacao_realizada: "Cotação realizada",
  solicitacao_aprovada: "Solicitação aprovada",
  solicitacao_reprovada: "Solicitação reprovada",
  despesa_criada: "Despesa criada",
  aprovacao_nivel: "Aprovação",
  necessidade_de_ajuste: "Necessidade de ajuste",
  reenvio_aprovacao: "Reenviada para aprovação",
  aguardando_pagamento: "Aguardando pagamento",
  despesa_paga: "Despesa paga",
  despesa_reprovada: "Despesa reprovada",
  cancelamento: "Cancelamento",
  ajuste_cotacao_solicitado: "Ajuste da cotação solicitado",
};

// "Aprovação — Nível 2": o evento do Malote guarda o nível (1, 2 ou 3) e sem ele não dá para saber quem aprovou o quê.
function rotuloEvento(e: EventoHistoricoLinhaFluxo): string {
  const base = ROTULO_TIPO[e.tipo] ?? e.tipo.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const nivel = e.detalhe?.nivel;
  return nivel ? `${base} — Nível ${nivel}` : base;
}

const COR_FONTE: Record<string, string> = {
  "Fluxo de Caixa": "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  Malote: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  "Débito Automático": "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  Planilha: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
};

const brl = (n: unknown) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Detalhe({ e }: { e: EventoHistoricoLinhaFluxo }) {
  const d = e.detalhe;
  if (!d) return null;

  if (e.tipo.startsWith("ajuste_") && Array.isArray(d.campos)) {
    return (
      <ul className="ml-3 text-muted-foreground">
        {(d.campos as string[]).map((c) => (
          <li key={c}>
            {ROTULO_CAMPO_AJUSTE[c] ?? c}: {formatarCampoAjuste(c, d.antes?.[c])} → {formatarCampoAjuste(c, d.depois?.[c])}
          </li>
        ))}
      </ul>
    );
  }

  if (e.tipo.startsWith("rateio_") && (Array.isArray(d.antes) || Array.isArray(d.depois))) {
    const lista = (titulo: string, itens: { contrato: string; valor: number }[] | null) =>
      itens ? (
        <div>
          <span className="font-medium">{titulo}:</span>{" "}
          {itens.map((i, k) => (
            <span key={k}>
              {k > 0 && " · "}
              {i.contrato} {brl(i.valor)}
            </span>
          ))}
        </div>
      ) : null;
    return (
      <div className="ml-3 space-y-0.5 text-muted-foreground">
        {lista("Antes", d.antes)}
        {lista("Depois", d.depois)}
      </div>
    );
  }
  return null;
}

export function HistoricoLinhaDialog({
  linha,
  onClose,
}: {
  linha: { origem: string; despesa_id: string; numero_parcela: number | null; id_malote?: string | null; descricao?: string | null } | null;
  onClose: () => void;
}) {
  const { data: eventos = [], isLoading, error } = useHistoricoLinhaFluxo(linha);

  return (
    <Dialog open={!!linha} onOpenChange={(aberto) => !aberto && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Histórico do lançamento</DialogTitle>
          <DialogDescription>
            {linha?.id_malote ? <span className="font-mono">{linha.id_malote}</span> : null}
            {linha?.id_malote && linha?.descricao ? " — " : ""}
            {linha?.descricao}
          </DialogDescription>
        </DialogHeader>

        {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Carregando...</p>}
        {error && <p className="py-6 text-center text-sm text-destructive">Não foi possível carregar o histórico.</p>}
        {!isLoading && !error && eventos.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhum registro para este lançamento ainda.</p>
        )}

        <ol className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {eventos.map((e, i) => (
            <li key={`${e.quando}-${i}`} className="rounded-md border p-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={COR_FONTE[e.fonte] ?? ""}>{e.fonte}</Badge>
                <span className="font-medium">{rotuloEvento(e)}</span>
                <span className="text-muted-foreground">
                  {e.quando ? new Date(e.quando).toLocaleString("pt-BR") : "—"}
                  {e.usuario ? ` · ${e.usuario}` : ""}
                </span>
              </div>
              {e.descricao && <p className="mt-1 text-muted-foreground">{e.descricao}</p>}
              <Detalhe e={e} />
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
