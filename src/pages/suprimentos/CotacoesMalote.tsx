import { PageHeader } from "@/components/layout/PageHeader";
import { Construction } from "lucide-react";

/**
 * Cotações do Malote — reservado.
 *
 * A tela ainda não foi desenvolvida. A entrada existe desde já para o menu
 * `sup_cotacoes_malote` (20260828000001) poder ser liberado em Acesso por
 * Usuário e a rota não cair no 404 de quem receber o link.
 *
 * Não vira componente genérico de "em construção": é o único caso hoje, e uma
 * abstração antes do segundo caso seria decidir sem informação.
 */
export default function CotacoesMalote() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cotações do Malote"
        subtitle="Reservado para o fluxo de cotações do malote."
        module="Suprimentos"
        breadcrumb={["Materiais & Catálogo", "Cotações do Malote"]}
      />

      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <Construction className="h-12 w-12 text-muted-foreground/50" />
        <p className="text-lg font-medium">Módulo em desenvolvimento</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Aguarde novas atualizações.
        </p>
      </div>
    </div>
  );
}
