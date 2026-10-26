import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  useAtivosTi, useExcluirAtivo, usePlantasTi, useSalvarAtivo, type TiAtivo,
} from "@/hooks/useTiMapa";
import { AtivoDialog } from "./mapa/AtivoDialog";
import { Inventario } from "./mapa/Inventario";

/**
 * T.I › Inventário — a lista, com os dados de patrimônio.
 *
 * Tela própria (menu `ti_inventario`) porque é aqui que moram valor de
 * compra, nota fiscal, número de série e garantia. O Mapa pode ser aberto
 * para o escritório inteiro; isto aqui, não necessariamente.
 */
export default function InventarioTi() {
  const navigate = useNavigate();
  const [aberto, setAberto] = useState<TiAtivo | null | undefined>(undefined);

  const { data: ativos = [], isLoading } = useAtivosTi();
  const { data: plantas = [] } = usePlantasTi();
  const salvar = useSalvarAtivo();
  const excluir = useExcluirAtivo();

  const { data: podeEditar = false } = useScreenAccess("ti_ativo_gerenciar", "alterar");
  const { data: podeIncluir = false } = useScreenAccess("ti_ativo_gerenciar", "incluir");
  const { data: podeExcluir = false } = useScreenAccess("ti_ativo_gerenciar", "excluir");

  const total = useMemo(() => ativos.filter((a) => a.status !== "descartado").length, [ativos]);

  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title="Inventário de hardware"
        module="T.I"
        breadcrumb={["Inventário"]}
        subtitle={`${total} equipamentos ativos — configuração, rede, responsável, garantia e custo.`}
        actions={
          podeIncluir ? (
            <Button onClick={() => setAberto(null)}>
              <Plus className="mr-1.5 h-4 w-4" /> Novo equipamento
            </Button>
          ) : null
        }
      />

      {isLoading ? (
        <Card className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          Carregando o inventário…
        </Card>
      ) : (
        <Inventario
          ativos={ativos}
          plantas={plantas}
          onAbrir={(id) => setAberto(ativos.find((a) => a.id === id) ?? null)}
          onIrParaMapa={() => navigate("/app/ti/mapa-hardware")}
        />
      )}

      <AtivoDialog
        aberto={aberto !== undefined}
        onFechar={() => setAberto(undefined)}
        ativo={aberto ?? null}
        plantas={plantas}
        ativos={ativos}
        podeEditar={aberto ? podeEditar : podeIncluir}
        podeExcluir={podeExcluir}
        salvando={salvar.isPending}
        onSalvar={(dados) => salvar.mutate(dados, { onSuccess: () => setAberto(undefined) })}
        onExcluir={(id) => {
          excluir.mutate(id);
          setAberto(undefined);
        }}
      />
    </div>
  );
}
