import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { BookOpen, ClipboardList, CalendarRange, Headset, Car, UserPlus, GraduationCap, ArrowRight, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { usePermissoes } from "@/context/PermissoesContext";

interface Servico {
  to: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  /**
   * Menu de `app_menu` que libera o card. Só os cards novos têm: os antigos
   * são serviços de todo mundo e ficam sem gate, como sempre estiveram.
   */
  menu?: string;
}

// Serviços disponíveis na Central de Serviços (cada um é um card que leva à sua tela).
const servicos: Servico[] = [
  {
    to: "/app/central-servicos/orientacoes-juridicas",
    icon: BookOpen,
    title: "Orientações Jurídicas",
    desc: "Biblioteca de perguntas e respostas jurídicas publicadas pelo Jurídico. Consulte as dúvidas mais comuns ou envie a sua.",
  },
  // Denúncias saíram daqui: viraram o módulo Comitê de Ética.
  {
    to: "/app/central-servicos/formularios",
    icon: ClipboardList,
    title: "Nascimento Formulários",
    desc: "Crie formulários e pesquisas com vários tipos de pergunta e imagens, publique numa URL com prazo definido e acompanhe as respostas.",
  },
  {
    to: "/app/central-servicos/chamados",
    icon: Headset,
    title: "Chamados de Sistemas",
    desc: "Abra chamados de ajuste, correção ou dúvida sobre os sistemas do ERP e acompanhe o andamento. O time de Sistemas distribui e resolve.",
  },
  {
    to: "/app/central-servicos/reunioes",
    icon: CalendarRange,
    title: "Agenda de Reunião",
    desc: "Agende reuniões, registre atas com anexos e assinaturas e exporte para o calendário ou em PDF.",
  },
  {
    to: "/app/central-servicos/solicitar-vaga",
    icon: UserPlus,
    title: "Solicitar Vaga",
    desc: "Abra uma vaga para o Recrutamento em três etapas. Vaga do escritório pode ser preenchida à mão, sem copiar o posto de um colaborador.",
    menu: "central_servicos_solicitar_vaga",
  },
  {
    to: "/app/central-servicos/treinamentos",
    icon: GraduationCap,
    title: "Treinamentos",
    desc: "Os treinamentos do ERP em vídeo, com material de apoio e prova. A mesma grade que o encarregado vê, com a sua conclusão e nota registradas.",
    menu: "central_servicos_treinamentos",
  },
  {
    to: "/app/central-servicos/veiculos",
    icon: Car,
    title: "Agendamento de Veículos",
    desc: "Reserve um carro da frota por data e turno, veja quem está com cada veículo e quais estão em manutenção. A frota vem do módulo de Patrimônio.",
  },
];

export default function CentralServicos() {
  const { can } = usePermissoes();
  // Card sem acesso não aparece. Mostrar a porta e negar a entrada só ensina
  // o usuário a pedir permissão para uma tela que ele talvez nem precise.
  const visiveis = servicos.filter(s => !s.menu || can("visualizar", undefined, s.menu));

  return (
    <div>
      <PageHeader
        title="Central de Serviços"
        subtitle="Atendimento e orientações ao colaborador."
        module="Central de Serviços"
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visiveis.map((s) => (
          <Link key={s.to} to={s.to} className="group">
            <Card className="flex h-full flex-col gap-3 p-5 transition-all hover:border-primary/40 hover:shadow-md">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <s.icon className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  {s.title}
                  <ArrowRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
