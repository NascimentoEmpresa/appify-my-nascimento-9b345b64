import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableHeadOrdenavel } from "@/components/ui/table-head-ordenavel";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { CheckCircle2, ChevronLeft, ChevronRight, Hourglass, AlertTriangle, XCircle, FileText, Users, User, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  useItensAprovacoesMalote,
  useNomeUsuario,
  useEmpresasGrupo,
  useContratosAtivos,
  useClassificacaoIdsPorDespesaRateio,
  useEmpresaPrimeiraLinhaRateio,
  nomesAprovadorNivel,
  souAprovadorDoNivel,
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
  NIVEL_APROVACAO_BADGE_CLASS,
  STATUS_FASE_SOLICITACAO,
  StatusDespesa,
  ItemLinhaMalote,
  MaloteDespesaRow,
  TipoSolicitacao,
} from "@/hooks/useMaloteDespesa";
import { useClassificacoesOrcamentoAdmin } from "@/hooks/usePlanejamentoOrcamentario";
import { useMinhasDespesasComJustificativaPendente } from "@/hooks/useMaloteJustificativaAnalista";
import { useOrdenacaoTabela } from "@/hooks/useOrdenacaoTabela";
import { ordenarPor } from "@/lib/ordenarTabela";
import { JustificativaPendenteBadge, abreviarNome } from "./JustificativaPendenteBadge";

// SIS-2026-0316: colunas ordenáveis. Fora: Empresa/Contrato (fica só como
// Empresa pra ordenar, o badge continua mostrando os dois), Parcela
// (composto X/Y), Solicitante (nome resolvido por hook próprio dentro de
// cada linha, não dá pra acessar de forma síncrona aqui) e o sino de
// Justificativa (não é dado ordenável).
type ColunaAprovacoes = "tipo" | "numero" | "empresa" | "nome" | "classificacao" | "valor" | "data_pagamento" | "status" | "excecao" | "atualizacao";

function dataPagamentoDeItem(item: ItemLinhaMalote): string | null {
  return item.parcela ? item.parcela.data_pagamento_real ?? item.parcela.data_vencimento : item.despesa.data_pagamento;
}

function valorDeItem(item: ItemLinhaMalote): number {
  return Number(item.parcela ? item.parcela.valor : item.despesa.valor_total);
}

// SIS-2026-0223: despesa parcelada vira N linhas (1 por parcela) a partir de
// "aguardando_pagamento" — o status exibido/contado por linha passa a ser o
// da PARCELA (paga/pendente), não o bruto da despesa, senão as N linhas
// mostrariam sempre o mesmo status errado (todas "aguardando pagamento" até
// a despesa inteira virar paga, ou todas "paga" já na primeira).
function statusEfetivo(item: ItemLinhaMalote): StatusDespesa {
  // pronto_para_pagar/ajuste_pagamento continuam sendo decisão sobre a
  // despesa inteira (parcela só tem pendente/paga) — só aguardando_pagamento
  // e despesa_paga refletem o progresso real de CADA parcela.
  if (item.parcela && (item.despesa.status === "aguardando_pagamento" || item.despesa.status === "despesa_paga")) {
    return item.parcela.status === "paga" ? "despesa_paga" : "aguardando_pagamento";
  }
  return item.despesa.status;
}

const TIPO_LABEL: Record<TipoSolicitacao, string> = {
  administrativo: "Administrativo",
  contrato: "Contrato",
  dispensa_cotacao: "Dispensa de cotação",
};

const PAGE_SIZE = 10;

interface TileInfo {
  label: string;
  status?: StatusDespesa;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  cor: "amber" | "sky" | "violet" | "emerald" | "red" | "blue";
  // SIS-2026-0285: "Aguardando minha aprovação" e "Pendente aprovação
  // (outros níveis)" são o MESMO status (pendente_aprovacao) — sem esses
  // overrides, clicar no tile sem status próprio ("outros níveis") só
  // resetava o filtro pra "Todas", e o tile "minha aprovação" filtrava
  // pendente_aprovacao inteiro, não só o que é meu de fato.
  selecionado?: boolean;
  onClick?: () => void;
}

const COR_TILE: Record<TileInfo["cor"], string> = {
  amber: "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  sky: "bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400",
  violet: "bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
  emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
  red: "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400",
  blue: "bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
};

const COR_TILE_CARD: Record<TileInfo["cor"], string> = {
  amber: "border-amber-200 bg-amber-50/70 hover:bg-amber-100/70 dark:border-amber-900 dark:bg-amber-950/20 dark:hover:bg-amber-950/30",
  sky: "border-sky-200 bg-sky-50/70 hover:bg-sky-100/70 dark:border-sky-900 dark:bg-sky-950/20 dark:hover:bg-sky-950/30",
  violet: "border-violet-200 bg-violet-50/70 hover:bg-violet-100/70 dark:border-violet-900 dark:bg-violet-950/20 dark:hover:bg-violet-950/30",
  emerald: "border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/70 dark:border-emerald-900 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30",
  red: "border-red-200 bg-red-50/70 hover:bg-red-100/70 dark:border-red-900 dark:bg-red-950/20 dark:hover:bg-red-950/30",
  blue: "border-blue-200 bg-blue-50/70 hover:bg-blue-100/70 dark:border-blue-900 dark:bg-blue-950/20 dark:hover:bg-blue-950/30",
};

