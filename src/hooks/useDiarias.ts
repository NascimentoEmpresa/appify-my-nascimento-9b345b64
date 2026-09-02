import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { NovaParcela, RateioLinha, uploadAnexoMalote } from "@/hooks/useMaloteDespesa";
import {
  AnexoDiaria,
  LinhaDiaria,
  SolicitacaoDiaria,
  StatusSolicitacao,
  TurnoDiaria,
} from "@/pages/operacional/diarias";

/**
 * Controle de Diárias — Operacional.
 *
 * Backend em supabase/migrations/20260930000019_operacional_diarias.sql.
 * De onde vem cada dropdown (e por quê) está documentado no cabeçalho de lá;
 * o resumo é: contrato de `contratos` (a base que vem de Licitações), posto de
 * `sup_posto` (o mesmo catálogo do Supply), faltante e diarista de EMPREGADOS.
 *
 * As tabelas DIARIA_* são novas e ainda não estão em
 * src/integrations/supabase/types.ts (que é gerado à mão, fora do CI), então
 * as chamadas passam pelo `sb` destipado — mesmo padrão de useSupCatalogo.
 */

// As tabelas DIARIA_* e as RPCs desta entrega ainda não existem no arquivo de
// tipos gerado. O cast fica isolado nesta borda e os retornos são tipados logo
// abaixo, em vez de espalhar `any` pelo restante da tela.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const BUCKET = "diarias";

// O banco guarda dinheiro em centavos (inteiro); a tela trabalha em reais.
// Converter nas bordas evita que 0.1 + 0.2 apareça num total de pagamento.
const paraCentavos = (reais: number) => Math.round((Number(reais) || 0) * 100);
// O PostgREST devolve numeric como string, e as interfaces *Banco ja declaram
// `number | string | null`. O Number() interno sempre deu conta das duas formas;
// so a assinatura nao dizia isso, e mapearLinha batia em TS2345 desde sempre.
const paraReais = (centavos: number | string | null | undefined) => (Number(centavos) || 0) / 100;

export interface ContratoDiaria {
  id: string;
  nome: string;
  cliente: string | null;
  empresa: string | null;
}

/** Empresa real do contrato, usada pelo rateio do Malote na aprovação. */
export function useEmpresaContratoDiaria(contratoId: string | null | undefined) {
  return useQuery({
    queryKey: ["diaria_empresa_contrato", contratoId],
    enabled: !!contratoId,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await sb.rpc("diaria_empresa_contrato", {
        p_contrato_id: contratoId,
      });
      if (error) throw error;
      return (data as string | null | undefined) ?? null;
    },
  });
}

export interface PostoDiaria {
  id: string;
  nome: string;
}

export interface EmpregadoDiaria {
  id: number;
  nome: string;
  cpf: string;
  cargo: string | null;
}

export interface NovaLinhaDiaria {
  data: string;
  turno: TurnoDiaria;
  qtVt: number;
  valorUnitVt: number;
  valorDiaria: number;
}

export interface NovaSolicitacaoDiaria {
  contratoId: string;
  postoId: string | null;
  postoNome: string;
  faltanteEmpregadoId: number | null;
  faltanteNome: string;
  faltanteCpf: string;
  diaristaEmpregadoId: number | null;
  diaristaNome: string;
  diaristaCpf: string;
  pix: string;
  observacoes: string;
  linhas: NovaLinhaDiaria[];
  comprovantePonto: File[];
  documentos: File[];
}

interface ContratoDiariaRpc {
  contrato_id: string;
  nome: string;
  cliente: string | null;
  empresa: string | null;
}

interface PostoDiariaRpc {
  posto_id: string;
  nome: string;
}

interface EmpregadoDiariaRpc {
  empregado_id: number | string;
  nome: string | null;
  cpf: string | null;
  cargo: string | null;
}

interface LinhaDiariaBanco {
  id: string;
  data: string;
  turno: TurnoDiaria;
  qt_vt: number | string | null;
  valor_unit_vt_centavos: number | string | null;
  valor_diaria_centavos: number | string | null;
}

interface AnexoDiariaBanco {
  categoria: AnexoDiaria["categoria"];
  storage_path: string;
  nome_arquivo: string | null;
  tamanho_bytes: number | string | null;
  created_at: string;
}

interface SolicitacaoDiariaBanco {
  id: string;
  numero: string | null;
  status: StatusSolicitacao;
  contrato_id: string;
  contrato_nome: string;
  contrato_cliente: string | null;
  contrato_empresa: string | null;
  posto_nome: string;
  faltante_nome: string;
  faltante_cpf: string;
  diarista_nome: string;
  diarista_cpf: string;
  pix: string;
  observacoes: string | null;
  solicitante_id: string;
  solicitante_nome: string | null;
  malote_motivo: string | null;
  malote_data_pagamento: string | null;
  created_at: string;
  linhas: LinhaDiariaBanco[] | null;
  anexos: AnexoDiariaBanco[] | null;
}

