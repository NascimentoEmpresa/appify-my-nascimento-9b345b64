import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMaloteSetoresVisiveis } from "@/hooks/useMaloteDespesa";
import { useLigacoesAdministrativoClassificacao } from "@/hooks/useMaloteAdministrativoClassificacaoLink";
import { useClassificacoesOrcamentoAdmin } from "@/hooks/usePlanejamentoOrcamentario";
import { classificacaoVisivelPorSetor } from "@/pages/malote/orcamentoUtils";

// SIS-2026-0265 (Iury): "as classificações administrativas do financeiro só
// podem ser vistas por eles" — telas de Orçamento (Orçamento Geral,
// Orçamento Administrativo, Classificações Malote, Detalhe Orçamento) hoje
// mostram TODAS as Classificações Malote tipo "administrativo" pra
// qualquer usuário autenticado (a policy da tabela é `SELECT USING (true)`).
//
// Decisão explícita (confirmada com o usuário, achado real durante o
// design): NÃO dá pra resolver isso restringindo a RLS de
// `planejamento_orcamentario_classificacao` direto — essa MESMA tabela é a
// "Classificação Malote" referenciada por `malote_despesa.classificacao_id`
// (nome, aprovadores, tudo) e por `planejamento_orcamentario` (usado no
// cálculo de alçada/estouro de orçamento, SIS-2026-0261) — restringir a
// tabela quebraria Aprovações/DespesaVisualizar/a trava de estouro pra
// QUALQUER despesa de uma Classificação do Financeiro vista por quem não é
// do Financeiro (ex.: um aprovador N2 fora do Financeiro aprovando uma
// despesa financeira deixaria de ver o nome da Classificação e o orçado
// pra decidir se escala). Por isso a restrição aqui é só de UI (filtra o
// que aparece nas telas de Orçamento), reaproveitando o MESMO recorte de
// setor já usado em Aprovações/Meus Itens (`malote_setor_visivel_usuario`,
// SIS-2026-0216/0224) — mas com o FALLBACK INVERTIDO: lá, "sem recorte
// configurado" = vê tudo (silêncio = sem restrição de setor). Aqui, uma
// Classificação tipo administrativo COM setor_responsavel definido só é
// visível pra quem tem esse setor no recorte — mesmo sem nenhum recorte
// configurado. Classificação sem setor_responsavel (a maioria) continua
// visível a todos. É a única forma de "só financeiro vê financeiro"
// funcionar de verdade — se o fallback fosse "sem recorte = vê tudo" como
// em Aprovações, qualquer usuário sem nenhum recorte configurado (a
// maioria hoje) veria o Financeiro do mesmo jeito que vê hoje.
export function useClassificacaoMaloteVisivel() {
  const { user } = useAuth();
  const { data: setoresVisiveis = [] } = useMaloteSetoresVisiveis(user?.id);
  return (c: { tipo?: string | null; setor_responsavel?: string | null } | null | undefined) =>
    classificacaoVisivelPorSetor(c, setoresVisiveis);
}

// Variante pra telas que trabalham com "Classificação Administrativo" (o
// catálogo simples de `malote_classificacao_administrativo`, usado em
// `planejamento_orcamentario.classificacao_id` — ex.: OrcamentoAdministrativo.tsx)
// em vez da Classificação Malote diretamente. Resolve o setor_responsavel
// via a ligação (`malote_administrativo_classificacao_link`) — uma
// Classificação Administrativo sem ligação nenhuma (não vinculada a
// nenhuma Classificação Malote) fica visível a todos, mesmo critério de
// "sem setor definido = aberto".
// Classificação Malote (com tipo/setor_responsavel) ligada a cada
// Classificação Administrativo — base compartilhada por
// useClassificacaoAdministrativaVisivel (decide se aparece) e
// useSetorResponsavelDaAdministrativa (decide o que mostrar no selo "🔒
// Financeiro", ver SelоRestritoBadge).
function useClassificacaoMaloteDaAdministrativa() {
  const { data: ligacoes = [] } = useLigacoesAdministrativoClassificacao();
  const { data: classificacoesMalote = [] } = useClassificacoesOrcamentoAdmin();

  return useMemo(() => {
    const maloteMap = new Map(classificacoesMalote.map((c) => [c.id, c]));
    const map = new Map<string, { tipo?: string | null; setor_responsavel?: string | null }>();
    for (const l of ligacoes) {
      const malote = maloteMap.get(l.classificacao_malote_id);
      if (malote) map.set(l.classificacao_administrativa_id, malote);
    }
    return map;
  }, [ligacoes, classificacoesMalote]);
}

export function useClassificacaoAdministrativaVisivel() {
  const classificacaoMaloteVisivel = useClassificacaoMaloteVisivel();
  const setorPorAdministrativaId = useClassificacaoMaloteDaAdministrativa();

  return function administrativaVisivel(administrativaId: string): boolean {
    const malote = setorPorAdministrativaId.get(administrativaId);
    return classificacaoMaloteVisivel(malote);
  };
}

// SIS-2026-0265 (complemento, pedido do usuário): "algo informando que
// financeiro está visualizando" — quem vê a classificação (porque tem o
// setor liberado) não tinha nenhum sinal de que aquilo é restrito. Resolve
// o setor_responsavel de uma Classificação Administrativo (via a ligação),
// pro selo mostrado em OrcamentoAdministrativo.tsx.
export function useSetorResponsavelDaAdministrativa() {
  const setorPorAdministrativaId = useClassificacaoMaloteDaAdministrativa();
  return function setorDaAdministrativa(administrativaId: string): string | null {
    return setorPorAdministrativaId.get(administrativaId)?.setor_responsavel ?? null;
  };
}
