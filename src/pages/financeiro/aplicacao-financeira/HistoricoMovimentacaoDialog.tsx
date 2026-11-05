import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useHistoricoMovimentacaoAplicacao, type AlvoHistoricoAplicacao } from "@/hooks/useAplicacaoFinanceira";

// Histórico de uma linha da tela de Aplicações Financeiras (aplicação, resgate ou lançamento importado do Fluxo), no mesmo formato do histórico
// do Fluxo de Caixa. Abre com duplo clique na linha ou pelo menu "Histórico".

const ROTULO_TIPO: Record<string, string> = {
  criacao: "Criação",
  edicao: "Edição",
  exclusao: "Exclusão",
  rendimento_atualizado: "Rendimento atualizado",
  resgate_parcial: "Resgate parcial",
  resgate_total: "Resgate total",
  importado: "Importado",
  ajuste_criado: "Ajuste criado",
  ajuste_alterado: "Ajuste alterado",
  ajuste_desfeito: "Ajuste desfeito",
  rateio_criado: "Rateio criado",
  rateio_alterado: "Rateio refeito",
  rateio_desfeito: "Rateio desfeito",
  excluido: "Excluído",
  restaurado: "Restaurado",
};

const COR_FONTE: Record<string, string> = {
  Aplicação: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  Resgate: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  "Fluxo de Caixa": "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  Planilha: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
};

export function HistoricoMovimentacaoDialog({ alvo, onClose }: { alvo: AlvoHistoricoAplicacao | null; onClose: () => void }) {
  const { data: eventos = [], isLoading, error } = useHistoricoMovimentacaoAplicacao(alvo);

  return (
    <Dialog open={!!alvo} onOpenChange={(aberto) => !aberto && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Histórico do lançamento</DialogTitle>
          <DialogDescription>{alvo?.titulo}</DialogDescription>
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
                <span className="font-medium">{ROTULO_TIPO[e.tipo] ?? e.tipo.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}</span>
                <span className="text-muted-foreground">
                  {e.quando ? new Date(e.quando).toLocaleString("pt-BR") : "—"}
                  {e.usuario ? ` · ${e.usuario}` : ""}
                </span>
              </div>
              {e.descricao && <p className="mt-1 text-muted-foreground">{e.descricao}</p>}
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
