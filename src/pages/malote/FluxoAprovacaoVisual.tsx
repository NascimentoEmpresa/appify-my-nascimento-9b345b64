import { Fragment } from "react";
import {
  CheckCircle2,
  FilePlus,
  AlertTriangle,
  Hourglass,
  XCircle,
  FileText,
  ShoppingCart,
  ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DespesaEvento, MaloteDespesaRow, StatusDespesa, TipoEvento, aprovadorDoNivel, useNomeUsuario } from "@/hooks/useMaloteDespesa";

// Status que são desvios do caminho feliz — cada um corresponde a um único
// tipo de evento que explica por que a despesa está ali.
const STATUS_DESVIO_EVENTO: Partial<Record<StatusDespesa, TipoEvento>> = {
  necessidade_de_ajuste: "necessidade_de_ajuste",
  solicitacao_reprovada: "solicitacao_reprovada",
  despesa_reprovada: "despesa_reprovada",
  cancelada: "cancelamento",
};

type Estado = "concluida" | "atual" | "futura";
type IconType = React.ComponentType<{ className?: string }>;

interface EtapaTemplate {
  key: string;
  titulo: string;
  icon: IconType;
  tipoEvento?: TipoEvento;
  nivel?: 1 | 2 | 3;
  fallback: string;
}

const EVENTO_META: Record<string, { label: string; icon: IconType; fallback: string }> = {
  criacao: { label: "Criada", icon: FilePlus, fallback: "Registro criado." },
  aguardando_cotacao: { label: "Aguardando cotação", icon: ShoppingCart, fallback: "Aguardando cotações de preço de fornecedores." },
  cotacao_realizada: { label: "Cotação realizada", icon: FileText, fallback: "Cotações recebidas." },
  cotacao_aprovada: { label: "Cotação aprovada", icon: CheckCircle2, fallback: "Cotação vencedora escolhida." },
  solicitacao_aprovada: { label: "Solicitação aprovada", icon: CheckCircle2, fallback: "Solicitação aprovada." },
  solicitacao_reprovada: { label: "Solicitação reprovada", icon: XCircle, fallback: "Solicitação reprovada." },
  despesa_criada: { label: "Despesa criada", icon: FilePlus, fallback: "Despesa criada a partir da solicitação aprovada." },
  aprovacao_nivel: { label: "Aprovado", icon: ClipboardCheck, fallback: "Aprovação realizada." },
  necessidade_de_ajuste: { label: "Necessidade de ajuste", icon: AlertTriangle, fallback: "Ajuste solicitado ao solicitante." },
  aguardando_pagamento: { label: "Aguardando pagamento", icon: Hourglass, fallback: "Aguardando confirmação do pagamento." },
  despesa_paga: { label: "Despesa paga", icon: CheckCircle2, fallback: "Pagamento realizado." },
  despesa_reprovada: { label: "Despesa reprovada", icon: XCircle, fallback: "Despesa reprovada." },
  cancelamento: { label: "Cancelada", icon: XCircle, fallback: "Cancelada." },
};

function corBase(estado: Estado, erro?: boolean) {
  if (erro) return "bg-red-300 dark:bg-red-900";
  if (estado === "concluida") return "bg-emerald-300 dark:bg-emerald-800";
  if (estado === "atual") return "bg-amber-300 dark:bg-amber-800";
  return "bg-border";
}

function sombraBase(estado: Estado, erro?: boolean) {
  if (erro) return "0 0 6px rgba(248,113,113,0.45)";
  if (estado === "concluida") return "0 0 6px rgba(52,211,153,0.45)";
  if (estado === "atual") return "0 0 6px rgba(251,191,36,0.45)";
  return "none";
}

// Trecho do trajeto (horizontal ou vertical) com o reflexo deslizando por
// cima — cor de base conforme o estado, um leve glow pra tirar o ar
// "desenhado a régua", e o brilho contínuo do início ao fim.
function Trilha({ estado, direcao, className, erro }: { estado: Estado; direcao: "x" | "y"; className?: string; erro?: boolean }) {
  return (
    <div
      className={cn("relative overflow-hidden rounded-full", corBase(estado, erro), className)}
      style={{ boxShadow: sombraBase(estado, erro) }}
    >
      <div
        className={cn("absolute inset-0", direcao === "x" ? "animate-flow-glow-x" : "animate-flow-glow-y")}
        style={{
          backgroundImage:
            direcao === "x"
              ? "linear-gradient(to right, transparent 0%, transparent 25%, rgba(255,255,255,0.95) 50%, transparent 75%, transparent 100%)"
              : "linear-gradient(to bottom, transparent 0%, transparent 25%, rgba(255,255,255,0.95) 50%, transparent 75%, transparent 100%)",
          backgroundSize: direcao === "x" ? "60% 100%" : "100% 60%",
          mixBlendMode: "overlay",
        }}
      />
    </div>
  );
}