interface AnexoEnviado {
  categoria: AnexoDiaria["categoria"];
  storage_path: string;
  nome_arquivo: string;
  mime_type: string;
  tamanho_bytes: string;
}

export function mensagemErroDiaria(erro: unknown, padrao: string) {
  if (erro instanceof Error && erro.message) return erro.message;
  if (erro && typeof erro === "object" && "message" in erro) {
    const message = (erro as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return padrao;
}

// ── Consultas ────────────────────────────────────────────────────────

/** Contratos do dropdown. Só os ativos, já recortados pela permissão da tela. */
export function useContratosDiaria() {
  return useQuery({
    queryKey: ["diaria_contratos"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ContratoDiaria[]> => {
      const { data, error } = await sb.rpc("diaria_contratos");
      if (error) throw error;
      return ((data ?? []) as ContratoDiariaRpc[]).map((c) => ({
        id: c.contrato_id,
        nome: c.nome,
        cliente: c.cliente,
        empresa: c.empresa,
      }));
    },
  });
}

/** Postos do contrato escolhido. Lista vazia = falta cadastrar posto no contrato. */
export function usePostosDiaria(contratoId: string | null) {
  return useQuery({
    queryKey: ["diaria_postos", contratoId],
    enabled: !!contratoId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PostoDiaria[]> => {
      const { data, error } = await sb.rpc("diaria_postos", { p_contrato_id: contratoId });
      if (error) throw error;
      return ((data ?? []) as PostoDiariaRpc[]).map((p) => ({ id: p.posto_id, nome: p.nome }));
    },
  });
}

/**
 * Busca de empregado para os campos de Faltante e Diarista. A RPC casa nome
 * sem acento em qualquer ordem e CPF pelos dígitos — é ela que preenche o CPF,
 * porque digitar CPF na mão é como se paga a pessoa errada.
 */
export function useBuscaEmpregadosDiaria(termo: string) {
  const busca = termo.trim();
  return useQuery({
    queryKey: ["diaria_empregados", busca],
    enabled: busca.length >= 2,
    staleTime: 60_000,
    queryFn: async (): Promise<EmpregadoDiaria[]> => {
      const { data, error } = await sb.rpc("diaria_buscar_empregados", { p_termo: busca });
      if (error) throw error;
      return ((data ?? []) as EmpregadoDiariaRpc[]).map((e) => ({
        id: Number(e.empregado_id),
        nome: e.nome ?? "",
        cpf: e.cpf ?? "",
        cargo: e.cargo ?? null,
      }));
    },
  });
}

/**
 * Todas as solicitações que o usuário enxerga, já no formato do domínio da
 * tela. A lista vem inteira de propósito: os filtros, a paginação e o aviso de
 * duplicidade do modal são calculados em cima da base toda, e é ela também que
 * alimenta os quatro cards de resumo.
 */
export function useSolicitacoesDiaria() {
  return useQuery({
    queryKey: ["diaria_solicitacoes"],
    queryFn: async (): Promise<SolicitacaoDiaria[]> => {
      const { data, error } = await sb
        .from("DIARIA_SOLICITACAO")
        .select(
          `id, numero, status, contrato_id, contrato_nome, contrato_cliente, contrato_empresa, posto_id, posto_nome,
           faltante_empregado_id, faltante_nome, faltante_cpf,
           diarista_empregado_id, diarista_nome, diarista_cpf, pix,
           observacoes, valor_total_centavos, solicitante_id, solicitante_nome,
           malote_motivo, malote_data_pagamento, created_at,
           linhas:DIARIA_LINHA ( id, data, turno, qt_vt, valor_unit_vt_centavos, valor_diaria_centavos ),
           anexos:DIARIA_ANEXO ( id, categoria, storage_path, nome_arquivo, mime_type, tamanho_bytes, created_at )`,
        )
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return ((data ?? []) as SolicitacaoDiariaBanco[]).map(mapearSolicitacao);
    },
  });
}

// ── Escritas ─────────────────────────────────────────────────────────

/**
 * Cria a solicitação inteira. Os arquivos sobem primeiro (o caminho no bucket
 * é diarias/<id>/..., por isso o id é gerado aqui) e só então a RPC grava
 * cabeçalho, diárias e anexos numa transação só. Se a RPC recusar — típico:
 * duplicidade de escala barrada pela trigger — nada fica no banco.
 */
export function useCriarSolicitacaoDiaria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NovaSolicitacaoDiaria) => {
      const id = crypto.randomUUID();
      const caminhosEnviados: string[] = [];

      try {
        const comprovantes = await enviarArquivos(id, "comprovante_ponto", input.comprovantePonto);
        caminhosEnviados.push(...comprovantes.map((a) => a.storage_path));
        const documentos = await enviarArquivos(id, "documento", input.documentos);
        caminhosEnviados.push(...documentos.map((a) => a.storage_path));
        const anexos = [...comprovantes, ...documentos];

        const { data, error } = await sb.rpc("diaria_criar_solicitacao", {
          p_dados: {
            id,
            contrato_id: input.contratoId,
            posto_id: input.postoId ?? "",
            posto_nome: input.postoNome,
            faltante_empregado_id: input.faltanteEmpregadoId ?? "",
            faltante_nome: input.faltanteNome,
            faltante_cpf: input.faltanteCpf,
            diarista_empregado_id: input.diaristaEmpregadoId ?? "",
            diarista_nome: input.diaristaNome,
            diarista_cpf: input.diaristaCpf,
            pix: input.pix,
            observacoes: input.observacoes,
            diarias: input.linhas.map((l) => ({
              data: l.data,
              turno: l.turno,
              qt_vt: l.qtVt,
              valor_unit_vt_centavos: paraCentavos(l.valorUnitVt),
              valor_diaria_centavos: paraCentavos(l.valorDiaria),
            })),
            anexos,
          },
        });
        if (error) throw error;
        const linha = Array.isArray(data) ? data[0] : data;
        return { id, numero: (linha?.numero as string) ?? "" };
      } catch (erro) {
        // Upload e INSERT não podem compartilhar a mesma transação. Se o
        // banco recusar a solicitação, remove os objetos recém-enviados para
        // não acumular anexos órfãos no bucket.
        await removerArquivosSilenciosamente(caminhosEnviados);
        throw erro;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["diaria_solicitacoes"] }),
  });
}

