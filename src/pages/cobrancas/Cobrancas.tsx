import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import NotasAbertoTab from "./NotasAbertoTab";
import AutomacaoTab from "./AutomacaoTab";
import ModelosEmailTab from "./ModelosEmailTab";
import DestinatariosTab from "./DestinatariosTab";

export default function Cobrancas() {
  return (
    <div className="space-y-6">
      <PageHeader
        module="Financeiro"
        breadcrumb={["Controle de Notas", "Cobranças"]}
        title="Cobranças"
        subtitle="Notas em aberto para cobrança e envio automático das cobranças do Financeiro."
      />

      {/* SIS-2026-0653: aba de automação ao lado da lista de notas em aberto. */}
      <Tabs defaultValue="notas">
        <TabsList>
          <TabsTrigger value="notas">Notas em aberto</TabsTrigger>
          <TabsTrigger value="automacao">Automação</TabsTrigger>
          <TabsTrigger value="modelos">Modelos de e-mail</TabsTrigger>
          <TabsTrigger value="destinatarios">Destinatários</TabsTrigger>
        </TabsList>
        <TabsContent value="notas" className="mt-4"><NotasAbertoTab /></TabsContent>
        <TabsContent value="automacao" className="mt-4"><AutomacaoTab /></TabsContent>
        <TabsContent value="modelos" className="mt-4"><ModelosEmailTab /></TabsContent>
        <TabsContent value="destinatarios" className="mt-4"><DestinatariosTab /></TabsContent>
      </Tabs>
    </div>
  );
}
