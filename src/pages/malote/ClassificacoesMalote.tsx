import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, ArrowLeft, FolderCog, UserRound, Users, AlertTriangle, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  useClassificacoesOrcamentoAdmin,
  useSalvarClassificacaoOrcamento,
  useAprovadoresDisponiveis,
  useSetoresCatalogo,
  ClassificacaoOrcamento,
  TipoClassificacaoOrcamento,
} from "@/hooks/usePlanejamentoOrcamentario";

interface FormState {
  id?: string;
  nome: string;
  ativo: boolean;
  requerSolicitacao: boolean;
  aprovadorSolicitacaoUserId: string | null;
  aprovadorSolicitacaoNome: string | null;
  tipo: TipoClassificacaoOrcamento | null;
  setorResponsavel: string | null;
  // SIS-2026-0236: cada nível pode ter mais de um aprovador — a ORDEM do
  // array é a ordem de seleção; o primeiro é "o primeiro selecionado"
  // mostrado sozinho na coluna Fluxo de Aprovação da lista.
  aprovador1UserIds: string[];
  aprovador1Nomes: string[];
  aprovador1LimitePct: string;
  aprovador1SemLimite: boolean;
  aprovador2UserIds: string[];
  aprovador2Nomes: string[];
  aprovador2LimitePct: string;
  aprovador2SemLimite: boolean;
  aprovador3UserIds: string[];
  aprovador3Nomes: string[];
  aprovador3LimitePct: string;
  aprovador3SemLimite: boolean;
  limiteJustificativaPct: string;
}

const VAZIO: FormState = {
  nome: "",
  ativo: true,
  requerSolicitacao: false,
  aprovadorSolicitacaoUserId: null,
  aprovadorSolicitacaoNome: null,
  tipo: null,
  setorResponsavel: null,
  aprovador1UserIds: [],
  aprovador1Nomes: [],
  aprovador1LimitePct: "",
  aprovador1SemLimite: false,
  aprovador2UserIds: [],
  aprovador2Nomes: [],
  aprovador2LimitePct: "",
  aprovador2SemLimite: false,
  aprovador3UserIds: [],
  aprovador3Nomes: [],
  aprovador3LimitePct: "",
  aprovador3SemLimite: false,
  limiteJustificativaPct: "",
};

function paraFormState(c: ClassificacaoOrcamento): FormState {
  return {
    id: c.id,
    nome: c.nome,
    ativo: c.ativo,
    requerSolicitacao: c.requer_solicitacao,
    aprovadorSolicitacaoUserId: c.aprovador_solicitacao_user_id,
    aprovadorSolicitacaoNome: c.aprovador_solicitacao_nome,
    tipo: c.tipo,
    setorResponsavel: c.setor_responsavel,
    aprovador1UserIds: c.aprovador1_user_ids,
    aprovador1Nomes: c.aprovador1_nomes,
    aprovador1LimitePct: c.aprovador1_limite_pct != null ? String(c.aprovador1_limite_pct) : "",
    aprovador1SemLimite: c.aprovador1_sem_limite,
    aprovador2UserIds: c.aprovador2_user_ids,
    aprovador2Nomes: c.aprovador2_nomes,
    aprovador2LimitePct: c.aprovador2_limite_pct != null ? String(c.aprovador2_limite_pct) : "",
    aprovador2SemLimite: c.aprovador2_sem_limite,
    aprovador3UserIds: c.aprovador3_user_ids,
    aprovador3Nomes: c.aprovador3_nomes,
    aprovador3LimitePct: c.aprovador3_limite_pct != null ? String(c.aprovador3_limite_pct) : "",
    aprovador3SemLimite: c.aprovador3_sem_limite,
    limiteJustificativaPct: c.limite_justificativa_pct != null ? String(c.limite_justificativa_pct) : "",
  };
}

const TIPO_LABEL: Record<TipoClassificacaoOrcamento, string> = {
  contrato: "Contrato",
  administrativo: "Administrativo",
};

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

// SIS-2026-0236: célula compacta pro nível — primeiro aprovador + indicador
// "+N", tooltip (via title nativo) com o nome completo de todos. Empilhado
// verticalmente (uma linha por nível) em vez de encadeado horizontalmente
// com setas — é o que evita a coluna "esparramar" com 3 níveis.
function LinhaNivel({ nivel, nomes }: { nivel: string; nomes: string[] }) {
  if (nomes.length === 0) return null;
  const extra = nomes.length - 1;
  return (
    <p className="text-xs whitespace-nowrap" title={nomes.join(", ")}>
      <span className="text-muted-foreground">{nivel}:</span> {nomes[0]}
      {extra > 0 && <span className="text-muted-foreground"> +{extra}</span>}
    </p>
  );
}