export interface DespesaAprovacaoDiaria {
  nome: string;
  valor_total: number;
  data_pagamento: string | null;
  competencia: string | null;
  forma_pagamento: string | null;
  informacoes_pagamento: string | null;
  excecao?: boolean;
  justificativa_excecao?: string | null;
  parcelado?: boolean;
  numero_parcelas?: number | null;
  dia_desconto?: number | null;
  rateio?: RateioLinha[];
  parcelas?: NovaParcela[];
  arquivosNovos: File[];
}

/**
 * Aprovar ou reprovar. Quem decidiu e quando são carimbados pela trigger
 * diaria_guard() a partir do usuário logado — não são mandados daqui.
 *
 * SIS-2026-0287: reprovar continua no UPDATE simples; aprovar chama a RPC
 * SECURITY DEFINER que cria despesa, rateio e parcelas e só então muda a
 * diária para aprovada, tudo na mesma transação. Se qualquer regra do Malote
 * recusar, nenhum dos registros fica pela metade. Os anexos continuam depois,
 * porque o caminho no Storage depende do id devolvido pela RPC.
 */
export function useDecidirSolicitacaoDiaria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status: Extract<StatusSolicitacao, "aprovada" | "reprovada">;
      despesa?: DespesaAprovacaoDiaria;
    }) => {
      if (input.status === "aprovada") {
        if (!input.despesa) throw new Error("Preencha os dados da despesa do Malote.");
        const { arquivosNovos, ...pDespesa } = input.despesa;
        const { data, error } = await sb.rpc("diaria_aprovar_com_despesa", {
          p_solicitacao_id: input.id,
          p_despesa: pDespesa,
        });
        if (error) throw error;
        const despesaId = typeof data === "string" ? data : (data?.id as string | undefined);
        if (!despesaId) throw new Error("A aprovação não devolveu o id da despesa criada.");

        // SIS-2026-0287 (correção): os anexos da diária NÃO iam para o Malote.
        // Eles são obrigatórios na criação (diaria_solicitacao_criar recusa sem
        // comprovante de ponto e sem documento) e ficam no bucket "diarias", mas
        // nada nunca os levou adiante — a despesa nascia com arquivos vazio e o
        // N1 aprovava pagamento a pessoa física sem ver a papelada.
        //
        // Copiamos em vez de só referenciar: o bucket "diarias" exige
        // can_access('operacional_diarias','visualizar'), que o aprovador da
        // Controladoria normalmente NÃO tem — ele veria o anexo listado e
        // tomaria erro ao clicar. Em "malote-anexos" valem as regras do Malote.
        // De quebra, a cópia congela o que foi aprovado, independente do que
        // aconteça com os anexos da diária depois.
        const { paths: pathsDaDiaria, falhas } = await copiarAnexosDiariaParaMalote(input.id, despesaId);
        let anexosComFalha = falhas.length > 0;

        const resultados = await Promise.allSettled(
          arquivosNovos.map((arquivo) => uploadAnexoMalote(arquivo, despesaId)),
        );
        const pathsDoAprovador = resultados
          .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
          .map((r) => r.value);
        anexosComFalha ||= resultados.some((r) => r.status === "rejected");

        // Os da diária primeiro: é a ordem em que o Malote lê o caso (papelada
        // da solicitação, depois o que o aprovador juntou na hora).
        const paths = [...pathsDaDiaria, ...pathsDoAprovador];
        if (paths.length > 0) {
          const { error: erroAnexos } = await sb
            .from("malote_despesa")
            .update({ arquivos: paths })
            .eq("id", despesaId)
            .select("id")
            .single();
          anexosComFalha ||= !!erroAnexos;
        }
        if (anexosComFalha) {
          // Aviso, não erro: a diária já está aprovada e a despesa já existe.
          // Derrubar tudo por causa de um arquivo seria pior do que avisar.
          const quais = falhas.length > 0 ? ` (${falhas.join(", ")})` : "";
          toast.warning(`A diária e a despesa foram aprovadas, mas um ou mais anexos falharam${quais}. Abra a despesa no Malote e reenvie os arquivos.`);
        }
        return despesaId;
      }

      const { error } = await sb
        .from("DIARIA_SOLICITACAO")
        .update({ status: "reprovada" })
        .eq("id", input.id)
        .select("id")
        .single();
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["diaria_solicitacoes"] }),
  });
}