function No({
  estado,
  icon: Icon,
  titulo,
  sub,
  tooltip,
  erro,
}: {
  estado: Estado;
  icon: IconType;
  titulo: string;
  sub?: string;
  tooltip?: string;
  erro?: boolean;
}) {
  return (
    <div className="relative z-10 flex w-20 shrink-0 flex-col items-center text-center" title={tooltip}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 shadow-sm",
          erro
            ? "bg-red-500 border-red-500 text-white"
            : estado === "concluida"
            ? "bg-emerald-500 border-emerald-500 text-white"
            : estado === "atual"
            ? "bg-amber-400 border-amber-400 text-white ring-4 ring-amber-100 dark:ring-amber-950/40 animate-pulse-soft"
            : "bg-muted border-border text-muted-foreground"
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      <p
        className={cn(
          "mt-1.5 line-clamp-2 text-[11px] leading-tight",
          erro
            ? "font-semibold text-red-700 dark:text-red-400"
            : estado === "concluida"
            ? "font-semibold text-foreground"
            : estado === "atual"
            ? "font-semibold text-amber-700 dark:text-amber-400"
            : "font-medium text-muted-foreground"
        )}
      >
        {titulo}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// Nó de uma etapa do template — se existir um evento real correspondente,
// mostra autor/descrição/data reais (via tooltip); senão, fica no estado
// calculado (concluída sem detalhe, atual ou futura/cinza).
function NoEtapa({ etapa, estado, ev, despesa }: { etapa: EtapaTemplate; estado: Estado; ev: DespesaEvento | undefined; despesa: MaloteDespesaRow }) {
  const { data: nomeAtor } = useNomeUsuario(ev?.ator_user_id);
  if (!ev) {
    return <No estado={estado} icon={etapa.icon} titulo={etapa.titulo} tooltip={etapa.fallback} />;
  }
  const meta = EVENTO_META[ev.tipo_evento];
  let papel = "";
  if (ev.ator_user_id === despesa.created_by) papel = " (Solicitante)";
  else if (ev.nivel) papel = ` (Nível ${ev.nivel})`;
  const tooltip = `${nomeAtor ?? "—"}${papel}\n${ev.descricao || meta?.fallback || etapa.fallback}\n${new Date(ev.created_at).toLocaleString("pt-BR")}`;
  return (
    <No estado="concluida" icon={etapa.icon} titulo={etapa.titulo} sub={new Date(ev.created_at).toLocaleDateString("pt-BR")} tooltip={tooltip} />
  );
}

export function FluxoAprovacaoVisual({ despesa, eventos }: { despesa: MaloteDespesaRow; eventos: DespesaEvento[] }) {
  const nivel2 = aprovadorDoNivel(despesa, 2) != null;
  const nivel3 = aprovadorDoNivel(despesa, 3) != null;

  // Template canônico do fluxo inteiro — sempre mostra todas as etapas
  // mapeadas (Solicitação → Cotação → Despesa → Pagamento), independente
  // de quantas já aconteceram. O que não foi alcançado fica cinza.
  const etapasBase: EtapaTemplate[] =
    despesa.origem === "solicitacao"
      ? [
          { key: "criacao", titulo: "Solicitação criada", icon: FilePlus, tipoEvento: "criacao", fallback: "Solicitação ainda não criada." },
          { key: "solicitacao_aprovada", titulo: "Aprovação inicial", icon: CheckCircle2, tipoEvento: "solicitacao_aprovada", fallback: "Aguardando aprovação inicial." },
          { key: "cotacao_realizada", titulo: "Cotação realizada", icon: FileText, tipoEvento: "cotacao_realizada", fallback: "Aguardando cotações do Suprimentos." },
          { key: "cotacao_aprovada", titulo: "Cotação aprovada", icon: CheckCircle2, tipoEvento: "cotacao_aprovada", fallback: "Aguardando escolha da cotação vencedora." },
          { key: "despesa_criada", titulo: "Despesa criada", icon: FilePlus, tipoEvento: "despesa_criada", fallback: "Aguardando conversão em despesa." },
        ]
      : [{ key: "criacao", titulo: "Despesa criada", icon: FilePlus, tipoEvento: "criacao", fallback: "Despesa ainda não criada." }];

  const etapas: EtapaTemplate[] = [
    ...etapasBase,
    { key: "n1", titulo: "Aprovação Nível 1", icon: ClipboardCheck, tipoEvento: "aprovacao_nivel", nivel: 1, fallback: "Aguardando aprovação Nível 1." },
    ...(nivel2
      ? [{ key: "n2", titulo: "Aprovação Nível 2", icon: ClipboardCheck, tipoEvento: "aprovacao_nivel" as const, nivel: 2 as const, fallback: "Aguardando aprovação Nível 2." }]
      : []),
    ...(nivel3
      ? [{ key: "n3", titulo: "Aprovação Nível 3", icon: ClipboardCheck, tipoEvento: "aprovacao_nivel" as const, nivel: 3 as const, fallback: "Aguardando aprovação Nível 3." }]
      : []),
    { key: "aguardando_pagamento", titulo: "Aguardando pagamento", icon: Hourglass, fallback: "Aguardando confirmação do pagamento." },
    { key: "despesa_paga", titulo: "Despesa paga", icon: CheckCircle2, tipoEvento: "despesa_paga", fallback: "Pagamento ainda não confirmado." },
  ];

  function buscarEvento(etapa: EtapaTemplate): DespesaEvento | undefined {
    if (!etapa.tipoEvento) return undefined;
    return eventos.find((ev) => ev.tipo_evento === etapa.tipoEvento && (etapa.nivel == null || ev.nivel === etapa.nivel));
  }

  function ehAtual(key: string): boolean {
    switch (key) {
      case "solicitacao_aprovada":
        return despesa.status === "aguardando_aprovacao_inicial";
      case "cotacao_realizada":
        return despesa.status === "aguardando_cotacao";
      case "cotacao_aprovada":
        return despesa.status === "cotacao_realizada";
      case "despesa_criada":
        return despesa.status === "cotacao_aprovada";
      case "n1":
        return despesa.status === "pendente_aprovacao" && despesa.nivel_aprovacao_atual === 1;
      case "n2":
        return despesa.status === "pendente_aprovacao" && despesa.nivel_aprovacao_atual === 2;
      case "n3":
        return despesa.status === "pendente_aprovacao" && despesa.nivel_aprovacao_atual === 3;
      case "aguardando_pagamento":
        return despesa.status === "aguardando_pagamento";
      default:
        return false;
    }
  }

  // "Aguardando pagamento" não tem evento próprio (é uma janela de status, não
  // uma ação registrada) — se a despesa já chegou em despesa_paga, essa etapa
  // foi necessariamente cumprida, senão fica presa em "futura" pra sempre.
  const pagamentoConfirmado = despesa.status === "despesa_paga" || eventos.some((ev) => ev.tipo_evento === "despesa_paga");

  const nos: { el: JSX.Element; estado: Estado }[] = etapas.map((etapa) => {
    const ev = buscarEvento(etapa);
    const estado: Estado = ev
      ? "concluida"
      : etapa.key === "aguardando_pagamento" && pagamentoConfirmado
      ? "concluida"
      : ehAtual(etapa.key)
      ? "atual"
      : "futura";
    return { el: <NoEtapa key={etapa.key} etapa={etapa} estado={estado} ev={ev} despesa={despesa} />, estado };
  });

  // Desvio do caminho feliz (ajuste pedido / reprovação / cancelamento) —
  // só aparece se a despesa está ATUALMENTE nesse status; entra como um nó
  // extra no fim, sem tirar as etapas futuras do mapa canônico.
  const tipoDesvioAtual = STATUS_DESVIO_EVENTO[despesa.status];
  const desvio = tipoDesvioAtual ? [...eventos].reverse().find((ev) => ev.tipo_evento === tipoDesvioAtual) : undefined;

  if (desvio) {
    const meta = EVENTO_META[desvio.tipo_evento] ?? { label: desvio.tipo_evento, icon: AlertTriangle, fallback: "" };
    nos.push({
      el: (
        <NoEtapa
          key="desvio"
          etapa={{ key: "desvio", titulo: meta.label, icon: meta.icon, fallback: meta.fallback }}
          estado="atual"
          ev={desvio}
          despesa={despesa}
        />
      ),
      estado: "atual",
    });
  }

  // Estrutura em "snake": preenche da esquerda pra direita até o limite da
  // largura, desce uma linha e volta da direita pra esquerda, repetindo.
  const COLS = 3;
  const linhas: (typeof nos)[] = [];
  for (let i = 0; i < nos.length; i += COLS) linhas.push(nos.slice(i, i + COLS));

  return (
    <div className="space-y-1">
      {linhas.map((linha, li) => {
        const invertida = li % 2 === 1;
        const visiveis = invertida ? [...linha].reverse() : linha;
        return (
          <div key={li}>
            <div className={cn("flex items-start", invertida && "justify-end")}>
              {visiveis.map((no, i) => (
                <Fragment key={i}>
                  {no.el}
                  {i < visiveis.length - 1 && (
                    <Trilha
                      estado={
                        no.estado === "concluida" && visiveis[i + 1].estado === "concluida"
                          ? "concluida"
                          : no.estado === "futura" || visiveis[i + 1].estado === "futura"
                          ? "futura"
                          : "atual"
                      }
                      direcao="x"
                      className="z-0 -mx-5 mt-3.5 h-1.5 flex-1"
                    />
                  )}
                </Fragment>
              ))}
            </div>
            {li < linhas.length - 1 &&
              (() => {
                const fimLinha = linha[linha.length - 1];
                const inicioProxima = linhas[li + 1][0];
                const estadoVertical: Estado =
                  fimLinha.estado === "concluida" && inicioProxima.estado === "concluida"
                    ? "concluida"
                    : fimLinha.estado === "futura" || inicioProxima.estado === "futura"
                    ? "futura"
                    : "atual";
                return (
                  <div className={cn("flex", invertida ? "justify-start" : "justify-end")}>
                    <div className="flex w-20 justify-center">
                      <Trilha estado={estadoVertical} direcao="y" className="-my-1.5 h-6 w-1.5" />
                    </div>
                  </div>
                );
              })()}
          </div>
        );
      })}
    </div>
  );
}