export default function ClassificacoesMalote() {
  const { data: classificacoes = [], isLoading } = useClassificacoesOrcamentoAdmin();
  const { data: aprovadores1 = [] } = useAprovadoresDisponiveis(1);
  const { data: aprovadores2 = [] } = useAprovadoresDisponiveis(2);
  const { data: aprovadores3 = [] } = useAprovadoresDisponiveis(3);
  const { data: aprovadoresSolicitacao = [] } = useAprovadoresDisponiveis();
  const { data: setores = [] } = useSetoresCatalogo();
  const salvar = useSalvarClassificacaoOrcamento();

  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<FormState | null>(null);
  // Snapshot do estado ao abrir o modal de edição — usado só pra detectar,
  // no save, quais aprovadores saíram/entraram em cada slot (ver
  // detectarTrocas). Fica null em "Nova Classificação" (não há o que trocar).
  const [original, setOriginal] = useState<FormState | null>(null);

  // SIS-2026-0236 (pedido do Iury): quando a edição troca 1 aprovador por
  // outro num slot (ex.: Cássio sai, Joel entra no Aprovador 1), oferece
  // replicar a mesma troca nas outras classificações onde o Cássio também é
  // Aprovador 1 — evita abrir uma por uma quando a pessoa aprova em várias.
  // SIS-2026-0244: soma o caso de remoção PURA (tira um aprovador sem pôr
  // outro no lugar) — mesmo gatilho, `substitutoId` fica null. É a mesma
  // situação do exemplo do Iury pra exclusão em massa, só que descoberta
  // "sem querer" ao editar uma classificação normal em vez de usar a
  // ferramenta dedicada (Incluir/Excluir Aprovador em Massa) — os dois
  // caminhos precisam chegar no mesmo resultado.
  interface TrocaDetectada {
    slot: 1 | 2 | 3;
    removidoId: string;
    removidoNome: string;
    substitutoId: string | null;
    substitutoNome: string | null;
  }
  interface SwapDialogState {
    trocas: TrocaDetectada[];
    itens: { classificacaoNome: string; slot: 1 | 2 | 3; removidoNome: string; substitutoNome: string | null }[];
  }
  const [swapDialog, setSwapDialog] = useState<SwapDialogState | null>(null);
  const [pendingPayload, setPendingPayload] = useState<Parameters<typeof salvar.mutateAsync>[0] | null>(null);

  // SIS-2026-0236 (pedido do Iury): filtro por nome + por aprovador, pra
  // facilitar achar rápido "quais classificações o Fulano aprova" quando
  // precisa trocar (ex.: Cassio saiu, agora é o Joel).
  const [buscaNome, setBuscaNome] = useState("");
  const [buscaAprovadorId, setBuscaAprovadorId] = useState("");

  // SIS-2026-0244 (pedido do Iury): inclusão/exclusão de aprovador em
  // massa, sem precisar abrir classificação por classificação — ex.:
  // "quero o Iury como Aprovador 1 em 50 classificações de uma vez" ou
  // "tirar a Helena do Aprovador 3 em várias, não teremos mais esse
  // nível". Complementar ao fluxo de troca 1-por-1 (SIS-2026-0236) —
  // aquele dispara sozinho ao editar 1 classificação e detectar uma troca
  // igual em outras; este é uma ferramenta explícita pra incluir/excluir
  // (sem precisar já ter feito a troca em nenhuma).
  const [massaOpen, setMassaOpen] = useState(false);
  const [massaAcao, setMassaAcao] = useState<"incluir" | "excluir">("incluir");
  const [massaNivel, setMassaNivel] = useState<1 | 2 | 3>(1);
  const [massaAprovadorId, setMassaAprovadorId] = useState("");
  const [massaSelecionadas, setMassaSelecionadas] = useState<Set<string>>(new Set());
  const [massaBusca, setMassaBusca] = useState("");
  const [massaAplicando, setMassaAplicando] = useState(false);

  const todosAprovadores = useMemo(
    () => [...aprovadores1, ...aprovadores2, ...aprovadores3],
    [aprovadores1, aprovadores2, aprovadores3]
  );

  const opcoesBuscaAprovador = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const a of todosAprovadores) if (!vistos.has(a.id)) vistos.set(a.id, a.nome);
    return Array.from(vistos, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [todosAprovadores]);

  // Opções do Select "Aprovador" da ferramenta em massa, dependentes do
  // Nível escolhido (pedido do usuário): em "Excluir" só faz sentido
  // oferecer quem JÁ é aprovador naquele nível em pelo menos 1
  // classificação (derivado dos dados reais, não do catálogo de cargo) —
  // senão o usuário escolhe alguém e a lista de candidatas vem vazia. Em
  // "Incluir" mantém o catálogo por cargo do nível (mesmas listas usadas
  // no modal de edição — aprovadores1/2/3), já que faz sentido incluir
  // alguém que ainda não é aprovador em lugar nenhum.
  const massaAprovadoresAtuaisNoNivel = useMemo(() => {
    const chaveIds = `aprovador${massaNivel}_user_ids` as const;
    const chaveNomes = `aprovador${massaNivel}_nomes` as const;
    const vistos = new Map<string, string>();
    classificacoes.forEach((c) => {
      c[chaveIds].forEach((id, i) => {
        if (!vistos.has(id)) vistos.set(id, c[chaveNomes][i] ?? id);
      });
    });
    return Array.from(vistos, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [classificacoes, massaNivel]);

  const massaOpcoesAprovador = useMemo(() => {
    if (massaAcao === "excluir") return massaAprovadoresAtuaisNoNivel;
    const catalogo = massaNivel === 1 ? aprovadores1 : massaNivel === 2 ? aprovadores2 : aprovadores3;
    return catalogo.map((a) => ({ value: a.id, label: a.nome }));
  }, [massaAcao, massaNivel, massaAprovadoresAtuaisNoNivel, aprovadores1, aprovadores2, aprovadores3]);

  // Candidatas ao aprovador/nível/ação escolhidos na ferramenta em massa:
  // "incluir" só oferece quem AINDA não está naquele nível (não faz
  // sentido marcar quem já é aprovador); "excluir" só oferece quem JÁ
  // está — bate exatamente com o pedido do Iury ("marcar todas as
  // classificações que eu quero tirar ela").
  const massaCandidatas = useMemo(() => {
    if (!massaAprovadorId) return [];
    const chave = `aprovador${massaNivel}_user_ids` as const;
    const nomeAlvo = semAcento(massaBusca);
    return classificacoes.filter((c) => {
      if (nomeAlvo && !semAcento(c.nome).includes(nomeAlvo)) return false;
      const jaEsta = c[chave].includes(massaAprovadorId);
      if (massaAcao === "incluir") return !jaEsta;
      // Excluir: nunca oferece tirar o único Aprovador 1 de uma
      // classificação (campo obrigatório) — ficaria sem ninguém pra
      // aprovar aquele nível.
      if (!jaEsta) return false;
      return !esvaziariaAprovador1(c, massaNivel, false);
    });
  }, [classificacoes, massaAprovadorId, massaNivel, massaAcao, massaBusca]);

  // Muda nível/ação => a lista de opções de Aprovador é outra (ver
  // massaOpcoesAprovador), então o aprovador selecionado antes pode nem
  // fazer mais sentido — limpa pra evitar mostrar um valor que sumiu do
  // Select.
  useEffect(() => {
    setMassaAprovadorId("");
  }, [massaNivel, massaAcao]);

  // Muda aprovador/nível/ação => a lista de candidatas muda inteira,
  // então qualquer seleção anterior deixa de fazer sentido.
  useEffect(() => {
    setMassaSelecionadas(new Set());
  }, [massaAprovadorId, massaNivel, massaAcao]);

  function alternarMassaSelecao(id: string) {
    setMassaSelecionadas((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function massaSelecionarTodas() {
    setMassaSelecionadas(new Set(massaCandidatas.map((c) => c.id)));
  }

  function massaLimparSelecao() {
    setMassaSelecionadas(new Set());
  }

  function fecharMassa() {
    setMassaOpen(false);
    setMassaAprovadorId("");
    setMassaSelecionadas(new Set());
    setMassaBusca("");
  }

  // Monta o payload de save da classificação aplicando só a inclusão/
  // exclusão do aprovador no nível escolhido — preserva o resto (mesmo
  // padrão de construirPayloadComTroca).
  function construirPayloadEmMassa(c: ClassificacaoOrcamento, aprovadorNome: string) {
    const idsKey = `aprovador${massaNivel}_user_ids` as const;
    const nomesKey = `aprovador${massaNivel}_nomes` as const;
    let ids = [...c[idsKey]];
    let nomes = [...c[nomesKey]];
    if (massaAcao === "incluir") {
      ids = [...ids, massaAprovadorId];
      nomes = [...nomes, aprovadorNome];
    } else {
      const idx = ids.indexOf(massaAprovadorId);
      if (idx !== -1) {
        ids = ids.filter((_, i) => i !== idx);
        nomes = nomes.filter((_, i) => i !== idx);
      }
    }
    return {
      id: c.id,
      nome: c.nome,
      ativo: c.ativo,
      tipo: c.tipo!,
      setor_responsavel: c.setor_responsavel!,
      requer_solicitacao: c.requer_solicitacao,
      aprovador_solicitacao_user_id: c.aprovador_solicitacao_user_id,
      aprovador_solicitacao_nome: c.aprovador_solicitacao_nome,
      aprovador1_user_ids: massaNivel === 1 ? ids : c.aprovador1_user_ids,
      aprovador1_nomes: massaNivel === 1 ? nomes : c.aprovador1_nomes,
      aprovador1_limite_pct: c.aprovador1_limite_pct,
      aprovador1_sem_limite: c.aprovador1_sem_limite,
      aprovador2_user_ids: massaNivel === 2 ? ids : c.aprovador2_user_ids,
      aprovador2_nomes: massaNivel === 2 ? nomes : c.aprovador2_nomes,
      aprovador2_limite_pct: c.aprovador2_limite_pct,
      aprovador2_sem_limite: c.aprovador2_sem_limite,
      aprovador3_user_ids: massaNivel === 3 ? ids : c.aprovador3_user_ids,
      aprovador3_nomes: massaNivel === 3 ? nomes : c.aprovador3_nomes,
      aprovador3_limite_pct: c.aprovador3_limite_pct,
      aprovador3_sem_limite: c.aprovador3_sem_limite,
      limite_justificativa_pct: c.limite_justificativa_pct,
    };
  }

  async function aplicarMassa() {
    if (!massaAprovadorId) return toast.error("Selecione o aprovador.");
    if (massaSelecionadas.size === 0) return toast.error("Selecione ao menos uma classificação.");
    const aprovadorNome = todosAprovadores.find((a) => a.id === massaAprovadorId)?.nome ?? massaAprovadorId;
    setMassaAplicando(true);
    try {
      const alvos = classificacoes.filter((c) => massaSelecionadas.has(c.id));
      for (const c of alvos) {
        await salvar.mutateAsync(construirPayloadEmMassa(c, aprovadorNome));
      }
      toast.success(
        massaAcao === "incluir"
          ? `${aprovadorNome} incluído(a) como Aprovador ${massaNivel} em ${alvos.length} classificação(ões).`
          : `${aprovadorNome} removido(a) do Aprovador ${massaNivel} em ${alvos.length} classificação(ões).`
      );
      fecharMassa();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao aplicar em massa.");
    } finally {
      setMassaAplicando(false);
    }
  }

  const classificacoesFiltradas = useMemo(() => {
    const nomeAlvo = semAcento(buscaNome);
    return classificacoes.filter((c) => {
      if (nomeAlvo && !semAcento(c.nome).includes(nomeAlvo)) return false;
      if (
        buscaAprovadorId &&
        !c.aprovador1_user_ids.includes(buscaAprovadorId) &&
        !c.aprovador2_user_ids.includes(buscaAprovadorId) &&
        !c.aprovador3_user_ids.includes(buscaAprovadorId)
      ) {
        return false;
      }
      return true;
    });
  }, [classificacoes, buscaNome, buscaAprovadorId]);

  // Garante que um aprovador já salvo apareça selecionado mesmo se o cargo
  // dele não bater mais com o filtro do slot (ex.: mudou de função) — sem
  // isso a edição "perderia" visualmente quem já estava escolhido.
  function comSelecaoAtual(opcoes: { value: string; label: string }[], userId: string | null, nome: string | null) {
    if (!userId || opcoes.some((o) => o.value === userId)) return opcoes;
    return [...opcoes, { value: userId, label: nome ?? userId }];
  }

  // Mesma ideia, versão multi: garante que TODOS os já selecionados apareçam
  // nas opções, mesmo os que não batem mais com o filtro de cargo do slot.
  function comSelecaoAtualMulti(opcoes: { value: string; label: string }[], userIds: string[], nomes: string[]) {
    const faltantes = userIds
      .filter((id) => !opcoes.some((o) => o.value === id))
      .map((id) => ({ value: id, label: nomes[userIds.indexOf(id)] ?? id }));
    return faltantes.length > 0 ? [...opcoes, ...faltantes] : opcoes;
  }

  const opcoesAprovador1 = comSelecaoAtualMulti(
    aprovadores1.map((a) => ({ value: a.id, label: a.nome })),
    editando?.aprovador1UserIds ?? [],
    editando?.aprovador1Nomes ?? []
  );
  const opcoesAprovador2 = comSelecaoAtualMulti(
    aprovadores2.map((a) => ({ value: a.id, label: a.nome })),
    editando?.aprovador2UserIds ?? [],
    editando?.aprovador2Nomes ?? []
  );
  const opcoesAprovador3 = comSelecaoAtualMulti(
    aprovadores3.map((a) => ({ value: a.id, label: a.nome })),
    editando?.aprovador3UserIds ?? [],
    editando?.aprovador3Nomes ?? []
  );
  const opcoesAprovadorSolicitacao = comSelecaoAtual(
    aprovadoresSolicitacao.map((a) => ({ value: a.id, label: a.nome })),
    editando?.aprovadorSolicitacaoUserId ?? null,
    editando?.aprovadorSolicitacaoNome ?? null
  );

  function abrirNovo() {
    setEditando({ ...VAZIO });
    setOriginal(null);
    setOpen(true);
  }

  function abrirEditar(row: ClassificacaoOrcamento) {
    const fs = paraFormState(row);
    setEditando(fs);
    setOriginal(fs);
    setOpen(true);
  }

  // Compara o snapshot de abertura com o estado atual e devolve, por slot,
  // os casos de troca 1-por-1 (exatamente 1 saiu, exatamente 1 entrou) OU
  // de remoção pura (1 saiu, ninguém entrou) — adição de um segundo
  // aprovador sem remover ninguém não conta (não há "removido" pra
  // oferecer replicar em outras classificações).
  function detectarTrocas(orig: FormState, atual: FormState): TrocaDetectada[] {
    const trocas: TrocaDetectada[] = [];
    ([1, 2, 3] as const).forEach((slot) => {
      const origIds = orig[`aprovador${slot}UserIds`];
      const origNomes = orig[`aprovador${slot}Nomes`];
      const novosIds = atual[`aprovador${slot}UserIds`];
      const novosNomes = atual[`aprovador${slot}Nomes`];
      const removidos = origIds.filter((id) => !novosIds.includes(id));
      const adicionados = novosIds.filter((id) => !origIds.includes(id));
      if (removidos.length !== 1) return;
      if (adicionados.length > 1) return;
      const removidoId = removidos[0];
      const removidoNome = origNomes[origIds.indexOf(removidoId)] ?? removidoId;
      if (adicionados.length === 1) {
        const substitutoId = adicionados[0];
        trocas.push({
          slot,
          removidoId,
          removidoNome,
          substitutoId,
          substitutoNome: novosNomes[novosIds.indexOf(substitutoId)] ?? substitutoId,
        });
      } else {
        trocas.push({ slot, removidoId, removidoNome, substitutoId: null, substitutoNome: null });
      }
    });
    return trocas;
  }

  // Monta o payload de save de OUTRA classificação (não a que está sendo
  // editada no modal), aplicando a troca só no slot afetado — preserva todo
  // o resto da classificação como está hoje.
  function construirPayloadComTroca(c: ClassificacaoOrcamento, troca: TrocaDetectada) {
    const idsKey = `aprovador${troca.slot}_user_ids` as const;
    const nomesKey = `aprovador${troca.slot}_nomes` as const;
    let ids = [...c[idsKey]];
    let nomes = [...c[nomesKey]];
    const idx = ids.indexOf(troca.removidoId);
    if (idx !== -1) {
      if (troca.substitutoId) {
        ids[idx] = troca.substitutoId;
        nomes[idx] = troca.substitutoNome!;
      } else {
        ids = ids.filter((_, i) => i !== idx);
        nomes = nomes.filter((_, i) => i !== idx);
      }
    }
    return {
      id: c.id,
      nome: c.nome,
      ativo: c.ativo,
      tipo: c.tipo!,
      setor_responsavel: c.setor_responsavel!,
      requer_solicitacao: c.requer_solicitacao,
      aprovador_solicitacao_user_id: c.aprovador_solicitacao_user_id,
      aprovador_solicitacao_nome: c.aprovador_solicitacao_nome,
      aprovador1_user_ids: troca.slot === 1 ? ids : c.aprovador1_user_ids,
      aprovador1_nomes: troca.slot === 1 ? nomes : c.aprovador1_nomes,
      aprovador1_limite_pct: c.aprovador1_limite_pct,
      aprovador1_sem_limite: c.aprovador1_sem_limite,
      aprovador2_user_ids: troca.slot === 2 ? ids : c.aprovador2_user_ids,
      aprovador2_nomes: troca.slot === 2 ? nomes : c.aprovador2_nomes,
      aprovador2_limite_pct: c.aprovador2_limite_pct,
      aprovador2_sem_limite: c.aprovador2_sem_limite,
      aprovador3_user_ids: troca.slot === 3 ? ids : c.aprovador3_user_ids,
      aprovador3_nomes: troca.slot === 3 ? nomes : c.aprovador3_nomes,
      aprovador3_limite_pct: c.aprovador3_limite_pct,
      aprovador3_sem_limite: c.aprovador3_sem_limite,
      limite_justificativa_pct: c.limite_justificativa_pct,
    };
  }

  function setAprovador(slot: 1 | 2 | 3, userIds: string[]) {
    const nomes = userIds.map((id) => todosAprovadores.find((a) => a.id === id)?.nome ?? id);
    setEditando((v) => (v ? { ...v, [`aprovador${slot}UserIds`]: userIds, [`aprovador${slot}Nomes`]: nomes } : v));
  }

  function setAprovadorSolicitacao(userId: string) {
    const nome = aprovadoresSolicitacao.find((a) => a.id === userId)?.nome ?? null;
    setEditando((v) =>
      v ? { ...v, aprovadorSolicitacaoUserId: userId || null, aprovadorSolicitacaoNome: userId ? nome : null } : v
    );
  }

  function parsePct(valor: string): number | null {
    if (!valor.trim()) return null;
    const n = Number(valor.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  // Aprovador 1 é obrigatório (validação de handleSalvar) — uma remoção em
  // massa/troca nunca pode deixar OUTRA classificação sem nenhum Aprovador
  // 1, senão ela fica sem ninguém pra aprovar aquele nível. N2/N3 podem
  // ficar vazios (são opcionais).
  function esvaziariaAprovador1(c: ClassificacaoOrcamento, slot: 1 | 2 | 3, temSubstituto: boolean): boolean {
    return slot === 1 && !temSubstituto && c.aprovador1_user_ids.length === 1;
  }

  async function handleSalvar() {
    if (!editando) return;
    if (!editando.nome.trim()) {
      toast.error("Informe o nome da classificação.");
      return;
    }
    if (!editando.tipo) {
      toast.error("Selecione o tipo de classificação.");
      return;
    }
    if (!editando.setorResponsavel) {
      toast.error("Selecione o setor responsável.");
      return;
    }
    if (editando.requerSolicitacao && !editando.aprovadorSolicitacaoUserId) {
      toast.error("Selecione o aprovador da solicitação.");
      return;
    }
    if (editando.aprovador1UserIds.length === 0) {
      toast.error("Informe pelo menos um Aprovador 1.");
      return;
    }
    const limite1 = editando.aprovador1SemLimite ? null : parsePct(editando.aprovador1LimitePct);
    if (!editando.aprovador1SemLimite && (limite1 === null || limite1 < 0)) {
      toast.error("Informe um limite de alçada válido (ou marque Alçada máxima) para o Aprovador 1.");
      return;
    }
    const limite2 = editando.aprovador2SemLimite ? null : parsePct(editando.aprovador2LimitePct);
    if (editando.aprovador2UserIds.length > 0 && !editando.aprovador2SemLimite && limite2 === null) {
      toast.error("Informe o limite de alçada do Aprovador 2 (ou marque Alçada máxima).");
      return;
    }
    if (limite1 !== null && limite2 !== null && limite2 <= limite1) {
      toast.error("O limite do Aprovador 2 deve ser maior que o do Aprovador 1.");
      return;
    }
    const limite3 = editando.aprovador3SemLimite ? null : parsePct(editando.aprovador3LimitePct);
    if (editando.aprovador3UserIds.length > 0 && !editando.aprovador3SemLimite && limite3 === null) {
      toast.error("Informe o limite de alçada do Aprovador 3 (ou marque Alçada máxima).");
      return;
    }
    if (limite2 !== null && limite3 !== null && limite3 <= limite2) {
      toast.error("O limite do Aprovador 3 deve ser maior que o do Aprovador 2.");
      return;
    }
    const limiteJustificativa = parsePct(editando.limiteJustificativaPct);
    if (editando.limiteJustificativaPct.trim() && (limiteJustificativa === null || limiteJustificativa < 0)) {
      toast.error("Informe um limite para justificativa válido.");
      return;
    }

    const payload = {
      id: editando.id,
      nome: editando.nome,
      ativo: editando.ativo,
      tipo: editando.tipo,
      setor_responsavel: editando.setorResponsavel,
      requer_solicitacao: editando.requerSolicitacao,
      aprovador_solicitacao_user_id: editando.requerSolicitacao ? editando.aprovadorSolicitacaoUserId : null,
      aprovador_solicitacao_nome: editando.requerSolicitacao ? editando.aprovadorSolicitacaoNome : null,
      aprovador1_user_ids: editando.aprovador1UserIds,
      aprovador1_nomes: editando.aprovador1Nomes,
      aprovador1_limite_pct: limite1,
      aprovador1_sem_limite: editando.aprovador1SemLimite,
      aprovador2_user_ids: editando.aprovador2UserIds,
      aprovador2_nomes: editando.aprovador2Nomes,
      aprovador2_limite_pct: limite2,
      aprovador2_sem_limite: editando.aprovador2SemLimite,
      aprovador3_user_ids: editando.aprovador3UserIds,
      aprovador3_nomes: editando.aprovador3Nomes,
      aprovador3_limite_pct: limite3,
      aprovador3_sem_limite: editando.aprovador3SemLimite,
      limite_justificativa_pct: limiteJustificativa,
    };

    if (original) {
      const trocas = detectarTrocas(original, editando);
      const itens: SwapDialogState["itens"] = [];
      for (const troca of trocas) {
        const afetadas = classificacoes.filter(
          (c) =>
            c.id !== editando.id &&
            c[`aprovador${troca.slot}_user_ids`].includes(troca.removidoId) &&
            !esvaziariaAprovador1(c, troca.slot, !!troca.substitutoId)
        );
        for (const c of afetadas) {
          itens.push({
            classificacaoNome: c.nome,
            slot: troca.slot,
            removidoNome: troca.removidoNome,
            substitutoNome: troca.substitutoNome,
          });
        }
      }
      if (itens.length > 0) {
        setPendingPayload(payload);
        setSwapDialog({ trocas, itens });
        return;
      }
    }

    await executarSalvar(payload);
  }

  async function executarSalvar(payload: NonNullable<typeof pendingPayload>) {
    try {
      await salvar.mutateAsync(payload);
      toast.success("Classificação salva.");
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar classificação.");
    }
  }

  // Usuário confirmou: salva a classificação atual e aplica a mesma troca
  // nas outras classificações onde a pessoa removida também aprova.
  async function confirmarTrocaEmMassa() {
    if (!pendingPayload || !swapDialog || !editando) return;
    try {
      await salvar.mutateAsync(pendingPayload);
      for (const troca of swapDialog.trocas) {
        const afetadas = classificacoes.filter(
          (c) =>
            c.id !== editando.id &&
            c[`aprovador${troca.slot}_user_ids`].includes(troca.removidoId) &&
            !esvaziariaAprovador1(c, troca.slot, !!troca.substitutoId)
        );
        for (const c of afetadas) {
          await salvar.mutateAsync(construirPayloadComTroca(c, troca));
        }
      }
      toast.success(`Classificação salva e alteração aplicada em ${swapDialog.itens.length} classificação(ões).`);
      setSwapDialog(null);
      setPendingPayload(null);
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar as trocas.");
    }
  }

  // Usuário recusou a troca em massa: salva só a classificação que estava
  // editando, do jeito normal.
  async function confirmarSemTroca() {
    if (!pendingPayload) return;
    await executarSalvar(pendingPayload);
    setSwapDialog(null);
    setPendingPayload(null);
  }

  // Fechar o diálogo (X, clicar fora, Esc) ou clicar em "Cancelar" NÃO
  // salva nada — nem a classificação atual, nem as outras. Volta pro modal
  // de edição (que continua aberto) com as alterações ainda lá, pra o
  // usuário poder mexer mais antes de decidir salvar de verdade.
  function cancelarSwap() {
    setSwapDialog(null);
    setPendingPayload(null);
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Classificações do Malote"
        subtitle="Classificações usadas pelo Malote para aprovação de despesas — compartilhadas entre todas as empresas do grupo."
        module="Malote"
        breadcrumb={["Malote", "Classificações e Orçamentos", "Classificações Malote"]}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/app/malote/orcamento-geral">
                <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setMassaOpen(true)}>
              <UsersRound className="h-4 w-4 mr-2" />
              Incluir/Excluir Aprovador em Massa
            </Button>
            <Button onClick={abrirNovo}>
              <Plus className="h-4 w-4 mr-2" />
              Nova Classificação
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{classificacoesFiltradas.length} classificação(ões)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 overflow-x-auto">
          <div className="flex flex-col sm:flex-row gap-3 sm:max-w-xl">
            <div className="flex-1">
              <Label className="text-xs">Buscar classificação</Label>
              <Input placeholder="Nome da classificação..." value={buscaNome} onChange={(e) => setBuscaNome(e.target.value)} />
            </div>
            <div className="flex-1">
              <Label className="text-xs">Buscar aprovador</Label>
              <SearchableSelect
                value={buscaAprovadorId}
                onChange={setBuscaAprovadorId}
                options={opcoesBuscaAprovador}
                placeholder="Qualquer aprovador"
                searchPlaceholder="Buscar aprovador..."
                allowClear
              />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Setor Responsável</TableHead>
                <TableHead>Fluxo de Aprovação</TableHead>
                <TableHead>Requer Solicitação?</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && classificacoesFiltradas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {classificacoes.length === 0 ? "Nenhuma classificação cadastrada ainda." : "Nenhuma classificação encontrada com esse filtro."}
                  </TableCell>
                </TableRow>
              )}
              {classificacoesFiltradas.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.nome}</TableCell>
                  <TableCell>{c.tipo ? TIPO_LABEL[c.tipo] : "—"}</TableCell>
                  <TableCell>{c.setor_responsavel ?? "—"}</TableCell>
                  <TableCell>
                    <LinhaNivel nivel="N1" nomes={c.aprovador1_nomes} />
                    <LinhaNivel nivel="N2" nomes={c.aprovador2_nomes} />
                    <LinhaNivel nivel="N3" nomes={c.aprovador3_nomes} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.requer_solicitacao ? "default" : "outline"}>
                      {c.requer_solicitacao ? "Sim" : "Não"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {c.ativo ? <Badge variant="secondary">Ativa</Badge> : <Badge variant="outline">Inativa</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => abrirEditar(c)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando?.id ? "Editar Classificação" : "Nova Classificação"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>
                Nome <span className="text-destructive">*</span>
              </Label>
              <Input
                value={editando?.nome ?? ""}
                onChange={(e) => setEditando((v) => (v ? { ...v, nome: e.target.value } : v))}
                placeholder="Ex: Salários, Aluguel, Combustível..."
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="classificacao-ativa"
                checked={editando?.ativo ?? true}
                onCheckedChange={(checked) => setEditando((v) => (v ? { ...v, ativo: checked === true } : v))}
              />
              <Label htmlFor="classificacao-ativa">Ativa</Label>
              <span className="text-xs text-muted-foreground">
                Classificações inativas não poderão ser utilizadas nos orçamentos.
              </span>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <FolderCog className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">Configurações para o Malote</p>
                  <p className="text-xs text-muted-foreground">
                    Estas opções definem regras de fluxo no módulo Malote.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="requer-solicitacao"
                  className="mt-0.5"
                  checked={editando?.requerSolicitacao ?? false}
                  onCheckedChange={(checked) =>
                    setEditando((v) => (v ? { ...v, requerSolicitacao: checked === true } : v))
                  }
                />
                <div>
                  <Label htmlFor="requer-solicitacao" className="flex items-center gap-1.5">
                    <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                    Requer solicitação
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Quando marcada, lançamentos desta classificação no Malote só poderão ser realizados após o
                    processo de solicitação.
                  </p>
                </div>
              </div>
              {editando?.requerSolicitacao && (
                <div className="pl-6">
                  <Label>
                    Aprovador da solicitação <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-xs text-muted-foreground mb-1">
                    Responsável por aprovar a solicitação antes da cotação. Pode ser diferente do(s) aprovador(es)
                    da despesa no Malote.
                  </p>
                  <SearchableSelect
                    value={editando?.aprovadorSolicitacaoUserId ?? ""}
                    onChange={setAprovadorSolicitacao}
                    options={opcoesAprovadorSolicitacao}
                    placeholder="Buscar aprovador..."
                    searchPlaceholder="Buscar aprovador..."
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>
                  Tipo de classificação <span className="text-destructive">*</span>
                </Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Selecione se esta classificação será usada para contratos ou administrativas.
                </p>
                <div className="space-y-2">
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="tipo-classificacao"
                      className="mt-1"
                      checked={editando?.tipo === "contrato"}
                      onChange={() => setEditando((v) => (v ? { ...v, tipo: "contrato" } : v))}
                    />
                    <span>
                      <span className="font-medium">Contrato</span>
                      <br />
                      <span className="text-xs text-muted-foreground">
                        Usada em contratos com clientes / prestação de serviços.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="tipo-classificacao"
                      className="mt-1"
                      checked={editando?.tipo === "administrativo"}
                      onChange={() => setEditando((v) => (v ? { ...v, tipo: "administrativo" } : v))}
                    />
                    <span>
                      <span className="font-medium">Administrativo</span>
                      <br />
                      <span className="text-xs text-muted-foreground">Usada em despesas administrativas da empresa.</span>
                    </span>
                  </label>
                </div>
              </div>
              <div>
                <Label>
                  Setor responsável <span className="text-destructive">*</span>
                </Label>
                <p className="text-xs text-muted-foreground mb-2">Setor responsável pela gestão desta classificação.</p>
                <Select
                  value={editando?.setorResponsavel ?? ""}
                  onValueChange={(v) => setEditando((s) => (s ? { ...s, setorResponsavel: v } : s))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o setor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {setores.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <Users className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">Definição de Aprovadores e Limites de Alçada</p>
                  <p className="text-xs text-muted-foreground">
                    Informe os aprovadores em ordem de hierarquia e seus respectivos limites de alçada.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div>
                    <Label>
                      Aprovador 1 <span className="text-destructive">*</span>
                    </Label>
                    <p className="text-xs text-muted-foreground mb-1">Gerentes e supervisores.</p>
                    <SearchableMultiSelect
                      value={editando?.aprovador1UserIds ?? []}
                      onChange={(ids) => setAprovador(1, ids)}
                      options={opcoesAprovador1}
                      placeholder="Buscar aprovador..."
                      searchPlaceholder="Buscar aprovador..."
                    />
                  </div>
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <Label>
                        Limite da alçada 1 (%) <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="Ex.: 10,00"
                        value={editando?.aprovador1LimitePct ?? ""}
                        onChange={(e) => setEditando((v) => (v ? { ...v, aprovador1LimitePct: e.target.value } : v))}
                        disabled={editando?.aprovador1SemLimite}
                      />
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer whitespace-nowrap pb-2.5">
                      <Checkbox
                        checked={editando?.aprovador1SemLimite ?? false}
                        onCheckedChange={(c) => setEditando((v) => (v ? { ...v, aprovador1SemLimite: c === true } : v))}
                      />
                      Alçada máxima
                    </label>
                  </div>
                </div>

                <div className="space-y-2 border-t border-border pt-4">
                  <div>
                    <Label>Aprovador 2</Label>
                    <p className="text-xs text-muted-foreground mb-1">Diretores.</p>
                    <SearchableMultiSelect
                      value={editando?.aprovador2UserIds ?? []}
                      onChange={(ids) => setAprovador(2, ids)}
                      options={opcoesAprovador2}
                      placeholder="Buscar aprovador..."
                      searchPlaceholder="Buscar aprovador..."
                    />
                  </div>
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <Label>Limite da alçada 2 (%)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="Ex.: 25,00"
                        value={editando?.aprovador2LimitePct ?? ""}
                        onChange={(e) => setEditando((v) => (v ? { ...v, aprovador2LimitePct: e.target.value } : v))}
                        disabled={editando?.aprovador2SemLimite}
                      />
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer whitespace-nowrap pb-2.5">
                      <Checkbox
                        checked={editando?.aprovador2SemLimite ?? false}
                        onCheckedChange={(c) => setEditando((v) => (v ? { ...v, aprovador2SemLimite: c === true } : v))}
                      />
                      Alçada máxima
                    </label>
                  </div>
                </div>

                <div className="space-y-2 border-t border-border pt-4">
                  <div>
                    <Label>Aprovador 3</Label>
                    <p className="text-xs text-muted-foreground mb-1">Presidência.</p>
                    <SearchableMultiSelect
                      value={editando?.aprovador3UserIds ?? []}
                      onChange={(ids) => setAprovador(3, ids)}
                      options={opcoesAprovador3}
                      placeholder="Buscar aprovador..."
                      searchPlaceholder="Buscar aprovador..."
                    />
                  </div>
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <Label>Limite da alçada 3 (%)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="Ex.: 50,00"
                        value={editando?.aprovador3LimitePct ?? ""}
                        onChange={(e) => setEditando((v) => (v ? { ...v, aprovador3LimitePct: e.target.value } : v))}
                        disabled={editando?.aprovador3SemLimite}
                      />
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer whitespace-nowrap pb-2.5">
                      <Checkbox
                        checked={editando?.aprovador3SemLimite ?? false}
                        onCheckedChange={(c) => setEditando((v) => (v ? { ...v, aprovador3SemLimite: c === true } : v))}
                      />
                      Alçada máxima
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">Limite para Justificativa</p>
                  <p className="text-xs text-muted-foreground">
                    Defina a partir de qual percentual do orçamento será necessário informar justificativa para a
                    despesa.
                  </p>
                </div>
              </div>
              <div className="max-w-[200px]">
                <Label>Exigir justificativa a partir de (%)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Ex.: 75,00"
                  value={editando?.limiteJustificativaPct ?? ""}
                  onChange={(e) => setEditando((v) => (v ? { ...v, limiteJustificativaPct: e.target.value } : v))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSalvar} disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!swapDialog} onOpenChange={(v) => !v && cancelarSwap()}>
        <DialogContent className="sm:max-w-lg overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Aplicar a mesma alteração em outras classificações?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              {swapDialog?.itens.length === 1
                ? "Encontramos 1 outra classificação com essa mesma alteração de aprovador:"
                : `Encontramos ${swapDialog?.itens.length ?? 0} outras classificações com essa mesma alteração de aprovador:`}
            </p>
            <ul className="rounded-md border border-border divide-y divide-border max-h-56 overflow-y-auto">
              {swapDialog?.itens.map((item, i) => (
                <li key={i} className="px-3 py-2">
                  <p className="font-medium">{item.classificacaoNome}</p>
                  <p className="text-xs text-muted-foreground">
                    Aprovador N{item.slot}:{" "}
                    {item.substitutoNome ? (
                      <>{item.removidoNome} → {item.substitutoNome}</>
                    ) : (
                      <>remover {item.removidoNome}</>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter className="flex-wrap gap-2 sm:justify-end sm:space-x-0">
            <Button variant="ghost" onClick={cancelarSwap} disabled={salvar.isPending}>
              Cancelar
            </Button>
            <Button variant="outline" onClick={confirmarSemTroca} disabled={salvar.isPending}>
              Só esta classificação
            </Button>
            <Button onClick={confirmarTrocaEmMassa} disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando..." : "Aplicar em todas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={massaOpen} onOpenChange={(v) => (v ? setMassaOpen(true) : fecharMassa())}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Incluir/Excluir Aprovador em Massa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex rounded-md border border-border p-1 gap-1">
              <button
                type="button"
                className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  massaAcao === "incluir" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
                onClick={() => setMassaAcao("incluir")}
              >
                Incluir
              </button>
              <button
                type="button"
                className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  massaAcao === "excluir" ? "bg-destructive text-destructive-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
                onClick={() => setMassaAcao("excluir")}
              >
                Excluir
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nível</Label>
                <Select value={String(massaNivel)} onValueChange={(v) => setMassaNivel(Number(v) as 1 | 2 | 3)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Aprovador 1</SelectItem>
                    <SelectItem value="2">Aprovador 2</SelectItem>
                    <SelectItem value="3">Aprovador 3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Aprovador</Label>
                <SearchableSelect
                  value={massaAprovadorId}
                  onChange={setMassaAprovadorId}
                  options={massaOpcoesAprovador}
                  placeholder="Selecione..."
                  searchPlaceholder="Buscar aprovador..."
                />
              </div>
            </div>

            {massaAprovadorId && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">
                    {massaAcao === "incluir"
                      ? `Classificações onde incluir como Aprovador ${massaNivel}`
                      : `Classificações onde remover do Aprovador ${massaNivel}`}
                  </Label>
                  <div className="flex gap-2">
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={massaSelecionarTodas}>
                      Selecionar todas
                    </Button>
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={massaLimparSelecao}>
                      Limpar
                    </Button>
                  </div>
                </div>
                <Input
                  placeholder="Buscar classificação..."
                  value={massaBusca}
                  onChange={(e) => setMassaBusca(e.target.value)}
                  className="h-8 text-xs"
                />
                <div className="rounded-md border border-border divide-y divide-border max-h-64 overflow-y-auto">
                  {massaCandidatas.length === 0 && (
                    <p className="p-3 text-xs text-muted-foreground">
                      {massaAcao === "incluir"
                        ? "Todas as classificações já têm esse aprovador nesse nível (ou não há nenhuma cadastrada)."
                        : "Nenhuma classificação tem esse aprovador nesse nível."}
                    </p>
                  )}
                  {massaCandidatas.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                      <Checkbox
                        checked={massaSelecionadas.has(c.id)}
                        onCheckedChange={() => alternarMassaSelecao(c.id)}
                      />
                      {c.nome}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{massaSelecionadas.size} selecionada(s) de {massaCandidatas.length}.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={fecharMassa} disabled={massaAplicando}>
              Cancelar
            </Button>
            <Button
              variant={massaAcao === "excluir" ? "destructive" : "default"}
              onClick={aplicarMassa}
              disabled={massaAplicando || massaSelecionadas.size === 0}
            >
              {massaAplicando
                ? "Aplicando..."
                : massaAcao === "incluir"
                ? `Incluir em ${massaSelecionadas.size || ""} classificação(ões)`
                : `Excluir de ${massaSelecionadas.size || ""} classificação(ões)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