const COR_TILE_TEXTO: Record<TileInfo["cor"], string> = {
  amber: "text-amber-700 dark:text-amber-400",
  sky: "text-sky-700 dark:text-sky-400",
  violet: "text-violet-700 dark:text-violet-400",
  emerald: "text-emerald-700 dark:text-emerald-400",
  red: "text-red-700 dark:text-red-400",
  blue: "text-blue-700 dark:text-blue-400",
};

// SIS-2026-0288-ajuste (Iury): "cada empresa tendo um badge meio único, com
// coloração diferente" — paleta fixa de cores, escolhida por hash do
// empresa_id (estável entre renders/sessões, sem precisar gravar cor em
// tabela nova). Mesmo badge é reaproveitado quando a linha tem contrato: aí
// a cor continua vindo da empresa, só que o nome do contrato passa a ser o
// texto em destaque e a empresa vira o "detalhe menor" — mesmo espírito do
// badge de aprovador (rótulo pequeno em cima, nome forte embaixo).
const EMPRESA_BADGE_PALETTE = [
  "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-400",
  "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400",
  "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-400",
  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400",
  "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400",
  "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-400",
  "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-400",
  "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-400",
];

function corEmpresa(empresaId: string | null | undefined): string {
  if (!empresaId) return "border-border bg-muted/40 text-muted-foreground";
  let hash = 0;
  for (let i = 0; i < empresaId.length; i++) hash = (hash * 31 + empresaId.charCodeAt(i)) >>> 0;
  return EMPRESA_BADGE_PALETTE[hash % EMPRESA_BADGE_PALETTE.length];
}

function EmpresaContratoBadge({
  nomeEmpresa,
  nomeContrato,
  empresaId,
}: {
  nomeEmpresa?: string;
  nomeContrato?: string;
  empresaId?: string | null;
}) {
  if (!nomeEmpresa && !nomeContrato) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div
      className={cn(
        "inline-flex max-w-[100px] flex-col items-center gap-0.5 rounded-md border px-2 py-1 text-center leading-none",
        corEmpresa(empresaId)
      )}
    >
      {nomeContrato ? (
        <>
          <span className="text-xs font-bold leading-tight">{nomeContrato}</span>
          {nomeEmpresa && (
            <span className="text-[9px] font-medium uppercase leading-tight tracking-wide opacity-70">{nomeEmpresa}</span>
          )}
        </>
      ) : (
        <span className="text-xs font-bold leading-tight">{nomeEmpresa}</span>
      )}
    </div>
  );
}

// SIS-2026-0281: botões do filtro "Nível de aprovação" — mesma cor de cada
// nível usada no badge da tabela (NIVEL_APROVACAO_BADGE_CLASS), só que num
// tom mais claro quando inativo (pra já dar destaque sem competir com o
// badge de verdade) e mais saturado quando o filtro está ativo.
const NIVEL_APROVACAO_FILTRO_TINT: Record<1 | 2 | 3, string> = {
  1: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400",
  2: "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-900 dark:bg-orange-950/20 dark:text-orange-400",
  3: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400",
};
const NIVEL_APROVACAO_FILTRO_ATIVO: Record<1 | 2 | 3, string> = {
  1: "border-amber-400 bg-amber-100 text-amber-900 ring-amber-400 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200",
  2: "border-orange-400 bg-orange-100 text-orange-900 ring-orange-400 dark:border-orange-700 dark:bg-orange-950/50 dark:text-orange-200",
  3: "border-red-400 bg-red-100 text-red-900 ring-red-400 dark:border-red-700 dark:bg-red-950/50 dark:text-red-200",
};

