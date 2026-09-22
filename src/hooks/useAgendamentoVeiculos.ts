import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

/**
 * Agendamento de Veículos (Central de Serviços).
 *
 * A frota NÃO é deste módulo: os carros vivem em `sup_patrimonio`, cadastrados
 * pelo Patrimônio, e aqui são só lidos — via a RPC `cs_veiculos_frota()`, que
 * existe porque a RLS de lá exige um menu que o colaborador comum não tem.
 * Nada em sup_patrimonio é escrito por este código.
 *
 * Ver supabase/migrations/20260828000001_central_servicos_agendamento_veiculos.sql.
 */

const sb = supabase as any;

export type Turno = "manha" | "tarde" | "dia_todo";
export type StatusAgendamento = "confirmado" | "cancelado" | "concluido";

export const LABEL_TURNO: Record<Turno, string> = {
  manha: "Manhã",
  tarde: "Tarde",
  dia_todo: "Dia Todo",
};

export const HORARIO_TURNO: Record<Turno, string> = {
  manha: "08h00 – 12h00",
  tarde: "13h00 – 18h00",
  dia_todo: "08h00 – 18h00",
};

/** Um veículo da frota, como o Patrimônio o mantém. */
export interface VeiculoFrota {
  id: string;
  /** A empresa DONA do carro — é nela que a reserva é arquivada. */
  empresa_id: string;
  nome: string;
  identificador: string | null;
  lotacao: string | null;
  contrato_nome: string | null;
  /** Preenchida pelo módulo de Patrimônio. Aqui só é lida. */
  foto_path: string | null;
  /** Indisponível — não só manutenção. O porquê vem em `motivo_indisponivel`. */
  em_manutencao: boolean;
  /** 'manutencao' | 'contrato' | 'outro' | null. Qualquer um deles impede o agendamento. */
  motivo_indisponivel: string | null;
  /** Texto escrito à mão no Patrimônio. Só vem quando o motivo é 'outro'. */
  motivo_detalhe: string | null;
  data_inicio_manutencao: string | null;
  data_previsao_fim: string | null;
}

export interface ContratoDoAgendamento {
  id: string;
  contrato_id: string | null;
  contrato_nome: string;
}

/** Chave da opção "viagem administrativa" (não é um contrato de verdade). */
export const CONTRATO_ADMINISTRATIVO = "administrativo";

/** Contrato oferecido no passo 3, vindo da tabela "CONTRATOS". */
export interface ContratoOpcao {
  /** Chave de seleção: o código como texto, ou CONTRATO_ADMINISTRATIVO. */
  id: string;
  /** id da "CONTRATOS". NULL na opção administrativa. */
  codigo: number | null;
  nome: string;
  empresa: string | null;
  ativo: boolean;
  administrativo?: boolean;
}

export interface Agendamento {
  id: string;
  numero: number;
  empresa_id: string;
  patrimonio_id: string;
  veiculo_nome: string;
  veiculo_identificador: string | null;
  data_inicio: string;
  data_fim: string;
  turno: Turno;
  destino: string | null;
  motivo: string | null;
  observacoes: string | null;
  status: StatusAgendamento;
  motivo_cancelamento: string | null;
  solicitante_id: string;
  solicitante_nome: string | null;
  created_at: string;
  contratos: ContratoDoAgendamento[];
}

export interface NovoAgendamento {
  veiculo: VeiculoFrota;
  data_inicio: string;
  data_fim: string;
  turno: Turno;
  destino?: string | null;
  motivo?: string | null;
  observacoes?: string | null;
  /** codigo = id da "CONTRATOS"; null + administrativo = viagem sem contrato. */
  contratos: { codigo: number | null; nome: string; administrativo?: boolean }[];
  /** KM do painel na retirada + a foto dele (obrigatórios desde 22/09/2026). */
  km_inicial: number;
  km_inicial_foto: File;
}

