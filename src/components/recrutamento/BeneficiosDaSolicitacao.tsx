import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, Pencil, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useAtualizarBeneficiosVaga, useBeneficiosDaVaga, useSalvarObservacoesVaga } from "@/hooks/useConvencoes";
import { montarQuadro } from "@/lib/licitacoes/convencoes";
import { QuadroBeneficios } from "@/components/licitacoes/convencoes/QuadroBeneficios";

// Detalhe da solicitação de vaga › coluna da direita (layout de referência
// do chamado Convenções Coletivas, 27/10/2026): os benefícios da CCT do
// posto — na VERSÃO que a vaga usou — e as observações da solicitação.
//
// "Editar se necessário" leva ao cadastro de origem (a convenção, na
// Licitação): o chamado pede os ajustes lá, para a convenção, a Planilha de
// Custo e a vaga não divergirem. Só aparece para quem pode alterar o cadastro.

export function BeneficiosDaSolicitacao({ vagaId }: { vagaId: number }) {
  const q = useBeneficiosDaVaga(vagaId);
  const atualizar = useAtualizarBeneficiosVaga(vagaId);
  const salvarObs = useSalvarObservacoesVaga(vagaId);
  const { data: podeEditarCct = false } = useScreenAccess("licitacoes_convencoes", "alterar");
  const [obs, setObs] = useState("");
  const ref = q.data?.referencia ?? null;
  const quadro = montarQuadro(ref);
  const podeAlterarVaga = !!ref?.pode_atualizar;

  useEffect(() => { setObs(q.data?.obs?.observacoes ?? ""); }, [q.data?.obs?.observacoes]);

  // Banco ainda sem a migration: a coluna não aparece.
  if (!q.isLoading && !ref && !q.data?.obs) return null;

  const principalId = quadro.usadas[0]?.id;
  const salvar = async () => {
    try { await salvarObs.mutateAsync(obs); toast.success("Observações salvas."); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="flex flex-col gap-4">
      <QuadroBeneficios
        resposta={ref}
        carregando={q.isLoading}
        acao={podeEditarCct && principalId ? (
          <Button asChild variant="outline" size="sm" className="shrink-0 bg-background font-semibold text-[#0f3171] dark:text-blue-300">
            <Link to={`/app/licitacoes/convencoes?editar=${principalId}`}><Pencil className="mr-1.5 h-3.5 w-3.5" />Editar se necessário</Link>
          </Button>
        ) : undefined}
        rodape={quadro.desatualizada ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
            <span>A convenção foi atualizada depois que esta vaga foi aberta. A vaga mostra a versão que usou.</span>
            {podeAlterarVaga && (
              <Button size="sm" variant="outline" disabled={atualizar.isPending}
                onClick={() => atualizar.mutateAsync().then(() => toast.success("Benefícios atualizados para a versão atual."), (e) => toast.error(String(e?.message ?? e)))}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Usar versão atual
              </Button>
            )}
          </div>
        ) : undefined}
      />

      <div className="rounded-xl border bg-card p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-[#0f3171] dark:text-blue-300">
          <MessageSquare className="h-4 w-4" />Observações da solicitação
        </h3>
        <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} disabled={!podeAlterarVaga}
          placeholder={podeAlterarVaga ? "Adicione observações sobre esta solicitação…" : "Sem observações."} />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {q.data?.obs?.observacoes_em ? `Por ${q.data.obs.observacoes_por ?? "—"} em ${new Date(q.data.obs.observacoes_em).toLocaleString("pt-BR")}` : ""}
          </span>
          {podeAlterarVaga && (
            <Button size="sm" onClick={salvar} disabled={salvarObs.isPending || obs === (q.data?.obs?.observacoes ?? "")}
              className="bg-[#0f3171] hover:bg-[#0c2860]">Salvar observações</Button>
          )}
        </div>
      </div>
    </div>
  );
}
