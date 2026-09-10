import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useAtivosTi, usePlantasTi, useSalvarAtivo, type TiAtivo } from "@/hooks/useTiMapa";
import { AtivoDialog } from "./mapa/AtivoDialog";
import { PainelTi } from "./mapa/PainelTi";

/**
 * T.I › Painel — os indicadores do parque.
 *
 * Menu próprio (`ti_painel`) para o gestor acompanhar manutenção, garantia e
 * custo sem precisar do Inventário inteiro nem da tela de construir.
 */
export default function PainelTiPage() {
  const [aberto, setAberto] = useState<TiAtivo | null | undefined>(undefined);

  const { data: ativos = [], isLoading } = useAtivosTi();
  const { data: plantas = [] } = usePlantasTi();
  const salvar = useSalvarAtivo();
  const { data: podeEditar = false } = useScreenAccess("ti_ativo_gerenciar", "alterar");

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Painel de T.I"
        module="T.I"
        breadcrumb={["Painel"]}
        subtitle="O que precisa de atenção hoje: manutenção, garantia vencendo, equipamento sem responsável."
      />

      {isLoading ? (
        <Card className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          Somando o parque…
        </Card>
      ) : (
        <PainelTi ativos={ativos} onAbrir={(id) => setAberto(ativos.find((a) => a.id === id) ?? null)} />
      )}

      <AtivoDialog
        aberto={aberto !== undefined}
        onFechar={() => setAberto(undefined)}
        ativo={aberto ?? null}
        plantas={plantas}
        ativos={ativos}
        podeEditar={podeEditar}
        podeExcluir={false}
        salvando={salvar.isPending}
        onSalvar={(dados) => salvar.mutate(dados, { onSuccess: () => setAberto(undefined) })}
        onExcluir={() => undefined}
      />
    </div>
  );
}