// ── Foto do veículo ──────────────────────────────────────────────────

/**
 * A foto do veículo mora no bucket do Patrimônio, sob o prefixo `fotos/` —
 * é lá que aquele módulo grava. O bucket é privado (guarda as notas fiscais
 * de manutenção), então a imagem só abre por signed URL; a policy que
 * autoriza isso libera SÓ o prefixo `fotos/`, ver migration 20260828000005.
 */
const BUCKET_FOTO_VEICULO = "sup-patrimonio";

/** Quanto tempo o link assinado da foto vale, em segundos. Uma hora. */
const VALIDADE_LINK_S = 3600;

/**
 * Folga para renovar o link antes de ele morrer. Com 10 min, o react-query
 * busca um link novo aos 50 min — se a folga fosse zero, uma aba aberta há
 * exatamente uma hora mostraria foto quebrada até alguém recarregar.
 */
const FOLGA_RENOVACAO_S = 600;

/**
 * Link temporário para a foto do veículo.
 *
 * Tolera URL inteira além de caminho de bucket porque a coluna é preenchida
 * por outro módulo e não dá para garantir o formato daqui — melhor tolerar do
 * que quebrar o card. Sem foto ou sem permissão, devolve null e o card fica
 * só com o ícone.
 */
export function useFotoVeiculo(fotoPath: string | null | undefined) {
  const caminho = fotoPath?.trim() || null;

  return useQuery({
    queryKey: ["foto_veiculo", caminho],
    enabled: !!caminho,
    staleTime: (VALIDADE_LINK_S - FOLGA_RENOVACAO_S) * 1000,
    retry: false,
    queryFn: async (): Promise<string | null> => {
      if (!caminho) return null;
      if (/^https?:\/\//i.test(caminho)) return caminho;
      const { data, error } = await supabase.storage
        .from(BUCKET_FOTO_VEICULO)
        .createSignedUrl(caminho, VALIDADE_LINK_S);
      if (error) return null;
      return data?.signedUrl ?? null;
    },
  });
}

// ── Disponibilidade ──────────────────────────────────────────────────
// A mesma leitura das três colunas do Patrimônio que o banco faz em
// cs_veiculo_motivo_indisponivel(). Está repetida aqui de propósito: a tela
// precisa pintar o card antes de qualquer ida ao servidor. Quem decide de
// verdade continua sendo o trigger — se as duas discordarem, o banco ganha.

export interface Disponibilidade {
  disponivel: boolean;
  rotulo: string;
  detalhe: string | null;
}

export function disponibilidadeDoVeiculo(v: VeiculoFrota, dataInicio?: string): Disponibilidade {
  if (!v.em_manutencao) return { disponivel: true, rotulo: "Livre", detalhe: null };

  // Contrato e "outro motivo" bloqueiam igual à manutenção — o que muda é só
  // o texto. Registro antigo veio sem motivo gravado: era manutenção, porque
  // até 17/08/2026 não havia outro.
  const emContrato = v.motivo_indisponivel === "contrato";
  const outro = v.motivo_indisponivel === "outro";

  // Em "outro" quem explica é o texto que o Patrimônio escreveu. Se ele vier
  // vazio — registro antigo, ou leitura por uma consulta que não trouxe a
  // coluna — cai num rótulo genérico em vez de mostrar frase pela metade.
  const porque = emContrato ? "Em contrato"
    : outro ? (v.motivo_detalhe?.trim() || "Indisponível")
    : "Em manutenção";
  const volta = emContrato ? "devolução" : outro ? "liberação" : "retorno";

  const fim = v.data_previsao_fim;
  if (!fim) {
    return {
      disponivel: false,
      rotulo: "Indisponível",
      detalhe: `${porque} · ${volta} por tempo indeterminado`,
    };
  }
  // Com previsão de retorno, o carro volta a ser agendável no dia seguinte.
  const liberaEm = new Date(`${fim}T00:00:00`);
  liberaEm.setDate(liberaEm.getDate() + 1);
  const referencia = new Date(`${dataInicio ?? hojeISO()}T00:00:00`);

  if (referencia >= liberaEm) {
    const comoVolta = emContrato ? "Volta do contrato" : outro ? "Liberado" : "Retorna";
    return { disponivel: true, rotulo: "Livre", detalhe: `${comoVolta} em ${formatarData(fim)}` };
  }
  return {
    disponivel: false,
    rotulo: "Indisponível",
    detalhe: `${porque} até ${formatarData(fim)}`,
  };
}

export function hojeISO(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

export function formatarData(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/** Turnos se chocam quando algum dos dois toma o dia inteiro. */
export function turnosConflitam(a: Turno, b: Turno): boolean {
  return a === "dia_todo" || b === "dia_todo" || a === b;
}

/** Reserva que ocupa o veículo no período pedido, se houver. */
export function conflitoNaAgenda(
  agendamentos: Agendamento[],
  patrimonioId: string,
  dataInicio: string,
  dataFim: string,
  turno: Turno,
  ignorarId?: string,
): Agendamento | null {
  return (
    agendamentos.find(
      (a) =>
        a.patrimonio_id === patrimonioId &&
        a.status === "confirmado" &&
        a.id !== ignorarId &&
        a.data_inicio <= dataFim &&
        a.data_fim >= dataInicio &&
        turnosConflitam(a.turno, turno),
    ) ?? null
  );
}

// ── Consultas ────────────────────────────────────────────────────────

export function useFrota() {
  return useQuery({
    queryKey: ["cs_veiculos_frota"],
    queryFn: async (): Promise<VeiculoFrota[]> => {
      const { data, error } = await sb.rpc("cs_veiculos_frota");
      if (error) throw error;
      return (data ?? []) as VeiculoFrota[];
    },
    staleTime: 30_000,
  });
}

/**
 * Agenda da frota.
 *
 * Sem filtro por pessoa (o Calendário Geral existe para todo mundo ver quem
 * está com qual carro) e sem filtro pela empresa ATIVA da tela: a frota do
 * grupo está concentrada num CNPJ e é dirigida por gente dos outros, então
 * prender a agenda à empresa ativa esconderia justamente as reservas que
 * interessam. Quem limita é a RLS, pelas empresas do usuário.
 */
export function useAgendamentos() {
  return useQuery({
    queryKey: ["cs_veiculo_agendamento"],
    queryFn: async (): Promise<Agendamento[]> => {
      const { data, error } = await sb
        .from("cs_veiculo_agendamento")
        .select("*, contratos:cs_veiculo_agendamento_contrato(id, contrato_id, contrato_nome)")
        .order("data_inicio", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Agendamento[];
    },
  });
}

/**
 * Contratos para o passo 3, lidos da tabela "CONTRATOS" (a base oficial,
 * com o campo ATIVO que a operação já conhece).
 *
 * Por padrão só os ativos. `incluirInativos` traz também os inativos, porque
 * contrato encerrado ainda recebe visita — mas eles ficam fora até alguém
 * pedir, senão os 141 inativos afogam os 58 que se usa todo dia.
 *
 * O gate é o menu do agendamento, igual à `cs_veiculos_frota()`.
 */
export function useContratosParaAgendamento(incluirInativos = false) {
  return useQuery({
    queryKey: ["cs_veiculos_contratos", incluirInativos],
    queryFn: async (): Promise<ContratoOpcao[]> => {
      const { data, error } = await sb.rpc("cs_veiculos_contratos", {
        p_incluir_inativos: incluirInativos,
      });
      if (error) throw error;
      const contratos = ((data ?? []) as any[]).map((c) => ({
        id: String(c.codigo),
        codigo: Number(c.codigo),
        nome: c.nome as string,
        empresa: (c.empresa ?? null) as string | null,
        ativo: !!c.ativo,
      }));
      // ADMINISTRATIVO sempre em primeiro: viagem de tarefa administrativa
      // não atende contrato nenhum, e sem essa saída a pessoa marcava um
      // contrato qualquer só para conseguir fechar a reserva.
      return [
        {
          id: CONTRATO_ADMINISTRATIVO, codigo: null, nome: "ADMINISTRATIVO",
          empresa: null, ativo: true, administrativo: true,
        },
        ...contratos,
      ];
    },
    staleTime: 60_000,
  });
}

/** Histórico de uma reserva (quem criou, quem cancelou e quando). */
export function useHistoricoAgendamento(agendamentoId: string | null) {
  return useQuery({
    queryKey: ["cs_veiculo_agendamento_log", agendamentoId],
    enabled: !!agendamentoId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("cs_veiculo_agendamento_log")
        .select("*")
        .eq("agendamento_id", agendamentoId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as {
        id: string; acao: string; detalhe: string | null;
        usuario_nome: string | null; created_at: string;
      }[];
    },
  });
}

// ── Escrita ──────────────────────────────────────────────────────────

function useInvalidar() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["cs_veiculo_agendamento"] });
    qc.invalidateQueries({ queryKey: ["cs_veiculos_frota"] });
    qc.invalidateQueries({ queryKey: ["cs_veiculo_km_pendentes"] });
  };
}

