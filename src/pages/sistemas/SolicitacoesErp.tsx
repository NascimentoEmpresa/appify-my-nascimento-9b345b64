import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, UserCircle2, CalendarClock, Bell, BellRing } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import logoNascimento from "@/assets/logo-nascimento-icon.png";
import {
  ETAPAS, CAMPOS_ABERTURA, TIPO_SOLICITACAO_LABEL, GRAU_URGENCIA_LABEL, STATUS_DESENVOLVIMENTO_LABEL, STATUS_DESENVOLVIMENTO_COR,
  CLASSIFICACAO_DEMANDA_OPCOES, BENEFICIOS_ESPERADOS_OPCOES, IMPACTO_TIPO_OPCOES, DOCUMENTOS_APOIO_OPCOES,
  nomeUsuario, iniciais, fmtData, statusPrazoEtapa, sdNumero,
  type Solicitacao, type Anexo, type Comentario, type Convidado, type Papeis, type AprovadorTesteInterno, type Assinatura,
} from "./etapas/types";
import { FsdFormCriar } from "./etapas/FsdFormCriar";
import { Historico } from "./etapas/Historico";
import { temDadoResumo, RESUMOS } from "./etapas/Resumos";
import { SolicitacaoDemandaPanel } from "./etapas/SolicitacaoDemandaPanel";
import { TriagemInicialPanel } from "./etapas/TriagemInicialPanel";
import { AnaliseNecessidadePanel } from "./etapas/AnaliseNecessidadePanel";
import { LevantamentoFuncionalPanel } from "./etapas/LevantamentoFuncionalPanel";
import { DocumentacaoFuncionalPanel } from "./etapas/DocumentacaoFuncionalPanel";
import { AnaliseTecnicaPanel } from "./etapas/AnaliseTecnicaPanel";
import { AprovacaoPriorizacaoPanel } from "./etapas/AprovacaoPriorizacaoPanel";
import { DesenvolvimentoPanel } from "./etapas/DesenvolvimentoPanel";
import { TestesInternosPanel } from "./etapas/TestesInternosPanel";
import { HomologacaoAreaSolicitantePanel } from "./etapas/HomologacaoAreaSolicitantePanel";
import { TreinamentoPanel } from "./etapas/TreinamentoPanel";
import { ImplantacaoPanel } from "./etapas/ImplantacaoPanel";
import { AcompanhamentoAssistidoPanel } from "./etapas/AcompanhamentoAssistidoPanel";
import { EncerramentoPanel } from "./etapas/EncerramentoPanel";
import { DocumentosAssinaturasTab } from "./etapas/DocumentosAssinaturasTab";

const BUCKET = "sistema-solicitacoes";

const PALETA_CORES = ["muted", "primary", "accent", "info", "warning", "success"] as const;
const ETAPAS_COR = ETAPAS.map((e, i) => ({ ...e, cor: PALETA_CORES[i % PALETA_CORES.length] }));

const COR_DOT: Record<string, string> = {
  muted: "bg-muted-foreground/40",
  primary: "bg-primary",
  accent: "bg-accent",
  info: "bg-info",
  warning: "bg-warning",
  success: "bg-success",
};
const COR_BORDER: Record<string, string> = {
  muted: "border-l-muted-foreground/40",
  primary: "border-l-primary",
  accent: "border-l-accent",
  info: "border-l-info",
  warning: "border-l-warning",
  success: "border-l-success",
};

function BadgePrazo({ etapaKey, etapaEntradaEm }: { etapaKey: string; etapaEntradaEm: string }) {
  const status = statusPrazoEtapa(etapaKey, etapaEntradaEm);
  if (!status.temPrazo) return null;
  const expirado = status.diasUteisRestantes < 0;
  return (
    <div
      className={[
        "mb-1.5 inline-flex items-center gap-1 rounded-md border px-2 py-1",
        expirado ? "border-destructive/30 bg-destructive/15 text-destructive" : "border-warning/30 bg-warning/15 text-warning",
      ].join(" ")}
    >
      <CalendarClock className="h-3.5 w-3.5 shrink-0" />
      <div className="leading-tight">
        <p className="text-[10px] font-semibold">
          {expirado
            ? "Prazo expirado"
            : `${status.diasUteisRestantes} dia${status.diasUteisRestantes === 1 ? "" : "s"} útil(eis) restante(s)`}
        </p>
        {status.prorrogado && !expirado && <p className="text-[9px]">em prorrogação</p>}
      </div>
    </div>
  );
}

function DescricaoExpandivel({ texto }: { texto: string }) {
  const [expandido, setExpandido] = useState(false);
  const longa = texto.length > 220;
  return (
    <div>
      <p
        className={`whitespace-pre-wrap break-words text-sm text-muted-foreground ${!expandido && longa ? "line-clamp-4" : ""}`}
      >
        {texto}
      </p>
      {longa && (
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          className="mt-1 text-xs font-medium text-primary hover:underline"
        >
          {expandido ? "ver menos" : "ver mais"}
        </button>
      )}
    </div>
  );
}

function CampoAbertura({ label, valor }: { label: string; valor: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{valor || "—"}</p>
    </div>
  );
}

