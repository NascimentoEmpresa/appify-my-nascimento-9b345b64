import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
const paraReais = (centavos: number | null | undefined) => (Number(centavos) || 0) / 100;

export interface ContratoDiaria {
  id: string;
  nome: string;
  cliente: string | null;
  empresa: string | null;
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

/**
 * Aprovar ou reprovar. Quem decidiu e quando são carimbados pela trigger
 * diaria_guard() a partir do usuário logado — não são mandados daqui. Na
 * aprovação, a mesma trigger cria atomicamente a despesa em rascunho no
 * Malote; se o Malote recusar, o status da diária também não muda.
 */
export function useDecidirSolicitacaoDiaria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status: Extract<StatusSolicitacao, "aprovada" | "reprovada">;
      maloteMotivo?: string;
      maloteDataPagamento?: string;
    }) => {
      const patch: Record<string, unknown> = { status: input.status };
      if (input.status === "aprovada") {
        patch.malote_motivo = input.maloteMotivo ?? null;
        patch.malote_data_pagamento = input.maloteDataPagamento || null;
      }
      const { error } = await sb
        .from("DIARIA_SOLICITACAO")
        .update(patch)
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
