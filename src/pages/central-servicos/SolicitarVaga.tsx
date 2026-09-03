// Arquivo: src/pages/central-servicos/SolicitarVaga.tsx
//
// Central de Serviços › Solicitar Vaga.
//
// A porta do escritório para abrir vaga. Até 03/09/2026 só existiam duas: a do
// encarregado (Encarregados › Solicitar Vaga), que copia tudo do cadastro de
// um colaborador, e a da Gestão de Recrutamento, que quem só pede vaga não
// tem acesso. Quem trabalha no administrativo caía na do encarregado e
// esbarrava num formulário que exige escolher alguém do posto.
//
// O formulário aqui é o MESMO da Gestão de Recrutamento — mesmo componente,
// com os três pontinhos de "Preencher manualmente" e o vínculo com o catálogo
// de Suprimentos. Ver components/recrutamento/ModalNovaVaga.tsx.
//
// A tela é o formulário: ele abre sozinho ao entrar, e fechar deixa o resumo
// com o botão de abrir de novo — o mesmo desenho das rotas
// /app/encarregados/solicitar-*.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ModalNovaVaga } from "@/components/recrutamento/ModalNovaVaga";
import { UserPlus, ClipboardList } from "lucide-react";

export default function SolicitarVaga() {
  const nav = useNavigate();
  const [modalVaga, setModalVaga] = useState(true);
  const [criadas, setCriadas] = useState<number[]>([]);

  return (
    <div>
      <PageHeader
        title="Solicitar Vaga"
        subtitle="Abra uma vaga para o Recrutamento — o pedido segue para a análise do Analista."
        module="Central de Serviços"
        breadcrumb={["Solicitar Vaga"]}
        actions={
          <Button onClick={() => setModalVaga(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Nova solicitação
          </Button>
        }
      />

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <UserPlus className="h-5 w-5" />
        </div>
        <div>
          <div className="font-semibold text-foreground">Como funciona</div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            São três etapas: identificação da vaga, detalhes do posto e requisitos. O grau de
            urgência sai do prazo da data de início — quanto mais perto, mais urgente. Depois de
            enviada, a solicitação vai para <b>Pendente Analista</b> e você acompanha o andamento em
            Minhas Solicitações.
          </p>
        </div>

        {criadas.length > 0 && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
            ✓ Solicitação {criadas.map(n => `#${n}`).join(", ")} enviada para o Recrutamento.
          </div>
        )}

        <div>
          <Button variant="outline" onClick={() => nav("/app/encarregados/minhas-solicitacoes")}>
            <ClipboardList className="mr-2 h-4 w-4" />
            Ver minhas solicitações
          </Button>
        </div>
      </Card>

      <ModalNovaVaga
        aberto={modalVaga}
        onFechar={() => setModalVaga(false)}
        onCriada={id => { if (id) setCriadas(c => [...c, id]); }}
      />
    </div>
  );
}
