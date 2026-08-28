import { useMemo } from "react";
import { useClassificacoesOrcamentoAdmin, usePlanejamentosOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useLigacoesAdministrativoClassificacao } from "@/hooks/useMaloteAdministrativoClassificacaoLink";
import { useOrcamentoContratos, computarGruposContrato } from "@/hooks/useOrcamentoContratos";
import { useContratosERP } from "@/hooks/useContratosERP";
import { usePlanilhaCustos, fimDoMes } from "@/hooks/usePlanilhaCusto";
import { useLigacoesLicitacaoClassificacao } from "@/hooks/useMaloteLicitacaoClassificacaoLink";
import { getStatusVigencia } from "@/pages/malote/orcamentoUtils";

// Resolve o Orçado de UMA Classificação do Malote num Ano/Mês — mesma
// regra usada em OrcamentoGeral.tsx/DetalheOrcamento.tsx (SIS-2026-0168),
// extraída aqui pra ser reaproveitada também na alçada de aprovação
// (SIS-2026-0132 — % de alçada do aprovador, antes nunca consumido).
//
// Tipo Contrato: soma das rubricas ligadas daquele contrato. Tipo
// Administrativo: soma de planejamento_orcamentario cuja vigência cobre o
// período. Sem dado suficiente pra resolver (classificação não
// encontrada/ainda carregando, ou contrato não informado numa
// Classificação tipo Contrato), retorna null — "orçado desconhecido",
// não "zero".
export function useOrcadoClassificacao(empresaId: string | null | undefined, anoMes: string) {
  const { data: classificacoes = [], isLoading: carregandoClassificacoes } = useClassificacoesOrcamentoAdmin();
  const { data: orcamentosAdm = [], isLoading: carregandoAdm } = usePlanejamentosOrcamento(empresaId);
  // SIS-2026-0212: faltava no isLoading agregado — enquanto essa ligação
  // ainda não carregava, maloteIdPorAdministrativa ficava vazio e o
  // resolver() de tipo administrativo sempre devolvia 0 (nenhuma linha de
  // orçamento batia), mesmo com isLoading=false liberando o botão Aprovar.
  const { data: ligacoesAdm = [], isLoading: carregandoLigacoes } = useLigacoesAdministrativoClassificacao();
  const { data: gruposContrato = [], isLoading: carregandoContrato } = useOrcamentoContratos(anoMes);

  const classificacoesPorId = useMemo(() => new Map(classificacoes.map((c) => [c.id, c])), [classificacoes]);
  const maloteIdPorAdministrativa = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of ligacoesAdm) map.set(l.classificacao_administrativa_id, l.classificacao_malote_id);
    return map;
  }, [ligacoesAdm]);
  const referenciaPeriodo = useMemo(() => fimDoMes(anoMes), [anoMes]);

  function resolver(classificacaoId: string | null | undefined, contratoId: string | null | undefined): number | null {
    if (!classificacaoId) return null;
    const classificacao = classificacoesPorId.get(classificacaoId);
    if (!classificacao) return null;

    if (classificacao.tipo === "contrato") {
      if (!contratoId) return null;
      const grupo = gruposContrato.find((g) => g.contrato.id === contratoId);
      if (!grupo) return 0;
      return grupo.rubricas.filter((r) => r.classificacaoMaloteId === classificacaoId).reduce((s, r) => s + r.valor, 0);
    }

    let soma = 0;
    for (const o of orcamentosAdm) {
      if (maloteIdPorAdministrativa.get(o.classificacao_id) !== classificacaoId) continue;
      if (getStatusVigencia(o.inicio_vigencia, o.fim_vigencia, referenciaPeriodo) !== "na_vigencia") continue;
      soma += Number(o.valor) || 0;
    }
    return soma;
  }

  return { resolver, isLoading: carregandoClassificacoes || carregandoAdm || carregandoLigacoes || carregandoContrato };
}