/**
 * Mensagens do banco chegam cruas ao usuário. As do trigger já foram escritas
 * para serem lidas por gente ("Veículo já reservado nesse período…"); as do
 * Postgres, não — daí a tradução das que sobram.
 */
function mensagemDeErro(e: any): string {
  const msg: string = e?.message ?? "";
  if (/cs_veic_periodo_coerente/.test(msg)) return "A data final não pode ser anterior à inicial.";
  if (/cs_veic_cancelamento_com_motivo/.test(msg)) return "Informe o motivo do cancelamento.";
  if (/row-level security|violates row-level/i.test(msg))
    return "Seu perfil não tem permissão para isso em Agendamento de Veículos.";
  return msg || "Não foi possível concluir a operação.";
}

export function useCriarAgendamento() {
  const invalidar = useInvalidar();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (n: NovoAgendamento): Promise<Agendamento> => {
      if (!user?.id) throw new Error("Sessão expirada. Entre novamente.");
      if (!n.contratos.length) throw new Error("Selecione ao menos um contrato atendido pela viagem.");
      if (!(n.km_inicial >= 0)) throw new Error("Informe o KM inicial do painel.");
      if (!n.km_inicial_foto) throw new Error("Anexe a foto do painel com o KM inicial.");
      // A foto sobe antes: sem ela o banco recusa a reserva (trigger).
      const fotoKm = await subirArquivoVeiculo(n.km_inicial_foto, "km/novos");

      const { data, error } = await sb
        .from("cs_veiculo_agendamento")
        .insert({
          // A empresa DONA do carro, não a ativa na tela: senão o veículo
          // seria de um CNPJ e a reserva dele de outro.
          empresa_id: n.veiculo.empresa_id,
          patrimonio_id: n.veiculo.id,
          veiculo_nome: n.veiculo.nome,
          veiculo_identificador: n.veiculo.identificador,
          data_inicio: n.data_inicio,
          data_fim: n.data_fim,
          turno: n.turno,
          destino: n.destino?.trim() || null,
          motivo: n.motivo?.trim() || null,
          observacoes: n.observacoes?.trim() || null,
          solicitante_id: user.id,
          km_inicial: n.km_inicial,
          km_inicial_foto: fotoKm.path,
        })
        .select("*")
        .single();
      if (error) throw error;

      // Os contratos vão num segundo INSERT: se ele falhar, a reserva já
      // existe e o usuário perderia a vaga do carro sem saber. Por isso o
      // erro aqui é avisado, não propagado — a reserva vale, e o vínculo
      // pode ser refeito.
      // contrato_id (uuid, da tabela antiga) fica nulo nos vínculos novos —
      // o que identifica o contrato agora é contrato_codigo + contrato_nome.
      const vinculos = n.contratos.map((c) => ({
        agendamento_id: data.id,
        contrato_id: null,
        contrato_codigo: c.codigo,
        contrato_nome: c.nome,
        administrativo: !!c.administrativo,
      }));
      const { error: errCtr } = await sb.from("cs_veiculo_agendamento_contrato").insert(vinculos);
      if (errCtr) toast.warning("Reserva criada, mas os contratos não foram vinculados.");

      return data as Agendamento;
    },
    onSuccess: (a) => {
      invalidar();
      toast.success(`Agendamento nº ${a.numero} confirmado.`);
    },
    onError: (e: any) => toast.error(mensagemDeErro(e)),
  });
}