function DetalhesAberturaExpandivel({ card }: { card: Solicitacao }) {
  const [aberto, setAberto] = useState(false);
  const temParteA = !!(
    card.area_solicitante || card.responsavel_solicitacao ||
    (card.classificacao_demanda && card.classificacao_demanda.length > 0) ||
    card.descricao_necessidade
  );
  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Detalhes da abertura
        <span className="text-primary">{aberto ? "ver menos" : "ver mais"}</span>
      </button>
      {aberto && (
        <div className="space-y-3 border-t border-border p-3">
          {!temParteA ? (
            <>
              {CAMPOS_ABERTURA.map((c) => (
                <CampoAbertura key={c.key} label={c.label} valor={(card[c.key] as string | null)} />
              ))}
              <CampoAbertura label="Grau de urgência" valor={card.grau_urgencia ? GRAU_URGENCIA_LABEL[card.grau_urgencia] ?? card.grau_urgencia : null} />
              <CampoAbertura label="Tipo da solicitação" valor={card.tipo_solicitacao ? TIPO_SOLICITACAO_LABEL[card.tipo_solicitacao] ?? card.tipo_solicitacao : null} />
            </>
          ) : (
            <>
              {card.area_solicitante && <CampoAbertura label="Área Solicitante" valor={card.area_solicitante} />}
              {card.responsavel_solicitacao && <CampoAbertura label="Responsável" valor={card.responsavel_solicitacao} />}
              {card.cargo_solicitante && <CampoAbertura label="Cargo" valor={card.cargo_solicitante} />}
              {card.email_solicitante && <CampoAbertura label="E-mail" valor={card.email_solicitante} />}
              {card.telefone_solicitante && <CampoAbertura label="Telefone" valor={card.telefone_solicitante} />}
              {card.classificacao_demanda && card.classificacao_demanda.length > 0 && (
                <CampoAbertura
                  label="Classificação da Demanda"
                  valor={card.classificacao_demanda.map((v) => CLASSIFICACAO_DEMANDA_OPCOES.find((o) => o.value === v)?.label ?? v).join(", ")}
                />
              )}
              {card.descricao_necessidade && <CampoAbertura label="Descrição da Necessidade" valor={card.descricao_necessidade} />}
              {card.problema_atual && <CampoAbertura label="Situação Atual" valor={card.problema_atual} />}
              {card.situacao_desejada && <CampoAbertura label="Situação Desejada" valor={card.situacao_desejada} />}
              {card.justificativa && <CampoAbertura label="Justificativa" valor={card.justificativa} />}
              {card.beneficios_esperados_lista && card.beneficios_esperados_lista.length > 0 && (
                <CampoAbertura
                  label="Benefícios Esperados"
                  valor={card.beneficios_esperados_lista.map((v) => BENEFICIOS_ESPERADOS_OPCOES.find((o) => o.value === v)?.label ?? v).join(", ")}
                />
              )}
              {card.impacto_tipo && (
                <CampoAbertura label="Impacto" valor={IMPACTO_TIPO_OPCOES.find((o) => o.value === card.impacto_tipo)?.label ?? card.impacto_tipo} />
              )}
              {card.areas_impactadas && <CampoAbertura label="Áreas Impactadas" valor={card.areas_impactadas} />}
              {card.grau_urgencia && <CampoAbertura label="Grau de Urgência" valor={GRAU_URGENCIA_LABEL[card.grau_urgencia] ?? card.grau_urgencia} />}
              {card.justificativa_urgencia && <CampoAbertura label="Justificativa da Urgência" valor={card.justificativa_urgencia} />}
              {card.existe_processo_documentado != null && (
                <CampoAbertura label="Processo Documentado" valor={card.existe_processo_documentado ? "Sim" : "Não"} />
              )}
              {card.codigo_processo && <CampoAbertura label="Código do Processo" valor={card.codigo_processo} />}
              {card.tipos_documentos_apoio && card.tipos_documentos_apoio.length > 0 && (
                <CampoAbertura
                  label="Documentos de Apoio"
                  valor={card.tipos_documentos_apoio.map((v) => DOCUMENTOS_APOIO_OPCOES.find((o) => o.value === v)?.label ?? v).join(", ")}
                />
              )}
              {card.observacoes_abertura && <CampoAbertura label="Observações Adicionais" valor={card.observacoes_abertura} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const PAINEIS: Record<string, (props: any) => JSX.Element> = {
  solicitacao_demanda: SolicitacaoDemandaPanel,
  triagem_inicial: TriagemInicialPanel,
  analise_necessidade: AnaliseNecessidadePanel,
  levantamento_funcional: LevantamentoFuncionalPanel,
  documentacao_funcional: DocumentacaoFuncionalPanel,
  analise_tecnica: AnaliseTecnicaPanel,
  aprovacao_priorizacao: AprovacaoPriorizacaoPanel,
  desenvolvimento: DesenvolvimentoPanel,
  testes_internos: TestesInternosPanel,
  homologacao_area_solicitante: HomologacaoAreaSolicitantePanel,
  treinamento: TreinamentoPanel,
  implantacao: ImplantacaoPanel,
  acompanhamento_assistido: AcompanhamentoAssistidoPanel,
  encerramento: EncerramentoPanel,
};

export default function SolicitacoesErp() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const push = usePushNotifications();
  const { data: access } = useAccessibleMenus("visualizar");
  const [novoOpen, setNovoOpen] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [aba, setAba] = useState<"detalhes" | "historico" | "documentos">("detalhes");
  const [novoComentario, setNovoComentario] = useState("");
  const [enviandoComentario, setEnviandoComentario] = useState(false);
  const [filtroResponsavelDev, setFiltroResponsavelDev] = useState<string | null>(null);
  const [filtroTitulo, setFiltroTitulo] = useState("");
  const [filtroAreaSolicitante, setFiltroAreaSolicitante] = useState("");
  const [filtroId, setFiltroId] = useState("");

  const papeis: Papeis = {
    comite: access?.codes.has("sistemas_comite") ?? false,
    controladoria: access?.codes.has("sistemas_controladoria") ?? false,
    gerenteSistemas: access?.codes.has("sistemas_gerente_sistemas") ?? false,
    desenvolvedores: access?.codes.has("sistemas_desenvolvedores") ?? false,
    criarSolicitacao: access?.codes.has("sistemas_criar_solicitacao") ?? false,
    convidado: access?.codes.has("sistemas_convidado") ?? false,
    verTodas: access?.codes.has("sistemas_ver_todas_solicitacoes") ?? false,
  };

  useEffect(() => {
    (supabase as any).rpc("sistema_corrigir_prazos_vencidos").then(() => {
      qc.invalidateQueries({ queryKey: ["sistema_solicitacao"] });
    });
  }, [qc]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["sistema_solicitacao"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sistema_solicitacao")
        .select(
          "id, titulo, descricao, etapa, recusado, prioridade, responsavel_user_id, progresso_pct, data_inicio, data_fim, " +
          "status_desenvolvimento, criterio_triagem, analise_necessidade_texto, analise_necessidade_prazo, " +
          "levantamento_funcional_texto, levantamento_funcional_prazo, documentacao_tecnica_texto, documentacao_tecnica_prazo, " +
          "analise_tecnica_texto, analise_tecnica_prazo, treinamento_data, implantacao_status, finalizado, etapa_entrada_em, " +
          "testes_interno_aprov_1, testes_interno_aprov_2, testes_interno_aprov_3, complexidade, " +
          "objetivo_solicitacao, problema_atual, justificativa, beneficio_esperado, impacto_operacional, " +
          "grau_urgencia, tipo_solicitacao, " +
          "pesquisa_atendeu_necessidade, pesquisa_levantamento_claro, pesquisa_conducao_ti, " +
          "pesquisa_treinamento_suporte, pesquisa_avaliacao_geral, pesquisa_pode_encerrar, " +
          "criado_por, created_at, numero, " +
          "area_solicitante, responsavel_solicitacao, cargo_solicitante, email_solicitante, telefone_solicitante, " +
          "classificacao_demanda, descricao_necessidade, situacao_desejada, beneficios_esperados_lista, " +
          "impacto_tipo, areas_impactadas, justificativa_urgencia, existe_processo_documentado, codigo_processo, " +
          "tipos_documentos_apoio, observacoes_abertura, " +
          "triagem_recebido_por, triagem_concluida_em, triagem_classificacao, triagem_sem_desenvolvimento, " +
          "triagem_sem_desenvolvimento_como, triagem_encaminhamento_para, triagem_encaminhamento_responsavel, " +
          "triagem_parecer, triagem_decisao, triagem_data_decisao, " +
          "an_criterios, an_pessoas_impactadas, dfd_dados, ptv_dados",
        )
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Solicitacao[];
    },
  });

  const { data: aprovadoresTestesInternos = [] } = useQuery({
    queryKey: ["sistema_solicitacao_aprovadores_testes_internos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("listar_aprovadores_testes_internos");
      if (error) throw error;
      return (data ?? []) as AprovadorTesteInterno[];
    },
  });

  const { data: usuarios = [] } = useQuery({
    queryKey: ["sistemas-usuarios-ativos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("listar_usuarios_ativos");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; display_name: string }>;
    },
  });

  const { data: convidaveis = [] } = useQuery({
    queryKey: ["sistemas-usuarios-convidaveis"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("listar_usuarios_convidaveis");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; display_name: string }>;
    },
  });

  const grouped = useMemo(() => {
    const m = new Map<string, Solicitacao[]>();
    ETAPAS.forEach((e) => m.set(e.key, []));
    const tituloLc = filtroTitulo.trim().toLowerCase();
    const areaLc = filtroAreaSolicitante.trim().toLowerCase();
    const idLc = filtroId.trim().toLowerCase();
    rows.forEach((r) => {
      if (tituloLc && !r.titulo?.toLowerCase().includes(tituloLc)) return;
      if (areaLc && !r.area_solicitante?.toLowerCase().includes(areaLc)) return;
      if (idLc && !sdNumero(r).toLowerCase().includes(idLc)) return;
      m.get(r.etapa)?.push(r);
    });
    // Recusados sempre por último na coluna.
    m.forEach((lista) => lista.sort((a, b) => (a.recusado === b.recusado ? 0 : a.recusado ? 1 : -1)));
    return m;
  }, [rows, filtroTitulo, filtroAreaSolicitante, filtroId]);

  const cardDetalhe = rows.find((r) => r.id === detalheId) ?? null;

  const { data: anexos = [] } = useQuery({
    queryKey: ["sistema_solicitacao_anexo", detalheId],
    enabled: !!detalheId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sistema_solicitacao_anexo")
        .select("id, storage_path, nome_arquivo, campo, created_at")
        .eq("solicitacao_id", detalheId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Anexo[];
    },
  });

  const { data: comentarios = [] } = useQuery({
    queryKey: ["sistema_solicitacao_comentario", detalheId],
    enabled: !!detalheId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sistema_solicitacao_comentario")
        .select("id, autor_id, texto, tipo, created_at")
        .eq("solicitacao_id", detalheId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Comentario[];
    },
  });

  const { data: convidados = [] } = useQuery({
    queryKey: ["sistema_solicitacao_convidado", detalheId],
    enabled: !!detalheId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sistema_solicitacao_convidado")
        .select("id, user_id, created_at")
        .eq("solicitacao_id", detalheId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Convidado[];
    },
  });

  const { data: assinaturas = [] } = useQuery({
    queryKey: ["sistema_solicitacao_assinatura", detalheId],
    enabled: !!detalheId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sistema_solicitacao_assinatura")
        .select("id, user_id, etapa, assinatura_png, created_at")
        .eq("solicitacao_id", detalheId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Assinatura[];
    },
  });

  const invalidarCard = () => {
    qc.invalidateQueries({ queryKey: ["sistema_solicitacao"] });
    qc.invalidateQueries({ queryKey: ["sistema_solicitacao_log", detalheId] });
  };

  const updateCard = async (id: string, patch: Record<string, unknown>): Promise<boolean> => {
    const cardAntes = rows.find((r) => r.id === id);
    const { error } = await (supabase as any).from("sistema_solicitacao").update(patch).eq("id", id);
    if (error) {
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
      return false;
    }
    invalidarCard();

    if (typeof patch.etapa === "string" && cardAntes && patch.etapa !== cardAntes.etapa) {
      const novaEtapaLabel = ETAPAS.find((e) => e.key === patch.etapa)?.label ?? String(patch.etapa);
      toast({ title: "Card movido", description: `Etapa: ${novaEtapaLabel}` });
      if (detalheId === id) setDetalheId(null);
      supabase.functions
        .invoke("enviar-notificacao-push", { body: { solicitacao_id: id, etapa_nova: patch.etapa } })
        .catch(() => {});
    } else if ("recusado" in patch) {
      toast({ title: patch.recusado ? "Card recusado" : "Card reativado" });
    } else if ("finalizado" in patch) {
      toast({ title: patch.finalizado ? "Demanda finalizada" : "Demanda reaberta" });
    }

    return true;
  };

  const update = (patch: Record<string, unknown>): Promise<boolean> =>
    cardDetalhe ? updateCard(cardDetalhe.id, patch) : Promise.resolve(false);

  const voltarParaSolicitacoes = (id: string) => updateCard(id, { etapa: "solicitacao_demanda", recusado: false });

  const excluirCardId = async (id: string) => {
    const { error } = await (supabase as any).from("sistema_solicitacao").delete().eq("id", id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["sistema_solicitacao"] });
    toast({ title: "Solicitação excluída" });
  };

  const comentar = async (texto: string, tipo?: string): Promise<boolean> => {
    if (!cardDetalhe || !texto.trim()) return false;
    const { error } = await (supabase as any).from("sistema_solicitacao_comentario").insert({
      solicitacao_id: cardDetalhe.id,
      texto: texto.trim(),
      tipo: tipo ?? null,
    });
    if (error) {
      toast({ title: "Erro ao comentar", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["sistema_solicitacao_comentario", cardDetalhe.id] });
    return true;
  };

  const uploadAnexo = async (solicitacaoId: string, file: File, campo?: string): Promise<string | null> => {
    // A key do storage não aceita acentos/espaços/parênteses etc ("Invalid key") —
    // sanitiza só o nome usado no path; o nome original fica intacto em nome_arquivo.
    const nomeSanitizado = file.name
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${solicitacaoId}/${Date.now()}-${nomeSanitizado}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    if (up.error) return up.error.message;
    const { error } = await (supabase as any).from("sistema_solicitacao_anexo").insert({
      solicitacao_id: solicitacaoId,
      storage_path: path,
      nome_arquivo: file.name,
      mime_type: file.type || null,
      tamanho_bytes: file.size,
      campo: campo ?? null,
    });
    return error?.message ?? null;
  };

  const anexar = async (file: File, campo?: string): Promise<boolean> => {
    if (!cardDetalhe) return false;
    const erro = await uploadAnexo(cardDetalhe.id, file, campo);
    if (erro) {
      toast({ title: `Erro ao enviar "${file.name}"`, description: erro, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["sistema_solicitacao_anexo", cardDetalhe.id] });
    return true;
  };

  const downloadAnexo = async (path: string) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) {
      toast({ title: "Erro ao abrir anexo", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const adicionarConvidado = async (userId: string): Promise<boolean> => {
    if (!cardDetalhe) return false;
    const { error } = await (supabase as any).from("sistema_solicitacao_convidado").insert({
      solicitacao_id: cardDetalhe.id,
      user_id: userId,
    });
    if (error) {
      toast({ title: "Erro ao adicionar convidado", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["sistema_solicitacao_convidado", cardDetalhe.id] });
    return true;
  };

  const removerConvidado = async (convidadoId: string): Promise<boolean> => {
    const { error } = await (supabase as any).from("sistema_solicitacao_convidado").delete().eq("id", convidadoId);
    if (error) {
      toast({ title: "Erro ao remover convidado", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["sistema_solicitacao_convidado", detalheId] });
    return true;
  };

  const excluirCard = async (): Promise<boolean> => {
    if (!cardDetalhe) return false;
    const { error } = await (supabase as any).from("sistema_solicitacao").delete().eq("id", cardDetalhe.id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      return false;
    }
    setDetalheId(null);
    qc.invalidateQueries({ queryKey: ["sistema_solicitacao"] });
    toast({ title: "Solicitação excluída" });
    return true;
  };

  const criarFsd = async (dados: {
    titulo: string; area_solicitante: string; responsavel_solicitacao: string;
    cargo_solicitante: string; email_solicitante: string; telefone_solicitante: string;
    classificacao_demanda: string[]; descricao_necessidade: string; problema_atual: string;
    situacao_desejada: string; justificativa: string; beneficios_esperados_lista: string[];
    impacto_tipo: string; areas_impactadas: string; grau_urgencia: string;
    justificativa_urgencia: string; existe_processo_documentado: string; codigo_processo: string;
    tipos_documentos_apoio: string[]; observacoes_abertura: string; arquivos: File[];
  }) => {
    setSalvando(true);
    const { data, error } = await (supabase as any)
      .from("sistema_solicitacao")
      .insert({
        titulo: dados.titulo.trim(),
        area_solicitante: dados.area_solicitante.trim() || null,
        responsavel_solicitacao: dados.responsavel_solicitacao.trim() || null,
        cargo_solicitante: dados.cargo_solicitante.trim() || null,
        email_solicitante: dados.email_solicitante.trim() || null,
        telefone_solicitante: dados.telefone_solicitante.trim() || null,
        classificacao_demanda: dados.classificacao_demanda.length > 0 ? dados.classificacao_demanda : null,
        descricao_necessidade: dados.descricao_necessidade.trim() || null,
        problema_atual: dados.problema_atual.trim() || null,
        situacao_desejada: dados.situacao_desejada.trim() || null,
        justificativa: dados.justificativa.trim() || null,
        beneficios_esperados_lista: dados.beneficios_esperados_lista.length > 0 ? dados.beneficios_esperados_lista : null,
        impacto_tipo: dados.impacto_tipo || null,
        areas_impactadas: dados.areas_impactadas.trim() || null,
        grau_urgencia: dados.grau_urgencia || null,
        justificativa_urgencia: dados.justificativa_urgencia.trim() || null,
        existe_processo_documentado: dados.existe_processo_documentado === "sim" ? true : dados.existe_processo_documentado === "nao" ? false : null,
        codigo_processo: dados.codigo_processo.trim() || null,
        tipos_documentos_apoio: dados.tipos_documentos_apoio.length > 0 ? dados.tipos_documentos_apoio : null,
        observacoes_abertura: dados.observacoes_abertura.trim() || null,
      })
      .select("id")
      .single();
    if (error) {
      setSalvando(false);
      toast({ title: "Erro ao criar solicitação", description: error.message, variant: "destructive" });
      return;
    }
    const falhas: string[] = [];
    for (const file of dados.arquivos) {
      const erro = await uploadAnexo(data.id, file);
      if (erro) falhas.push(file.name);
    }
    setSalvando(false);
    setNovoOpen(false);
    qc.invalidateQueries({ queryKey: ["sistema_solicitacao"] });
    if (falhas.length > 0) {
      toast({ title: "Solicitação criada, mas houve erro nos anexos", description: `Falhou: ${falhas.join(", ")}`, variant: "destructive" });
    } else {
      toast({ title: "Solicitação criada" });
    }
  };

  const comentarGeral = async () => {
    if (!novoComentario.trim()) return;
    setEnviandoComentario(true);
    const ok = await comentar(novoComentario);
    setEnviandoComentario(false);
    if (ok) setNovoComentario("");
  };

  const PainelEtapa = cardDetalhe ? PAINEIS[cardDetalhe.etapa] : null;
  const totalNaColuna = cardDetalhe ? (grouped.get(cardDetalhe.etapa)?.length ?? 0) : 0;
  const prioridadesUsadas = cardDetalhe
    ? (grouped.get("aprovacao_priorizacao") ?? [])
        .filter((c) => c.id !== cardDetalhe.id && c.prioridade != null)
        .map((c) => c.prioridade as number)
    : [];
  const anexosGerais = anexos.filter((a) => !a.campo);
  const comentariosGerais = comentarios.filter((c) => !c.tipo);

  return (
    <div>
      <PageHeader
        title="Solicitações ERP"
        subtitle="Fluxo de demandas de sistemas — 14 etapas, papéis configuráveis em Administração."
        module="Sistemas"
        breadcrumb={["Solicitações ERP"]}
        actions={
          <>
            {push.suportado && push.inscrito && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <BellRing className="h-3.5 w-3.5" /> Notificações ativadas
              </span>
            )}
            {push.suportado && !push.inscrito && !push.precisaInstalar && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={push.ativando}
                onClick={async () => {
                  try {
                    const ok = await push.ativarNotificacoes();
                    if (ok) {
                      toast({ title: "Notificações ativadas" });
                    } else {
                      toast({ title: "Permissão negada", description: "Habilite notificações nas configurações do navegador.", variant: "destructive" });
                    }
                  } catch (e) {
                    toast({ title: "Erro ao ativar notificações", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
                  }
                }}
              >
                <Bell className="h-3.5 w-3.5" /> {push.ativando ? "Ativando…" : "Ativar notificações"}
              </Button>
            )}
            {push.precisaInstalar && (
              <span className="max-w-[220px] text-xs text-muted-foreground">
                Pra notificações no iPhone: abra pelo Safari → compartilhar → "Adicionar à Tela de Início".
              </span>
            )}
            {papeis.criarSolicitacao && (
              <Button onClick={() => setNovoOpen(true)} className="gap-1.5">
                <Plus className="h-4 w-4" /> Nova Solicitação
              </Button>
            )}
          </>
        }
      />

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-52 text-sm"
          placeholder="Título da solicitação…"
          value={filtroTitulo}
          onChange={(e) => setFiltroTitulo(e.target.value)}
        />
        <Input
          className="h-8 w-44 text-sm"
          placeholder="Área solicitante…"
          value={filtroAreaSolicitante}
          onChange={(e) => setFiltroAreaSolicitante(e.target.value)}
        />
        <Input
          className="h-8 w-36 text-sm"
          placeholder="ID do pedido…"
          value={filtroId}
          onChange={(e) => setFiltroId(e.target.value)}
        />
        {(filtroTitulo || filtroAreaSolicitante || filtroId) && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => { setFiltroTitulo(""); setFiltroAreaSolicitante(""); setFiltroId(""); }}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      <div className="-mb-4 flex h-[calc(100vh-170px)] min-h-[420px] gap-3 overflow-x-auto pb-0 sm:-mb-6 lg:-mb-8">
        {ETAPAS_COR.map((etapa) => (
          <div key={etapa.key} className="flex h-full min-w-[260px] flex-1 flex-col overflow-hidden">
            <div className="mb-2 flex shrink-0 items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                <span className={`h-2 w-2 rounded-full ${COR_DOT[etapa.cor]}`} />
                {etapa.label}
              </span>
              <Badge variant="outline" className="text-[10px]">{grouped.get(etapa.key)?.length ?? 0}</Badge>
            </div>
            {etapa.key === "desenvolvimento" && (
              <div className="mb-2 shrink-0">
                <SearchableSelect
                  value={filtroResponsavelDev}
                  onChange={(v) => setFiltroResponsavelDev(v || null)}
                  options={[{ value: "", label: "Ver todos" }, ...usuarios.map((u) => ({ value: u.id, label: u.display_name }))]}
                  placeholder="Filtrar por responsável…"
                  searchPlaceholder="Buscar usuário..."
                  allowClear
                  clearValue=""
                />
              </div>
            )}
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {(etapa.key === "desenvolvimento" && filtroResponsavelDev
                ? grouped.get(etapa.key)?.filter((c) => c.responsavel_user_id === filtroResponsavelDev)
                : etapa.key === "aprovacao_priorizacao"
                ? [...(grouped.get(etapa.key) ?? [])].sort((a, b) => (a.prioridade ?? Infinity) - (b.prioridade ?? Infinity))
                : grouped.get(etapa.key)
              )?.map((card) => {
                const responsavelNome = nomeUsuario(usuarios, card.responsavel_user_id);
                const estadoRecusadoControladoria = card.recusado && papeis.controladoria;
                const estadoRecusadoComum = card.recusado && !papeis.controladoria;
                return (
                  <Card
                    key={card.id}
                    onClick={() => { if (!estadoRecusadoComum) { setDetalheId(card.id); setAba("detalhes"); } }}
                    className={[
                      "relative border-l-4 p-3",
                      COR_BORDER[etapa.cor],
                      estadoRecusadoComum ? "cursor-default opacity-40" : "cursor-pointer",
                      estadoRecusadoControladoria ? "bg-warning/20 border-warning" : "",
                      card.finalizado ? "opacity-50" : "",
                    ].join(" ")}
                  >
                    {card.prioridade != null && (
                      <Badge variant="outline" className="absolute right-2 top-2 text-[9px]">P{card.prioridade}</Badge>
                    )}
                    <BadgePrazo etapaKey={etapa.key} etapaEntradaEm={card.etapa_entrada_em} />
                    <p className="pr-8 text-xs font-medium">{card.titulo}</p>
                    {card.descricao && (
                      <p className="mt-1 line-clamp-3 text-[11px] text-muted-foreground">{card.descricao}</p>
                    )}
                    {card.status_desenvolvimento && (
                      <Badge variant="outline" className={["mt-1.5 text-[9px]", STATUS_DESENVOLVIMENTO_COR[card.status_desenvolvimento] ?? ""].join(" ")}>
                        {STATUS_DESENVOLVIMENTO_LABEL[card.status_desenvolvimento] ?? card.status_desenvolvimento}
                      </Badge>
                    )}
                    <div className="mt-2 flex items-center gap-1.5">
                      <Avatar className="h-5 w-5">
                        <AvatarFallback className="text-[9px]">
                          {responsavelNome ? iniciais(responsavelNome) : <UserCircle2 className="h-3 w-3" />}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate text-[10px] text-muted-foreground">
                        {responsavelNome ?? "Sem responsável"}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Progress value={card.progresso_pct} className="h-1.5 flex-1" />
                      <span className="text-[10px] text-muted-foreground">{card.progresso_pct}%</span>
                    </div>
                    <div className="mt-1.5 text-[10px] text-muted-foreground">
                      Início: {fmtData(card.data_inicio) ?? "—"}
                      {card.data_fim && <> · Fim: {fmtData(card.data_fim)}</>}
                    </div>
                    {card.recusado && (
                      <p className="mt-1.5 text-[10px] font-medium text-warning-foreground">Recusado</p>
                    )}
                    {estadoRecusadoControladoria && (
                      <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="outline" className="h-7 flex-1 text-[11px]" onClick={() => voltarParaSolicitacoes(card.id)}>
                          Voltar para Solicitações
                        </Button>
                        <Button size="sm" variant="destructive" className="h-7 flex-1 text-[11px]" onClick={() => excluirCardId(card.id)}>
                          Excluir
                        </Button>
                      </div>
                    )}
                  </Card>
                );
              })}
              {grouped.get(etapa.key)?.length === 0 && (
                <div className="rounded-md border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
                  vazio
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <FsdFormCriar
        open={novoOpen}
        onClose={() => setNovoOpen(false)}
        nomeUsuarioAtual={nomeUsuario(usuarios, user?.id ?? null) ?? ""}
        salvando={salvando}
        onSubmit={criarFsd}
      />

      <Dialog open={!!detalheId} onOpenChange={(open) => { if (!open) { setDetalheId(null); setNovoComentario(""); } }}>
        <DialogContent className="max-w-[90vw] overflow-x-auto overflow-y-auto max-h-[90vh]">
          {cardDetalhe && PainelEtapa && (
            <div id="pdf-capture-target">
              {/* Cabeçalho padronizado do card */}
              <DialogHeader className="pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <img src={logoNascimento} alt="Nascimento" className="h-10 w-10 shrink-0 object-contain" />
                    <div className="min-w-0">
                      <DialogTitle className="flex flex-wrap items-center gap-2 text-[#153169]">
                        <span className="break-words">{cardDetalhe.titulo}</span>
                        {cardDetalhe.recusado && <Badge variant="outline" className="text-warning-foreground">Recusado</Badge>}
                        {cardDetalhe.finalizado && <Badge variant="outline">Finalizado</Badge>}
                      </DialogTitle>
                      <p className="mt-0.5 text-xs font-semibold text-[#e67e22]">Solicitação de Demanda</p>
                    </div>
                  </div>
                  <div className="shrink-0 rounded-md border border-[#153169]/30 bg-[#153169]/5 px-3 py-1.5 text-right">
                    <p className="text-[9px] font-semibold uppercase tracking-wider text-[#153169]/60">Nº da Solicitação</p>
                    <p className="text-sm font-bold text-[#153169]">{sdNumero(cardDetalhe)}</p>
                  </div>
                </div>
              </DialogHeader>

              <div className="flex gap-2 border-b border-border pb-2">
                <button
                  onClick={() => setAba("detalhes")}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${aba === "detalhes" ? "bg-muted" : "text-muted-foreground"}`}
                >
                  Detalhes
                </button>
                <button
                  onClick={() => setAba("historico")}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${aba === "historico" ? "bg-muted" : "text-muted-foreground"}`}
                >
                  Histórico
                </button>
                <button
                  onClick={() => setAba("documentos")}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${aba === "documentos" ? "bg-muted" : "text-muted-foreground"}`}
                >
                  Documentos e Assinaturas
                </button>
              </div>

              {aba === "historico" && (
                <div className="max-h-[420px] overflow-y-auto py-2">
                  <Historico solicitacaoId={cardDetalhe.id} usuarios={usuarios} />
                </div>
              )}

              {aba === "documentos" && (
                <DocumentosAssinaturasTab
                  solicitacaoId={cardDetalhe.id}
                  etapaAtual={cardDetalhe.etapa}
                  usuarios={usuarios}
                  userId={user?.id ?? null}
                  titulo={cardDetalhe.titulo}
                  card={cardDetalhe}
                  anexos={anexos}
                  comentarios={comentarios}
                  convidados={convidados}
                  onDownloadAnexo={downloadAnexo}
                />
              )}

              {aba === "detalhes" && (
                <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="min-w-0 space-y-4">
                    {cardDetalhe.descricao && <DescricaoExpandivel texto={cardDetalhe.descricao} />}

                    <DetalhesAberturaExpandivel card={cardDetalhe} />

                    {ETAPAS.map((etapa) => {
                      if (etapa.key === cardDetalhe.etapa) {
                        return (
                          <PainelEtapa
                            key={etapa.key}
                            card={cardDetalhe}
                            papeis={papeis}
                            userId={user?.id ?? null}
                            usuarios={usuarios}
                            convidaveis={convidaveis}
                            anexos={anexos}
                            comentarios={comentarios}
                            convidados={convidados}
                            totalNaColuna={totalNaColuna}
                            prioridadesUsadas={prioridadesUsadas}
                            aprovadoresTestesInternos={aprovadoresTestesInternos}
                            onUpdate={update}
                            onComentar={comentar}
                            onAnexar={anexar}
                            onDownloadAnexo={downloadAnexo}
                            onAdicionarConvidado={adicionarConvidado}
                            onRemoverConvidado={removerConvidado}
                            onExcluir={excluirCard}
                          />
                        );
                      }
                      if (!temDadoResumo(etapa.key, cardDetalhe, anexos, comentarios, convidados)) return null;
                      const Resumo = RESUMOS[etapa.key];
                      if (!Resumo) return null;
                      return (
                        <Resumo
                          key={etapa.key}
                          card={cardDetalhe}
                          anexos={anexos}
                          comentarios={comentarios}
                          usuarios={usuarios}
                          onDownloadAnexo={downloadAnexo}
                        />
                      );
                    })}

                    {convidados.length > 0 && cardDetalhe.etapa !== "solicitacao_demanda" && (
                      <div>
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Convidados</p>
                        <div className="space-y-1">
                          {convidados.map((c) => (
                            <div key={c.id} className="rounded border border-border px-2 py-1.5 text-xs">
                              {nomeUsuario(usuarios, c.user_id) ?? c.user_id}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Anexos gerais</p>
                      <div className="space-y-1">
                        {anexosGerais.map((a) => (
                          <div key={a.id} className="flex justify-between rounded border border-border px-2 py-1.5 text-xs leading-4">
                            <span className="truncate" title={a.nome_arquivo}>{a.nome_arquivo}</span>
                            <button type="button" onClick={() => downloadAnexo(a.storage_path)} className="ml-2 shrink-0 text-primary hover:underline">
                              abrir
                            </button>
                          </div>
                        ))}
                        {anexosGerais.length === 0 && <p className="text-[11px] text-muted-foreground">Nenhum anexo geral ainda.</p>}
                      </div>
                    </div>

                    {assinaturas.length > 0 && (
                      <div className="space-y-3 border-t border-border pt-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Assinaturas</p>
                        {ETAPAS.filter((e) => assinaturas.some((a) => a.etapa === e.key)).map((etapa) => (
                          <div key={etapa.key} className="space-y-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                              Coluna: {etapa.label}
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                              {assinaturas.filter((a) => a.etapa === etapa.key).map((a) => (
                                <div key={a.id} className="rounded border border-border p-2 text-center">
                                  <img
                                    src={a.assinatura_png}
                                    alt="Assinatura"
                                    crossOrigin="anonymous"
                                    className="mx-auto mb-1 h-10 max-w-full object-contain"
                                  />
                                  <p className="text-[11px] font-medium leading-tight">{nomeUsuario(usuarios, a.user_id) ?? "Usuário"}</p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {new Date(a.created_at).toLocaleString("pt-BR")}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex h-[420px] min-h-0 min-w-0 flex-col border-l border-border pl-4">
                    <p className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Encaminhamentos</p>
                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                      {comentariosGerais.map((c) => {
                        const nome = nomeUsuario(usuarios, c.autor_id) ?? "Usuário";
                        return (
                          <div key={c.id} className="flex items-start gap-2">
                            <Avatar className="h-6 w-6 shrink-0">
                              <AvatarFallback className="text-[9px]">{iniciais(nome)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="text-[11px]">
                                <span className="font-medium">{nome}</span>
                                <span className="ml-1.5 text-muted-foreground">{new Date(c.created_at).toLocaleString("pt-BR")}</span>
                              </p>
                              <p className="break-words text-xs">{c.texto}</p>
                            </div>
                          </div>
                        );
                      })}
                      {comentariosGerais.length === 0 && <p className="text-[11px] text-muted-foreground">Nenhum comentário ainda.</p>}
                    </div>
                    <div className="mt-3 flex shrink-0 items-center gap-2">
                      <Input
                        placeholder="Comentar..."
                        value={novoComentario}
                        onChange={(e) => setNovoComentario(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && comentarGeral()}
                        className="text-xs"
                      />
                      <Button size="sm" variant="ghost" onClick={comentarGeral} disabled={!novoComentario.trim() || enviandoComentario}>
                        Enviar
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