// SIS-2026-0261 (Iury): a alçada de aprovação de uma despesa PARCELADA
// precisa checar o Orçado de CADA parcela no mês do seu próprio vencimento
// — não só da parcela 1 (decisão anterior, de SIS-2026-0223, partia da
// premissa "as parcelas sempre teriam orçamento", que na prática não se
// confirmou: uma parcela mais à frente pode estourar mesmo com a 1ª
// dentro). Isso exige resolver o Orçado de N meses diferentes ao mesmo
// tempo — número de parcelas é variável, então não dá pra instanciar
// useOrcadoClassificacao (que trava um único `anoMes`) uma vez por parcela
// sem violar as regras de hooks.
//
// Os dados de entrada (contratos, planilha de custo, planejamento
// administrativo, ligações) já vêm carregados por inteiro independente do
// mês — só o cálculo em cima deles é por período (mesma observação que
// levou a extrair computarGruposContrato). Por isso dá pra expor um único
// resolver(classificacaoId, contratoId, anoMes) que aceita qualquer mês,
// sem custo extra de rede: react-query já compartilha o cache das mesmas
// queries usadas por useOrcadoClassificacao/useOrcamentoContratos noutros
// pontos da tela.
export function useOrcadoClassificacaoMultiMes(empresaId: string | null | undefined) {
  const { data: classificacoes = [], isLoading: carregandoClassificacoes } = useClassificacoesOrcamentoAdmin();
  const { data: orcamentosAdm = [], isLoading: carregandoAdm } = usePlanejamentosOrcamento(empresaId);
  const { data: ligacoesAdm = [], isLoading: carregandoLigacoes } = useLigacoesAdministrativoClassificacao();
  const { data: contratos = [], isLoading: carregandoContratos } = useContratosERP();
  const { data: planilha = [], isLoading: carregandoPlanilha } = usePlanilhaCustos();
  const { data: ligacoesLicitacao = [], isLoading: carregandoLigacoesLicitacao } = useLigacoesLicitacaoClassificacao();

  const classificacoesPorId = useMemo(() => new Map(classificacoes.map((c) => [c.id, c])), [classificacoes]);
  const maloteIdPorAdministrativa = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of ligacoesAdm) map.set(l.classificacao_administrativa_id, l.classificacao_malote_id);
    return map;
  }, [ligacoesAdm]);
  const maloteIdPorCampo = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of ligacoesLicitacao) map.set(l.campo_planilha_custo, l.classificacao_malote_id);
    return map;
  }, [ligacoesLicitacao]);
  // Cache por mês (não por classificação/contrato) — o custo de recalcular
  // TODOS os contratos é o mesmo pra resolver 1 ou N classificações daquele
  // mês, então vale a pena guardar o resultado inteiro do mês na 1ª vez que
  // ele é pedido, em vez de recalcular a cada parcela que cai no mesmo mês.
  const cacheGruposPorMes = useMemo(() => new Map<string, ReturnType<typeof computarGruposContrato>>(), [contratos, planilha, maloteIdPorCampo]);

  function resolver(classificacaoId: string | null | undefined, contratoId: string | null | undefined, anoMes: string): number | null {
    if (!classificacaoId) return null;
    const classificacao = classificacoesPorId.get(classificacaoId);
    if (!classificacao) return null;

    if (classificacao.tipo === "contrato") {
      if (!contratoId) return null;
      let grupos = cacheGruposPorMes.get(anoMes);
      if (!grupos) {
        grupos = computarGruposContrato(contratos, planilha, maloteIdPorCampo, anoMes);
        cacheGruposPorMes.set(anoMes, grupos);
      }
      const grupo = grupos.find((g) => g.contrato.id === contratoId);
      if (!grupo) return 0;
      return grupo.rubricas.filter((r) => r.classificacaoMaloteId === classificacaoId).reduce((s, r) => s + r.valor, 0);
    }

    const referenciaPeriodo = fimDoMes(anoMes);
    let soma = 0;
    for (const o of orcamentosAdm) {
      if (maloteIdPorAdministrativa.get(o.classificacao_id) !== classificacaoId) continue;
      if (getStatusVigencia(o.inicio_vigencia, o.fim_vigencia, referenciaPeriodo) !== "na_vigencia") continue;
      soma += Number(o.valor) || 0;
    }
    return soma;
  }

  return {
    resolver,
    isLoading:
      carregandoClassificacoes || carregandoAdm || carregandoLigacoes || carregandoContratos || carregandoPlanilha || carregandoLigacoesLicitacao,
  };
}