export function useCancelarAgendamento() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (v: { id: string; motivo: string }) => {
      if (!v.motivo.trim()) throw new Error("Informe o motivo do cancelamento.");
      const { data, error } = await sb
        .from("cs_veiculo_agendamento")
        .update({ status: "cancelado", motivo_cancelamento: v.motivo.trim() })
        .eq("id", v.id)
        .select("id");
      if (error) throw error;
      // UPDATE barrado pela RLS não devolve erro, devolve zero linhas.
      if (!data?.length) throw new Error("Você só pode cancelar os seus próprios agendamentos.");
    },
    onSuccess: () => { invalidar(); toast.success("Agendamento cancelado."); },
    onError: (e: any) => toast.error(mensagemDeErro(e)),
  });
}

// =====================================================================
// KM com foto do painel e nota de abastecimento (22/09/2026, mig 211).
//
// Chamado: rastrear quem usou o carro, para qual contrato e com qual nota
// de combustível — o que antes vivia num grupo de WhatsApp. KM inicial +
// foto na retirada, KM final + foto na devolução (sem fechar, não se agenda
// outro carro — a trava é do banco), e a nota anexada na viagem com os
// contratos que ela atende.
// =====================================================================

/** Bucket das fotos de painel e das notas de abastecimento. */
export const BUCKET_VEICULOS = "cs-veiculos";