function GrupoTiles({ titulo, tiles, ativo, onClick }: { titulo: string; tiles: TileInfo[]; ativo: StatusDespesa | ""; onClick: (s: StatusDespesa | "") => void }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-semibold">{titulo}</p>
        <div className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(110px,1fr))]">
          {tiles.map((t) => {
            const Icon = t.icon;
            const selecionado = t.selecionado ?? (!!t.status && ativo === t.status);
            return (
              <button
                key={t.label}
                type="button"
                onClick={() => (t.onClick ? t.onClick() : onClick(selecionado ? "" : t.status ?? ""))}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition-colors",
                  selecionado ? "border-primary bg-primary/10 ring-1 ring-primary" : COR_TILE_CARD[t.cor]
                )}
              >
                <span className={cn("flex h-8 w-8 items-center justify-center rounded-full", COR_TILE[t.cor])}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-lg font-bold leading-none">{t.count}</span>
                <span className={cn("text-[10px] leading-tight font-medium", COR_TILE_TEXTO[t.cor])}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * A MESMA tela em duas portas: /app/malote/aprovacoes e, para a Diretoria,
 * /app/diretoria/malote-aprovacoes. So o prefixo dos links de detalhe muda —
 * mesmo padrao do MeusChamados, que ja serve tres modulos com um componente.
 * Sem isso, quem entrasse pela Diretoria clicava num item e tomava "Acesso
 * negado": o destino era sempre /app/malote/*, menu de outro modulo.
 */
export default function Aprovacoes({ base = "/app/malote" }: { base?: string } = {}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: itens = [], isLoading } = useItensAprovacoesMalote();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();

  // SIS-2026-0281 (Iury): "colocar os nomes pra eles conseguirem verificar
  // rapidamente quais são deles" — despesa de rateio (multi-classificação)
  // não traz aprovador2/3_nomes prontos (a classificação é por linha, não
  // na despesa) — resolve em lote (1 query pra todas, não 1 por linha).
  const despesaIdsRateio = useMemo(
    () => Array.from(new Set(itens.filter((i) => !i.despesa.classificacao_id).map((i) => i.despesa.id))),
    [itens]
  );
  const { data: classificacaoIdsRateio } = useClassificacaoIdsPorDespesaRateio(despesaIdsRateio);
  // SIS-2026-0288 (Iury, achado testando DM-2026-0180): coluna/filtro de
  // Empresa aqui usava despesa.empresa_id direto — que é só o contexto de
  // sessão de quem lançou, não a empresa do rateio de verdade (por isso
  // Aprovações mostrava HAGG e Pagamento, já corrigido, mostrava AGPS pra
  // MESMA despesa). Mesma resolução em lote usada em Pagamento Malote:
  // empresa da primeira linha do rateio, com despesa.empresa_id só de
  // fallback pras despesas sem rateio por empresa.
  const despesaIdsTodos = useMemo(() => Array.from(new Set(itens.map((i) => i.despesa.id))), [itens]);
  const { data: empresaPrimeiraLinhaPorDespesa } = useEmpresaPrimeiraLinhaRateio(despesaIdsTodos);
  function empresaIdResolvida(despesa: MaloteDespesaRow): string | null {
    return empresaPrimeiraLinhaPorDespesa?.get(despesa.id) ?? despesa.empresa_id ?? null;
  }
  const { data: classificacoesTodas = [] } = useClassificacoesOrcamentoAdmin();
  const classificacaoPorId = useMemo(
    () => new Map(classificacoesTodas.map((c) => [c.id, c])),
    [classificacoesTodas]
  );
  function aprovadorNomes(despesa: MaloteDespesaRow, nivel: 1 | 2 | 3): string[] {
    return nomesAprovadorNivel(despesa, nivel, classificacaoIdsRateio?.get(despesa.id), classificacaoPorId);
  }

  // SIS-2026-0285 (Iury): filtro de data puxava só de "Última atualização" —
  // agora tem os dois períodos, independentes (E lógico quando os dois
  // estão preenchidos), cada um com o próprio combobox de range + "Hoje".
  const [dataAtualizacaoDe, setDataAtualizacaoDe] = useState("");
  const [dataAtualizacaoAte, setDataAtualizacaoAte] = useState("");
  const [dataPagamentoDe, setDataPagamentoDe] = useState("");
  const [dataPagamentoAte, setDataPagamentoAte] = useState("");
  const [status, setStatus] = useState<StatusDespesa | "">("");
  // SIS-2026-0285: os tiles "Aguardando minha aprovação" e "Pendente
  // aprovação (outros níveis)" são os DOIS o mesmo status
  // (pendente_aprovacao) — sem isso, clicar em "outros níveis" não filtrava
  // nada (voltava pra "Todas", já que o tile nunca teve status próprio) e
  // clicar em "minha aprovação" trazia TODO mundo pendente, não só o meu.
  const [escopoAprovacaoPendente, setEscopoAprovacaoPendente] = useState<"minhas" | "outras" | "">("");
  // SIS-2026-0281: filtro dedicado por nível de aprovação (N1/N2/N3).
  const [nivelAprovacao, setNivelAprovacao] = useState<1 | 2 | 3 | "">("");
  // SIS-2026-0281 (ideia levantada com o usuário, "future"): "Minhas
  // aprovações" — só as pendentes onde o usuário logado é de fato um dos
  // aprovadores do nível atual (mesma checagem que já usamos pro tile
  // "Aguardando minha aprovação"). Combina com o filtro de Nível acima
  // (os dois se somam), não substitui.
  const [somenteMinhas, setSomenteMinhas] = useState(false);
  // SIS-2026-0283 (Iury): "Minhas" passa a contemplar também a coluna de
  // Justificativa — clicar mostra tanto o que está pendente de EU aprovar
  // quanto o que está com justificativa pendente de MIM (analista de algum
  // contrato da despesa), não só aprovação.
  const minhasDespesasJustificativaPendente = useMinhasDespesasComJustificativaPendente();
  const [tipo, setTipo] = useState<TipoSolicitacao | "">("");
  const [classificacao, setClassificacao] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [excecao, setExcecao] = useState<"" | "sim" | "nao">("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const ordenacao = useOrdenacaoTabela<ColunaAprovacoes>();

  const empresasMap = useMemo(() => new Map(empresas.map((e) => [e.id, e.nome])), [empresas]);
  const contratosMap = useMemo(() => new Map(contratos.map((c) => [c.id, c.nome])), [contratos]);
  const contratosDaEmpresa = useMemo(
    () => (empresaId ? contratos.filter((c) => c.empresa_id === empresaId) : contratos),
    [contratos, empresaId]
  );
  const classificacoesDisponiveis = useMemo(() => {
    const nomes = new Set<string>();
    itens.forEach((item) => item.despesa.classificacao?.nome && nomes.add(item.despesa.classificacao.nome));
    return Array.from(nomes).sort();
  }, [itens]);

  function limparFiltros() {
    setDataAtualizacaoDe("");
    setDataAtualizacaoAte("");
    setDataPagamentoDe("");
    setDataPagamentoAte("");
    setStatus("");
    setEscopoAprovacaoPendente("");
    setNivelAprovacao("");
    setSomenteMinhas(false);
    setTipo("");
    setClassificacao("");
    setEmpresaId("");
    setContratoId("");
    setExcecao("");
    setBusca("");
    setPagina(1);
  }

  function setStatusFiltro(s: StatusDespesa | "") {
    setStatus(s);
    setEscopoAprovacaoPendente("");
    setPagina(1);
  }

  function toggleNivelAprovacao(n: 1 | 2 | 3) {
    setNivelAprovacao((atual) => (atual === n ? "" : n));
    setPagina(1);
  }

  function toggleSomenteMinhas() {
    setSomenteMinhas((atual) => !atual);
    setPagina(1);
  }

  const filtrados = useMemo(() => {
    return itens.filter((item) => {
      const d = item.despesa;
      if (status && statusEfetivo(item) !== status) return false;
      // SIS-2026-0285: escopo dos tiles "minha aprovação" x "outros níveis"
      // — os dois são status pendente_aprovacao, só o "sou eu o aprovador"
      // muda (ver comentário do estado escopoAprovacaoPendente).
      if (status === "pendente_aprovacao" && escopoAprovacaoPendente) {
        const souAprovadorAtual = d.nivel_aprovacao_atual != null && souAprovadorDoNivel(d, d.nivel_aprovacao_atual, user?.id);
        if (escopoAprovacaoPendente === "minhas" && !souAprovadorAtual) return false;
        if (escopoAprovacaoPendente === "outras" && souAprovadorAtual) return false;
      }
      if (nivelAprovacao && (d.status !== "pendente_aprovacao" || d.nivel_aprovacao_atual !== nivelAprovacao)) return false;
      if (somenteMinhas) {
        const souAprovadorPendente = d.status === "pendente_aprovacao" && d.nivel_aprovacao_atual != null && souAprovadorDoNivel(d, d.nivel_aprovacao_atual, user?.id);
        const minhaJustificativaPendente = minhasDespesasJustificativaPendente.has(d.id);
        if (!souAprovadorPendente && !minhaJustificativaPendente) return false;
      }
      if (tipo && d.tipo !== tipo) return false;
      if (classificacao && d.classificacao?.nome !== classificacao) return false;
      if (empresaId && empresaIdResolvida(d) !== empresaId) return false;
      if (contratoId && d.contrato_id !== contratoId) return false;
      if (excecao === "sim" && !d.excecao) return false;
      if (excecao === "nao" && d.excecao) return false;
      // SIS-2026-0285 (Iury): antes só filtrava por "Última atualização" —
      // agora os dois períodos existem, cada um independente (E lógico).
      if (dataAtualizacaoDe && d.updated_at < dataAtualizacaoDe) return false;
      if (dataAtualizacaoAte && d.updated_at > dataAtualizacaoAte + "T23:59:59") return false;
      if (dataPagamentoDe || dataPagamentoAte) {
        const dp = item.parcela ? item.parcela.data_pagamento_real ?? item.parcela.data_vencimento : d.data_pagamento;
        if (dataPagamentoDe && (!dp || dp < dataPagamentoDe)) return false;
        if (dataPagamentoAte && (!dp || dp > dataPagamentoAte)) return false;
      }
      if (busca.trim()) {
        const q = busca.trim().toLowerCase();
        if (!d.numero.toLowerCase().includes(q) && !d.nome.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [
    itens,
    status,
    escopoAprovacaoPendente,
    nivelAprovacao,
    somenteMinhas,
    user?.id,
    minhasDespesasJustificativaPendente,
    tipo,
    classificacao,
    empresaId,
    empresaPrimeiraLinhaPorDespesa,
    contratoId,
    excecao,
    dataAtualizacaoDe,
    dataAtualizacaoAte,
    dataPagamentoDe,
    dataPagamentoAte,
    busca,
  ]);

  // SIS-2026-0323 (Iury): os cards abaixo (Solicitações/Despesas, níveis
  // N1/N2/N3, "Minhas") contavam sempre em cima de `itens` cru — clicar em
  // "Empresa: HAGG" ou digitar uma busca não refletia nos números dos
  // cards, só na tabela. Mesmo predicado de `filtrados`, mas SEM os campos
  // que os próprios cards representam (status/escopo/nível/somenteMinhas)
  // — senão cada card ficaria preso ao valor que ELE MESMO define (ex.:
  // clicar em N2 zeraria a contagem de N1/N3).
  const itensComFiltrosDoPainel = useMemo(() => {
    return itens.filter((item) => {
      const d = item.despesa;
      if (tipo && d.tipo !== tipo) return false;
      if (classificacao && d.classificacao?.nome !== classificacao) return false;
      if (empresaId && empresaIdResolvida(d) !== empresaId) return false;
      if (contratoId && d.contrato_id !== contratoId) return false;
      if (excecao === "sim" && !d.excecao) return false;
      if (excecao === "nao" && d.excecao) return false;
      if (dataAtualizacaoDe && d.updated_at < dataAtualizacaoDe) return false;
      if (dataAtualizacaoAte && d.updated_at > dataAtualizacaoAte + "T23:59:59") return false;
      if (dataPagamentoDe || dataPagamentoAte) {
        const dp = item.parcela ? item.parcela.data_pagamento_real ?? item.parcela.data_vencimento : d.data_pagamento;
        if (dataPagamentoDe && (!dp || dp < dataPagamentoDe)) return false;
        if (dataPagamentoAte && (!dp || dp > dataPagamentoAte)) return false;
      }
      if (busca.trim()) {
        const q = busca.trim().toLowerCase();
        if (!d.numero.toLowerCase().includes(q) && !d.nome.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [
    itens,
    tipo,
    classificacao,
    empresaId,
    empresaPrimeiraLinhaPorDespesa,
    contratoId,
    excecao,
    dataAtualizacaoDe,
    dataAtualizacaoAte,
    dataPagamentoDe,
    dataPagamentoAte,
    busca,
  ]);

  // SIS-2026-0316: clique no cabeçalho ordena (aplicado antes da
  // paginação, senão só reordenaria dentro da página atual).
  const ordenados = useMemo(() => {
    const acessores: Record<ColunaAprovacoes, (item: ItemLinhaMalote) => string | number | null> = {
      tipo: (item) => (STATUS_FASE_SOLICITACAO.includes(item.despesa.status) ? "Solicitação" : "Despesa"),
      numero: (item) => item.despesa.numero,
      empresa: (item) => empresasMap.get(empresaIdResolvida(item.despesa) ?? "") ?? null,
      nome: (item) => item.despesa.nome,
      classificacao: (item) => item.despesa.classificacao?.nome ?? null,
      valor: (item) => valorDeItem(item),
      data_pagamento: (item) => dataPagamentoDeItem(item),
      status: (item) => STATUS_LABEL[statusEfetivo(item)],
      excecao: (item) => (item.despesa.excecao ? 1 : 0),
      atualizacao: (item) => item.despesa.updated_at,
    };
    return ordenacao.coluna ? ordenarPor(filtrados, acessores[ordenacao.coluna], ordenacao.direcao) : filtrados;
  }, [filtrados, ordenacao.coluna, ordenacao.direcao, empresasMap, empresaPrimeiraLinhaPorDespesa]);

  const totalPaginas = Math.max(1, Math.ceil(ordenados.length / PAGE_SIZE));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = ordenados.slice((paginaAtual - 1) * PAGE_SIZE, paginaAtual * PAGE_SIZE);

  function contar(s: StatusDespesa) {
    return itensComFiltrosDoPainel.filter((item) => statusEfetivo(item) === s).length;
  }

  const minhasPendentes = itensComFiltrosDoPainel.filter(
    ({ despesa: d }) => d.status === "pendente_aprovacao" && d.nivel_aprovacao_atual != null && souAprovadorDoNivel(d, d.nivel_aprovacao_atual, user?.id)
  ).length;
  const outrasPendentes = contar("pendente_aprovacao") - minhasPendentes;
  // SIS-2026-0283: contagem do botão "Minhas" — diferente do tile acima
  // (que é só aprovação), soma também as despesas com justificativa
  // pendente de mim, sem contar a mesma despesa duas vezes.
  const minhasNoFiltro = new Set([
    ...itensComFiltrosDoPainel.filter(({ despesa: d }) => d.status === "pendente_aprovacao" && d.nivel_aprovacao_atual != null && souAprovadorDoNivel(d, d.nivel_aprovacao_atual, user?.id)).map((i) => i.despesa.id),
    ...minhasDespesasJustificativaPendente,
  ]).size;

  // SIS-2026-0281: contagem pros botões de "filtrar por nível".
  function contarNivel(n: 1 | 2 | 3) {
    return itensComFiltrosDoPainel.filter(({ despesa: d }) => d.status === "pendente_aprovacao" && d.nivel_aprovacao_atual === n).length;
  }
  const pendentesN1 = contarNivel(1);
  const pendentesN2 = contarNivel(2);
  const pendentesN3 = contarNivel(3);

  const tilesSolicitacoes: TileInfo[] = [
    { label: STATUS_LABEL.aguardando_aprovacao_inicial, status: "aguardando_aprovacao_inicial", count: contar("aguardando_aprovacao_inicial"), icon: Hourglass, cor: "violet" },
    { label: STATUS_LABEL.aguardando_cotacao, status: "aguardando_cotacao", count: contar("aguardando_cotacao"), icon: Hourglass, cor: "sky" },
    { label: "Cotação pendente", status: "cotacao_realizada", count: contar("cotacao_realizada"), icon: FileText, cor: "amber" },
    { label: STATUS_LABEL.cotacao_aprovada, status: "cotacao_aprovada", count: contar("cotacao_aprovada"), icon: CheckCircle2, cor: "emerald" },
    { label: "Cotação/solicitação reprovada", status: "solicitacao_reprovada", count: contar("solicitacao_reprovada"), icon: XCircle, cor: "red" },
  ];

  function toggleEscopoAprovacaoPendente(escopo: "minhas" | "outras") {
    const jaAtivo = status === "pendente_aprovacao" && escopoAprovacaoPendente === escopo;
    setStatus(jaAtivo ? "" : "pendente_aprovacao");
    setEscopoAprovacaoPendente(jaAtivo ? "" : escopo);
    setPagina(1);
  }

  const tilesDespesas: TileInfo[] = [
    {
      label: "Aguardando minha aprovação",
      status: "pendente_aprovacao",
      count: minhasPendentes,
      icon: Users,
      cor: "amber",
      selecionado: status === "pendente_aprovacao" && escopoAprovacaoPendente === "minhas",
      onClick: () => toggleEscopoAprovacaoPendente("minhas"),
    },
    {
      label: "Pendente aprovação (outros níveis)",
      count: outrasPendentes,
      icon: Hourglass,
      cor: "sky",
      selecionado: status === "pendente_aprovacao" && escopoAprovacaoPendente === "outras",
      onClick: () => toggleEscopoAprovacaoPendente("outras"),
    },
    { label: STATUS_LABEL.necessidade_de_ajuste, status: "necessidade_de_ajuste", count: contar("necessidade_de_ajuste"), icon: AlertTriangle, cor: "amber" },
    { label: STATUS_LABEL.aguardando_pagamento, status: "aguardando_pagamento", count: contar("aguardando_pagamento"), icon: Hourglass, cor: "blue" },
    { label: STATUS_LABEL.despesa_paga, status: "despesa_paga", count: contar("despesa_paga"), icon: CheckCircle2, cor: "emerald" },
    { label: STATUS_LABEL.despesa_reprovada, status: "despesa_reprovada", count: contar("despesa_reprovada"), icon: XCircle, cor: "red" },
  ];

  function abrirItem(despesa: ItemLinhaMalote["despesa"]) {
    const tela = STATUS_FASE_SOLICITACAO.includes(despesa.status) ? "solicitacao" : "despesa";
    navigate(tela === "solicitacao" ? `${base}/solicitacao/${despesa.id}` : `${base}/despesa/${despesa.id}`);
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Aprovações do Malote"
        subtitle="Itens de despesas e solicitações que aguardam ou passaram pela sua aprovação."
        module="Malote"
        breadcrumb={["Malote", "Aprovações"]}
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Filtros</p>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={limparFiltros}>
              <X className="h-3.5 w-3.5" /> Limpar filtros
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <DateRangeFilter
              label="Última atualização"
              de={dataAtualizacaoDe}
              ate={dataAtualizacaoAte}
              onChange={(de, ate) => { setDataAtualizacaoDe(de); setDataAtualizacaoAte(ate); setPagina(1); }}
            />
            <DateRangeFilter
              label="Data de pagamento"
              de={dataPagamentoDe}
              ate={dataPagamentoAte}
              onChange={(de, ate) => { setDataPagamentoDe(de); setDataPagamentoAte(ate); setPagina(1); }}
            />
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status || "todas"} onValueChange={(v) => { setStatusFiltro(v === "todas" ? "" : (v as StatusDespesa)); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {(Object.entries(STATUS_LABEL) as [StatusDespesa, string][]).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Nível de aprovação</Label>
              {/* SIS-2026-0281 (ajuste de destaque, pedido do usuário): "meio
                  termo" entre o card grande de antes e os botões neutros —
                  cada nível já vem com a própria cor tingida mesmo inativo
                  (não só cinza), fica mais saturado só quando ativo. */}
              <div className="flex h-8 items-center gap-1">
                {([1, 2, 3] as const).map((n) => {
                  const pendentes = n === 1 ? pendentesN1 : n === 2 ? pendentesN2 : pendentesN3;
                  const ativo = nivelAprovacao === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => toggleNivelAprovacao(n)}
                      className={cn(
                        "flex-1 rounded-md border px-1.5 h-8 text-xs font-semibold transition-colors",
                        ativo ? NIVEL_APROVACAO_FILTRO_ATIVO[n] : NIVEL_APROVACAO_FILTRO_TINT[n],
                        ativo && "ring-1 ring-offset-1 ring-offset-background"
                      )}
                      title={`Pendente aprovação N${n}${pendentes > 0 ? ` (${pendentes})` : ""}`}
                    >
                      N{n}
                      {pendentes > 0 && <span className="font-normal opacity-80"> ({pendentes})</span>}
                    </button>
                  );
                })}
                {/* "Minhas": pendentes onde o usuário logado é aprovador do
                    nível atual OU tem justificativa pendente como analista
                    de algum contrato da despesa (SIS-2026-0283) — soma com
                    o N1/N2/N3 acima, não substitui (útil sobretudo pra
                    chefia/diretoria, que vê pendências de vários
                    setores/classificações). */}
                <button
                  type="button"
                  onClick={toggleSomenteMinhas}
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-2 h-8 text-xs font-semibold transition-colors",
                    somenteMinhas
                      ? "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                      : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                  )}
                  title={`Só as minhas (aprovação ou justificativa pendente)${minhasNoFiltro > 0 ? ` (${minhasNoFiltro})` : ""}`}
                >
                  <User className="h-3.5 w-3.5 shrink-0" />
                  Minhas
                  {minhasNoFiltro > 0 && <span className="font-normal opacity-80">({minhasNoFiltro})</span>}
                </button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={tipo || "todos"} onValueChange={(v) => { setTipo(v === "todos" ? "" : (v as TipoSolicitacao)); setPagina(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {(Object.entries(TIPO_LABEL) as [TipoSolicitacao, string][]).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Classificação</Label>
              <Select value={classificacao || "todas"} onValueChange={(v) => { setClassificacao(v === "todas" ? "" : v); setPagina(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {classificacoesDisponiveis.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Empresa</Label>
              <Select value={empresaId || "todas"} onValueChange={(v) => { setEmpresaId(v === "todas" ? "" : v); setContratoId(""); setPagina(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Contrato</Label>
              <Select value={contratoId || "todos"} onValueChange={(v) => { setContratoId(v === "todos" ? "" : v); setPagina(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {contratosDaEmpresa.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Exceção</Label>
              <Select value={excecao || "todas"} onValueChange={(v) => { setExcecao(v === "todas" ? "" : (v as "sim" | "nao")); setPagina(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  <SelectItem value="sim">Sim</SelectItem>
                  <SelectItem value="nao">Não</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Preenche o resto da linha da Exceção (9 campos antes deste:
                em lg:grid-cols-4 sobra 1 vago na 3ª linha; col-span-3 fecha
                a linha certinho, sem espaço vazio do lado). */}
            <div className="col-span-2 sm:col-span-3 lg:col-span-3">
              <Label className="text-xs">Buscar por nº ou nome</Label>
              <Input className="h-8 text-xs" placeholder="Buscar por nº da despesa ou nome..." value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GrupoTiles titulo="Solicitações (cotação)" tiles={tilesSolicitacoes} ativo={status} onClick={setStatusFiltro} />
        <GrupoTiles titulo="Despesas" tiles={tilesDespesas} ativo={status} onClick={setStatusFiltro} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeadOrdenavel coluna="tipo" ordenacao={ordenacao}>Tipo</TableHeadOrdenavel>
                  <TableHeadOrdenavel coluna="numero" ordenacao={ordenacao}>Nº</TableHeadOrdenavel>
                  {/* SIS-2026-0288 (Iury): "Empresa / Contrato" logo após o
                      Nº, não mais depois de Classificação. */}
                  {/* Cabeçalho centralizado nas duas colunas que renderizam
                      badge (conteúdo da célula já é centralizado) — nas
                      demais colunas o texto continua alinhado à esquerda
                      (ou à direita, no caso de Valor), igual o conteúdo.
                      SIS-2026-0316: ordena só por Empresa (o Contrato do
                      badge continua mostrado, só não entra no critério). */}
                  <TableHeadOrdenavel coluna="empresa" ordenacao={ordenacao} className="text-center">Empresa / Contrato</TableHeadOrdenavel>
                  <TableHead>Parcela</TableHead>
                  {/* SIS-2026-0288-ajuste (Iury): motivo saiu da coluna —
                      "manter somente NOME" — quem quiser o motivo abre a
                      despesa. */}
                  <TableHeadOrdenavel coluna="nome" ordenacao={ordenacao}>Nome</TableHeadOrdenavel>
                  <TableHeadOrdenavel coluna="classificacao" ordenacao={ordenacao}>Classificação</TableHeadOrdenavel>
                  <TableHeadOrdenavel coluna="valor" ordenacao={ordenacao} className="text-right">Valor (R$)</TableHeadOrdenavel>
                  <TableHeadOrdenavel coluna="data_pagamento" ordenacao={ordenacao}>Data de Pagamento</TableHeadOrdenavel>
                  <TableHead>Solicitante</TableHead>
                  <TableHeadOrdenavel coluna="status" ordenacao={ordenacao} className="text-center">Status</TableHeadOrdenavel>
                  <TableHeadOrdenavel coluna="excecao" ordenacao={ordenacao}>Exceção</TableHeadOrdenavel>
                  <TableHeadOrdenavel coluna="atualizacao" ordenacao={ordenacao}>Última atualização</TableHeadOrdenavel>
                  {/* SIS-2026-0288-ajuste (Iury/usuário): "Justificativa"
                      virou sino — pedido pra ficar bem evidente e como
                      última coisa da linha, não mais coladinho no Nº. */}
                  <TableHead className="w-10 px-2 text-center" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center text-muted-foreground py-10">Carregando...</TableCell>
                  </TableRow>
                )}
                {!isLoading && visiveis.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center text-muted-foreground py-10">
                      <div className="flex flex-col items-center gap-2">
                        <CheckCircle2 className="h-8 w-8 text-muted-foreground/50" />
                        Nenhum item encontrado com os filtros atuais.
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {visiveis.map((item) => (
                  <LinhaItem
                    key={`${item.despesa.id}-${item.parcela?.id ?? "unica"}`}
                    item={item}
                    empresaId={empresaIdResolvida(item.despesa)}
                    nomeEmpresa={empresasMap.get(empresaIdResolvida(item.despesa) ?? "")}
                    nomeContrato={item.despesa.contrato_id ? contratosMap.get(item.despesa.contrato_id) : undefined}
                    aprovadorNomes={aprovadorNomes}
                    onAbrir={() => abrirItem(item.despesa)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          {filtrados.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
              <span>
                Mostrando {(paginaAtual - 1) * PAGE_SIZE + 1}–{Math.min(paginaAtual * PAGE_SIZE, filtrados.length)} de {filtrados.length} itens
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={paginaAtual <= 1} onClick={() => setPagina((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="font-medium">Página {paginaAtual} de {totalPaginas}</span>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LinhaItem({
  item,
  empresaId,
  nomeEmpresa,
  nomeContrato,
  aprovadorNomes,
  onAbrir,
}: {
  item: ItemLinhaMalote;
  empresaId?: string | null;
  nomeEmpresa?: string;
  nomeContrato?: string;
  aprovadorNomes: (despesa: MaloteDespesaRow, nivel: 1 | 2 | 3) => string[];
  onAbrir: () => void;
}) {
  const { despesa, parcela } = item;
  const { data: solicitanteNome } = useNomeUsuario(despesa.created_by);
  const isSolicitacao = STATUS_FASE_SOLICITACAO.includes(despesa.status);
  const status = statusEfetivo(item);
  const valor = parcela ? parcela.valor : despesa.valor_total;
  const dataPagamento = parcela ? parcela.data_pagamento_real ?? parcela.data_vencimento : despesa.data_pagamento;
  return (
    <TableRow
      className={cn(
        "cursor-pointer",
        despesa.excecao
          ? "bg-destructive/5 hover:bg-destructive/10 dark:bg-destructive/10 dark:hover:bg-destructive/15"
          : "hover:bg-muted/50",
      )}
      onClick={onAbrir}
    >
      <TableCell className="text-sm">{isSolicitacao ? "Solicitação" : "Despesa"}</TableCell>
      <TableCell className="font-mono text-xs">{despesa.numero}</TableCell>
      <TableCell className="text-center">
        <EmpresaContratoBadge nomeEmpresa={nomeEmpresa} nomeContrato={nomeContrato} empresaId={empresaId} />
      </TableCell>
      <TableCell className="text-sm">
        {parcela ? `${parcela.numero_parcela}/${despesa.numero_parcelas}` : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-sm">{despesa.nome}</TableCell>
      <TableCell className="text-sm">{despesa.classificacao?.nome ?? "—"}</TableCell>
      <TableCell className="text-right text-sm">
        {Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
      </TableCell>
      <TableCell className="text-sm">{dataPagamento ? new Date(dataPagamento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</TableCell>
      <TableCell className="text-sm">{solicitanteNome ?? "—"}</TableCell>
      <TableCell className="text-center">
        {status === "pendente_aprovacao" && despesa.nivel_aprovacao_atual ? (
          // SIS-2026-0281 (ajuste, pedido do usuário): rótulo "Pendente
          // aprovação N{x}" pequeno em cima, nome do aprovador em destaque
          // embaixo — o nome é o que importa pra bater o olho e saber se é
          // com ele, o rótulo é só contexto.
          //
          // SIS-2026-0288-ajuste (Iury, revertido): uma tentativa anterior
          // tirou o whitespace-nowrap pra quebrar o nome em 2 linhas — só
          // que isso piorou a leitura da tabela inteira. Voltou pro badge
          // numa linha só; quem precisar do nome completo abre a despesa.
          <div
            className={cn(
              "inline-flex flex-col items-center gap-0.5 whitespace-nowrap rounded-md border px-2 py-1 text-center leading-none",
              NIVEL_APROVACAO_BADGE_CLASS[despesa.nivel_aprovacao_atual]
            )}
          >
            <span className="text-[9px] font-medium uppercase tracking-wide opacity-70">
              {STATUS_LABEL.pendente_aprovacao} N{despesa.nivel_aprovacao_atual}
            </span>
            <span className="flex items-center gap-1 text-xs font-bold">
              <User className="h-3 w-3" />
              {(() => {
                const nomes = aprovadorNomes(despesa, despesa.nivel_aprovacao_atual);
                return nomes.length > 0 ? nomes.map(abreviarNome).join(" · ") : "Sem aprovador";
              })()}
            </span>
          </div>
        ) : (
          // Achado do usuário: com o mesmo tamanho reduzido do badge de
          // aprovador, esse Badge (status sem aprovador pendente, ex.
          // "Aguardando pagamento") ficou pequeno demais — ele não tem o
          // mesmo problema de largura que motivou reduzir o outro, então
          // volta pro tamanho padrão do componente Badge.
          <Badge className={STATUS_BADGE_CLASS[status]}>{STATUS_LABEL[status]}</Badge>
        )}
      </TableCell>
      <TableCell className="text-sm">{despesa.excecao ? <Badge variant="destructive">Sim</Badge> : "Não"}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{new Date(despesa.updated_at).toLocaleString("pt-BR")}</TableCell>
      {/* SIS-2026-0288-ajuste (Iury/usuário): sino da Justificativa como
          última coisa da linha, bem mais evidente que o ícone solto de
          antes — círculo cheio com fundo âmbar, chama a atenção sem
          precisar de coluna de texto (só aparece quando há pendência). */}
      <TableCell className="px-2 text-center">
        <JustificativaPendenteBadge despesa={despesa} parcela={parcela} variant="icon" />
      </TableCell>
    </TableRow>
  );
}
