import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useCtrlRegistros } from "@/hooks/useReunioesEncarregados";
import Dashboard from "./Dashboard";
import Importar from "./Importar";
import ListaReunioes from "./ListaReunioes";
import Revisar from "./Revisar";
import PlanoAcao from "./PlanoAcao";
import Vinculos from "./Vinculos";
import { MENU_REUNIOES } from "./comum";

// =====================================================================
// CONTROLADORIA › REUNIÕES COM ENCARREGADOS (mig 20261006000005)
//
// Pedido (06/10/2026): importar as transcrições das reuniões dos
// supervisores com os encarregados e ter um dashboard das reclamações e
// dificuldades. Abas: Dashboard · Importar · Reuniões · Revisar
// levantamento · Plano de ação · Equipe e contratos (vínculos). A aba fica
// na URL (?aba=) para o "ver todos" do dashboard abrir a revisão filtrada.
// Regras de leitura/classificação: src/lib/controladoria/reunioes.ts.
// =====================================================================

export default function ReunioesEncarregados() {
  const [params, setParams] = useSearchParams();
  const aba = params.get("aba") ?? "dashboard";
  const irPara = (a: string, extra: Record<string, string> = {}) => setParams({ aba: a, ...extra });
  const { data: registros = [] } = useCtrlRegistros();
  const pendentes = registros.filter((r) => r.status === "pendente").length;

  return (
    <div className="space-y-4">
      <PageHeader title="Reuniões com Encarregados" subtitle="Da transcrição à decisão — reclamações e dificuldades levantadas nas reuniões"
        module="Controladoria" breadcrumb={["Controladoria", "Reuniões com Encarregados"]} />
      <AcessoGate menu={MENU_REUNIOES} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para esta tela.</Card>}>
        <Tabs value={aba} onValueChange={(a) => irPara(a)}>
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="importar">Importar transcrições</TabsTrigger>
            <TabsTrigger value="reunioes">Reuniões</TabsTrigger>
            <TabsTrigger value="revisar" className="gap-1.5">Revisar levantamento {pendentes > 0 && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{pendentes}</Badge>}</TabsTrigger>
            <TabsTrigger value="acoes">Plano de ação</TabsTrigger>
            <TabsTrigger value="vinculos">Equipe e contratos</TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard"><Dashboard irPara={irPara} /></TabsContent>
          <TabsContent value="importar"><Importar aoImportar={() => irPara("revisar")} /></TabsContent>
          <TabsContent value="reunioes"><ListaReunioes irPara={irPara} /></TabsContent>
          <TabsContent value="revisar"><Revisar filtroInicial={{ reuniao: params.get("reuniao"), tema: params.get("tema"), status: params.get("status") }} /></TabsContent>
          <TabsContent value="acoes"><PlanoAcao /></TabsContent>
          <TabsContent value="vinculos"><Vinculos /></TabsContent>
        </Tabs>
      </AcessoGate>
    </div>
  );
}