export interface ContratoSimples { codigo: number | null; nome: string; administrativo?: boolean }

export interface Abastecimento {
  id: string; data: string; descricao: string | null; valor: number | null; litros: number | null; km: number | null;
  storage_path: string; nome_arquivo: string; criado_por_nome: string | null; created_at: string;
  contratos: ContratoSimples[];
}

export interface Viagem {
  id: string; numero: number; veiculo_nome: string; veiculo_identificador: string | null;
  data_inicio: string; data_fim: string; turno: Turno; status: StatusAgendamento;
  solicitante_nome: string | null; solicitante_id: string;
  destino: string | null; motivo: string | null; observacoes: string | null;
  km_inicial: number | null; km_inicial_foto: string | null; km_inicial_em: string | null;
  km_final: number | null; km_final_foto: string | null; km_final_em: string | null;
  rodados: number | null;
  contratos: ContratoSimples[];
  abastecimentos: Abastecimento[];
}

export interface KmPendente {
  id: string; numero: number; veiculo_nome: string; data_inicio: string; data_fim: string; km_inicial: number;
}

/** Sobe foto/nota e devolve o caminho no bucket. */
export async function subirArquivoVeiculo(file: File, pasta: string): Promise<{ path: string; nome: string; tipo: string; tamanho: number }> {
  const limpo = file.name.replace(/[^\w.-]+/g, "_");
  const path = `${pasta}/${Date.now()}-${limpo}`;
  const { error } = await supabase.storage.from(BUCKET_VEICULOS).upload(path, file, { contentType: file.type || undefined });
  if (error) throw new Error(`Não deu para enviar "${file.name}": ${error.message}`);
  return { path, nome: file.name, tipo: file.type || "", tamanho: file.size };
}

