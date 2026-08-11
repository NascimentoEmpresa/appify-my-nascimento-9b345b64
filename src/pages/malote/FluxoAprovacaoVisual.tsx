import { CheckCircle2, FilePlus, AlertTriangle, Users, Hourglass, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MaloteDespesaRow } from "@/hooks/useMaloteDespesa";

type EstadoEtapa = "concluida" | "atual" | "pendente";

interface Etapa {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  estado: EstadoEtapa;
  sub?: string;
}

const ESTILO: Record<EstadoEtapa, { circulo: string; linha: string; texto: string }> = {
  concluida: {
    circulo: "bg-emerald-500 border-emerald-500 text-white",
    linha: "bg-emerald-500",
    texto: "text-emerald-700 dark:text-emerald-400",
  },
  atual: {
    circulo: "bg-amber-400 border-amber-400 text-white ring-4 ring-amber-100 dark:ring-amber-950/40",
    linha: "bg-border",
    texto: "text-amber-700 dark:text-amber-400 font-medium",
  },
  pendente: {
    circulo: "bg-muted border-border text-muted-foreground",
    linha: "bg-border",
    texto: "text-muted-foreground",
  },
};

export function FluxoAprovacaoVisual({ despesa }: { despesa: MaloteDespesaRow }) {
  const isErro = despesa.status === "despesa_reprovada" || despesa.status === "cancelada" || despesa.status === "solicitacao_reprovada";
  const incluirSolicitacao = despesa.origem === "solicitacao";

  function estadoDe(key: string): EstadoEtapa {
    if (isErro) {
      return key === "solicitacao_aprovada" || key === "despesa_criada" ? "concluida" : "pendente";
    }
    switch (key) {
      case "solicitacao_aprovada":
      case "despesa_criada":
        return "concluida";
      case "necessidade_de_ajuste":
        return despesa.status === "necessidade_de_ajuste" ? "atual" : "pendente";
      case "pendente_aprovacao":
        if (despesa.status === "pendente_aprovacao" || despesa.status === "necessidade_de_ajuste") return "atual";
        if (despesa.status === "aguardando_pagamento" || despesa.status === "despesa_paga") return "concluida";
        return "pendente";
      case "aguardando_pagamento":
        if (despesa.status === "aguardando_pagamento") return "atual";
        if (despesa.status === "despesa_paga") return "concluida";
        return "pendente";
      case "despesa_paga":
        return despesa.status === "despesa_paga" ? "concluida" : "pendente";
      default:
        return "pendente";
    }
  }

  const etapas: Etapa[] = [
    ...(incluirSolicitacao
      ? [
          { key: "solicitacao_aprovada", label: "Solicitação aprovada", icon: CheckCircle2, estado: estadoDe("solicitacao_aprovada") },
          { key: "despesa_criada", label: "Despesa criada", icon: FilePlus, estado: estadoDe("despesa_criada") },
        ]
      : []),
    { key: "necessidade_de_ajuste", label: "Necessidade de ajuste", icon: AlertTriangle, estado: estadoDe("necessidade_de_ajuste") },
    {
      key: "pendente_aprovacao",
      label: "Pendente aprovação",
      icon: Users,
      estado: estadoDe("pendente_aprovacao"),
      sub: despesa.status === "pendente_aprovacao" && despesa.nivel_aprovacao_atual ? `N${despesa.nivel_aprovacao_atual}` : undefined,
    },
    { key: "aguardando_pagamento", label: "Aguardando pagamento", icon: Hourglass, estado: estadoDe("aguardando_pagamento") },
    { key: "despesa_paga", label: "Despesa paga", icon: CheckCircle2, estado: estadoDe("despesa_paga") },
  ];

  return (
    <div className="space-y-2">
      {isErro && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400 rounded-md bg-red-50 dark:bg-red-950/20 px-2.5 py-1.5 w-fit">
          <XCircle className="h-3.5 w-3.5" />
          {despesa.status === "cancelada" ? "Despesa cancelada" : despesa.status === "solicitacao_reprovada" ? "Solicitação reprovada" : "Despesa reprovada"}
        </div>
      )}
      <div className="overflow-x-auto">
        <div className="flex items-start min-w-max px-1 py-2">
          {etapas.map((etapa, i) => {
            const estilo = ESTILO[etapa.estado];
            const Icon = etapa.icon;
            return (
              <div key={etapa.key} className="flex items-start">
                <div className="flex flex-col items-center w-24">
                  <div className={cn("h-9 w-9 rounded-full border-2 flex items-center justify-center shrink-0", estilo.circulo)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <p className={cn("text-[11px] text-center mt-1.5 leading-tight", estilo.texto)}>{etapa.label}</p>
                  {etapa.sub && <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 mt-0.5">{etapa.sub}</span>}
                </div>
                {i < etapas.length - 1 && <div className={cn("h-0.5 w-8 mt-[18px] shrink-0", ESTILO[etapa.estado].linha)} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