/** Link temporário para abrir um anexo — o bucket é privado. */
export async function urlAnexoDiaria(storagePath: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 300);
  if (error) throw error;
  return data.signedUrl;
}

// ── Apoio ────────────────────────────────────────────────────────────

/** O que a cópia para o Malote precisa saber de cada anexo da diária. */
interface AnexoParaCopiar {
  categoria: AnexoDiaria["categoria"];
  storage_path: string;
  nome_arquivo: string | null;
  mime_type: string | null;
}

/**
 * Leva os anexos da diária para a pasta da despesa no Malote (SIS-2026-0287).
 *
 * Baixa de "diarias" e sobe em "malote-anexos" — os dois buckets têm regras de
 * acesso diferentes, então link não resolveria (o porquê está no comentário da
 * aprovação). Roda com o login de quem aprova, que tem leitura no primeiro e
 * escrita no segundo; não precisa de função SECURITY DEFINER.
 *
 * O nome vai legível ("comprovante-ponto-<arquivo>"), porque a tela da despesa
 * usa o último pedaço do caminho como rótulo e uploadAnexoMalote() batiza tudo
 * de UUID — inútil para quem precisa saber qual é o comprovante do ponto.
 *
 * Nunca lança: quando isto roda a despesa já existe e a diária já está
 * aprovada. Devolve o que subiu e o nome do que falhou, para o aviso na tela.
 */
async function copiarAnexosDiariaParaMalote(
  solicitacaoId: string,
  despesaId: string,
): Promise<{ paths: string[]; falhas: string[] }> {
  const paths: string[] = [];
  const falhas: string[] = [];

  const { data, error } = await sb
    .from("DIARIA_ANEXO")
    .select("categoria, storage_path, nome_arquivo, mime_type")
    .eq("solicitacao_id", solicitacaoId)
    .order("categoria");
  if (error || !data) return { paths, falhas: ["não foi possível ler os anexos da diária"] };

  const usados = new Set<string>();
  for (const anexo of data as AnexoParaCopiar[]) {
    const rotulo = anexo.categoria === "comprovante_ponto" ? "comprovante-ponto" : "documento";
    const nomeExibido = anexo.nome_arquivo || anexo.storage_path.split("/").pop() || "anexo";
    try {
      const { data: blob, error: erroDownload } = await supabase.storage
        .from(BUCKET)
        .download(anexo.storage_path);
      if (erroDownload || !blob) throw erroDownload ?? new Error("arquivo vazio");

      // Mesma sanitização do upload da diária: acento e espaço no caminho do
      // bucket viram "Invalid key" no Storage, e nome brasileiro tem os dois.
      const seguro = nomeExibido.normalize("NFD").replace(/[^\w.-]+/g, "_");
      let nome = `${rotulo}-${seguro}`;
      // Dois documentos com o mesmo nome existem; o Storage recusa o segundo.
      for (let n = 2; usados.has(nome); n++) nome = `${rotulo}-${n}-${seguro}`;
      usados.add(nome);

      const caminho = `${despesaId}/${nome}`;
      const { error: erroUpload } = await supabase.storage
        .from("malote-anexos")
        .upload(caminho, blob, { contentType: anexo.mime_type || blob.type || undefined });
      if (erroUpload) throw erroUpload;
      paths.push(caminho);
    } catch {
      falhas.push(nomeExibido);
    }
  }
  return { paths, falhas };
}