/** Abre foto/nota do bucket privado numa aba. */
export async function abrirArquivoVeiculo(path: string): Promise<void> {
  const { data, error } = await supabase.storage.from(BUCKET_VEICULOS).createSignedUrl(path, VALIDADE_LINK_S);
  if (error || !data?.signedUrl) { toast.error("Não consegui abrir o arquivo."); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

/** Viagens minhas que terminaram e não tiveram o KM final fechado. */
export function useKmPendentes() {
  return useQuery({
    queryKey: ["cs_veiculo_km_pendentes"],
    queryFn: async (): Promise<KmPendente[]> => {
      const { data, error } = await sb.rpc("cs_veiculo_km_pendentes");
      if (error) throw error;
      return (data ?? []) as KmPendente[];
    },
    staleTime: 30_000,
  });
}

/** A viagem inteira: KM, contratos e notas de abastecimento. */
export function useViagem(agendamentoId: string | null) {
  return useQuery({
    queryKey: ["cs_veiculo_viagem", agendamentoId],
    enabled: !!agendamentoId,
    queryFn: async (): Promise<Viagem> => {
      const { data, error } = await sb.rpc("cs_veiculo_viagem", { p_agendamento: agendamentoId });
      if (error) throw error;
      return data as Viagem;
    },
  });
}

function useInvalidarViagem() {
  const qc = useQueryClient();
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: ["cs_veiculo_viagem", id] });
    qc.invalidateQueries({ queryKey: ["cs_veiculo_agendamento"] });
    qc.invalidateQueries({ queryKey: ["cs_veiculo_km_pendentes"] });
  };
}

export function useFecharKm() {
  const invalidar = useInvalidarViagem();
  return useMutation({
    mutationFn: async (v: { id: string; km: number; foto: File }) => {
      const arq = await subirArquivoVeiculo(v.foto, `km/${v.id}`);
      const { error } = await sb.rpc("cs_veiculo_km_final", { p_agendamento: v.id, p_km: v.km, p_foto: arq.path });
      if (error) throw error;
    },
    onSuccess: (_d, v) => { invalidar(v.id); toast.success("KM final registrado. Viagem fechada."); },
    onError: (e: any) => toast.error(mensagemDeErro(e)),
  });
}

export function useDefinirContratosDaViagem() {
  const invalidar = useInvalidarViagem();
  return useMutation({
    mutationFn: async (v: { id: string; contratos: ContratoSimples[] }) => {
      const { error } = await sb.rpc("cs_veiculo_contratos_definir", { p_agendamento: v.id, p_contratos: v.contratos });
      if (error) throw error;
    },
    onSuccess: (_d, v) => { invalidar(v.id); toast.success("Contratos da viagem atualizados."); },
    onError: (e: any) => toast.error(mensagemDeErro(e)),
  });
}

export function useRegistrarAbastecimento() {
  const invalidar = useInvalidarViagem();
  return useMutation({
    mutationFn: async (v: {
      id: string; arquivo: File; contratos: ContratoSimples[];
      descricao?: string; data?: string; valor?: number | null; litros?: number | null; km?: number | null;
    }) => {
      const arq = await subirArquivoVeiculo(v.arquivo, `notas/${v.id}`);
      const { error } = await sb.rpc("cs_veiculo_abastecimento_registrar", {
        p_agendamento: v.id,
        p_arquivo: { path: arq.path, nome: arq.nome, tipo: arq.tipo, tamanho: String(arq.tamanho) },
        p_contratos: v.contratos,
        p_descricao: v.descricao ?? null,
        p_data: v.data || null,
        p_valor: v.valor ?? null,
        p_litros: v.litros ?? null,
        p_km: v.km ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => { invalidar(v.id); toast.success("Nota de abastecimento anexada."); },
    onError: (e: any) => toast.error(mensagemDeErro(e)),
  });
}
