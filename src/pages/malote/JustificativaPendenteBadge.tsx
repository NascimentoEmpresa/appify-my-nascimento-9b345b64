import { AlertTriangle, Bell } from "lucide-react";
import { MaloteDespesaRow, Parcela, RateioLinha, useNomeUsuario, useRateioLinhasEParcelas } from "@/hooks/useMaloteDespesa";
import { useOrcadoClassificacaoMultiMes } from "@/hooks/useOrcadoClassificacao";
import { useUtilizadoOrcamento } from "@/hooks/useUtilizadoOrcamento";
import { useAnalistasDosContratos } from "@/hooks/useMaloteAnalistas";
import { montarCombosAlcada, encontrarComboQueEstouraAlcada } from "./orcamentoUtils";

// Nome completo fica longo demais pra um badge (ex.: "Iury de Jesus Silva")
// — mostra só o primeiro nome + inicial do último sobrenome ("Iury S.").
// Nome sem espaço (ex.: e-mail, quando profiles.display_name está vazio)
// fica como está.
export function abreviarNome(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  if (partes.length < 2) return nome;
  const ultimo = partes[partes.length - 1];
  return `${partes[0]} ${ultimo[0].toUpperCase()}.`;
}

// SIS-2026-0261 (Iury, ideia dele): sinaliza em Aprovações/Meus Itens do
// Malote quando alguma linha do Rateio está com o orçado estourado e ainda
// SEM justificativa do analista (Classificação tipo contrato) ou do
// solicitante (tipo administrativo) — antes disso só aparecia dentro da
// própria despesa (aba Rateio), então ninguém via de fora que o processo
// estava parado esperando essa justificativa.
//
// Achado real do Iury num teste (bug que eu mesmo introduzi na 1ª versão):
// quando a despesa já está explodida por parcela nas tabelas (Aprovações e
// Meus Itens mostram 1 linha por parcela a partir de aguardando_pagamento,
// ver STATUS_COM_PARCELA_VISIVEL), o badge tem que refletir SÓ a parcela
// daquela linha específica — mostrar "pendente" em TODAS as parcelas (1/4,
// 2/4, 3/4, 4/4) só porque a 3ª estourou é confuso e errado. Por isso o
// componente recebe `parcela` (a mesma do `ItemLinhaMalote` da linha) e,
// quando ela existe, checa só essa parcela — sem ela (despesa ainda não
// explodida, ex. pendente_aprovacao, ou não parcelada), cai pra checar
// tudo que a despesa tem (todas as parcelas futuras, ou o único mês).
//
// Achado 2 (pergunta do Iury): Aprovações do Malote é uma lista GERAL —
// qualquer um com visibilidade vê todas as despesas, não só o que é
// responsabilidade dele. Por isso o badge também mostra o NOME de quem
// precisa justificar (Analista do contrato via RPC
// malote_analistas_dos_contratos, ou o Solicitante quando a linha é de
// Classificação administrativa) — sem isso, dava pra saber que tinha
// pendência mas não quem cobrar.
export function JustificativaPendenteBadge({
  despesa,
  parcela,
  variant = "full",
}: {
  despesa: MaloteDespesaRow;
  parcela?: Parcela | null;
  // SIS-2026-0288-ajuste (Iury/usuário): Aprovações do Malote tinha uma
  // coluna "Justificativa" quase sempre vazia (poucas linhas têm
  // pendência) — "icon" troca o texto por só o sino/alerta com tooltip,
  // pra virar um indicador inline em vez de coluna própria. "full" (default)
  // mantém o comportamento original (ícone + nomes), usado em Meus Itens.
  variant?: "full" | "icon";
}) {
  const limitePct = despesa.classificacao?.limite_justificativa_pct ?? null;
  const { data } = useRateioLinhasEParcelas(despesa.id, !!despesa.parcelado);
  const { resolver: resolverOrcadoMultiMes } = useOrcadoClassificacaoMultiMes(despesa.empresa_id);
  const { data: utilizadoLinhasGlobal = [] } = useUtilizadoOrcamento();
  const { data: nomeSolicitante } = useNomeUsuario(despesa.created_by);

  const linhasPendentes = (() => {
    if (limitePct == null || !data?.linhas?.length) return [];
    const anoMesDespesa = despesa.competencia ? despesa.competencia.slice(0, 7) : despesa.data_pagamento?.slice(0, 7) ?? "";
    const parcelasParaChecar: Parcela[] = parcela ? [parcela] : despesa.parcelado ? data.parcelas : [];

    function utilizadoAntesNoMes(contratoId: string | null, mes: string): number {
      return utilizadoLinhasGlobal.reduce((soma, u) => {
        if (u.despesa_id === despesa.id) return soma;
        if (u.classificacao_id !== despesa.classificacao_id) return soma;
        if (!u.competencia || u.competencia.slice(0, 7) !== mes) return soma;
        if ((u.contrato_id ?? null) !== contratoId) return soma;
        return soma + (Number(u.valor) || 0);
      }, 0);
    }

    return data.linhas.filter((linha) => {
      if (linha.justificativa_texto) return false;
      const combos = montarCombosAlcada({
        parcelado: parcelasParaChecar.length > 0,
        parcelas: parcelasParaChecar,
        linhas: [linha],
        valorTotalDespesa: despesa.valor_total,
        anoMesDespesa,
        fatorValorAprovado: 1,
      });
      return !!encontrarComboQueEstouraAlcada(
        combos,
        limitePct,
        (contratoId, mes) => resolverOrcadoMultiMes(despesa.classificacao_id, contratoId, mes),
        utilizadoAntesNoMes
      );
    });
  })();

  const contratoIdsPendentes = Array.from(
    new Set(linhasPendentes.map((l: RateioLinha) => l.contrato_id).filter((id): id is string => !!id))
  );
  const { data: analistasPorContrato } = useAnalistasDosContratos(contratoIdsPendentes);

  if (linhasPendentes.length === 0) return null;

  const responsaveis = Array.from(
    new Set(
      linhasPendentes.flatMap((linha) => {
        if (linha.contrato_id) {
          const nomes = analistasPorContrato?.get(linha.contrato_id);
          return nomes && nomes.length > 0 ? nomes : ["Analista não definido"];
        }
        return [nomeSolicitante ?? "Solicitante"];
      })
    )
  );

  const titulo = `Aguardando justificativa de: ${responsaveis.join(", ")}`;

  if (variant === "icon") {
    // Pedido do usuário: "bem mais evidente" — trocado de ícone solto pra
    // um círculo cheio (fundo âmbar sólido, sino branco), do tamanho de um
    // badge de verdade, não um detalhe discreto que passa despercebido.
    return (
      <span
        className="inline-flex h-6 w-6 shrink-0 animate-pulse items-center justify-center rounded-full bg-amber-500 text-white shadow-[0_0_6px_rgba(245,158,11,0.7)] dark:bg-amber-600"
        title={titulo}
      >
        <Bell className="h-3.5 w-3.5 shrink-0 fill-white" />
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400"
      title={titulo}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 animate-pulse drop-shadow-[0_0_3px_rgba(245,158,11,0.8)]" />
      {responsaveis.map(abreviarNome).join(", ")}
    </span>
  );
}