async function enviarArquivos(
  solicitacaoId: string,
  categoria: AnexoDiaria["categoria"],
  arquivos: File[],
): Promise<AnexoEnviado[]> {
  const enviados: AnexoEnviado[] = [];
  try {
    for (const arquivo of arquivos) {
      // O nome vai sanitizado: acento e espaço no caminho do bucket viram erro
      // de "Invalid key" no Storage, e nome de arquivo brasileiro tem os dois.
      const seguro = arquivo.name.normalize("NFD").replace(/[^\w.-]+/g, "_");
      const path = `${solicitacaoId}/${categoria}/${Date.now()}-${seguro}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, arquivo);
      if (error) throw error;
      enviados.push({
        categoria,
        storage_path: path,
        nome_arquivo: arquivo.name,
        mime_type: arquivo.type,
        tamanho_bytes: String(arquivo.size),
      });
    }
  } catch (erro) {
    await removerArquivosSilenciosamente(enviados.map((a) => a.storage_path));
    throw erro;
  }
  return enviados;
}

async function removerArquivosSilenciosamente(caminhos: string[]) {
  if (caminhos.length === 0) return;
  try {
    await supabase.storage.from(BUCKET).remove(caminhos);
  } catch {
    // Limpeza de melhor esforço: o erro que importa para o usuário é o do
    // upload/RPC original, não uma segunda falha ao remover o que já subiu.
  }
}

const fmtTamanho = (bytes: number | null) =>
  !bytes ? "—" : bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const mapearAnexo = (a: AnexoDiariaBanco): AnexoDiaria => ({
  nome: a.nome_arquivo ?? a.storage_path.split("/").pop() ?? "arquivo",
  tipo: (a.nome_arquivo ?? "").split(".").pop()?.toUpperCase() || "ARQ",
  tamanho: fmtTamanho(a.tamanho_bytes ? Number(a.tamanho_bytes) : null),
  enviadoEm: new Date(a.created_at).toLocaleString("pt-BR"),
  categoria: a.categoria,
  storagePath: a.storage_path,
});

const mapearLinha = (l: LinhaDiariaBanco): LinhaDiaria => ({
  id: l.id,
  data: l.data,
  turno: l.turno,
  qtVt: Number(l.qt_vt) || 0,
  valorUnitVt: paraReais(l.valor_unit_vt_centavos),
  valorDiaria: paraReais(l.valor_diaria_centavos),
});

function mapearSolicitacao(s: SolicitacaoDiariaBanco): SolicitacaoDiaria {
  const anexos: AnexoDiaria[] = (s.anexos ?? []).map(mapearAnexo);
  return {
    uuid: s.id,
    id: s.numero ?? s.id,
    criadoEm: new Date(s.created_at).toLocaleString("pt-BR"),
    status: s.status as StatusSolicitacao,
    contratoId: s.contrato_id,
    contratoNome: s.contrato_nome ?? "—",
    contratoCliente: s.contrato_cliente ?? "—",
    contratoEmpresa: s.contrato_empresa ?? "—",
    posto: s.posto_nome ?? "—",
    faltanteNome: s.faltante_nome ?? "",
    faltanteCpf: s.faltante_cpf ?? "",
    diaristaNome: s.diarista_nome ?? "",
    diaristaCpf: s.diarista_cpf ?? "",
    pix: s.pix ?? "",
    // Ordenadas por data: a grade do modal e a lista da tela mostram a
    // sequência da escala, não a ordem em que foram digitadas.
    diarias: (s.linhas ?? []).map(mapearLinha).sort((a, b) => a.data.localeCompare(b.data)),
    comprovantePonto: anexos.filter((a) => a.categoria === "comprovante_ponto"),
    documentos: anexos.filter((a) => a.categoria === "documento"),
    observacoes: s.observacoes ?? "",
    solicitanteId: s.solicitante_id,
    solicitante: s.solicitante_nome ?? "—",
    maloteMotivo: s.malote_motivo ?? undefined,
    maloteDataPagamento: s.malote_data_pagamento ?? undefined,
  };
}
