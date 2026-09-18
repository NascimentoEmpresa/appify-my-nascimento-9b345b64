import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { novoUuid } from "@/lib/utils";

// SIS-2026-0427: migração do Extrator/Gerador de Planilha VA e VT (app
// Python desktop da Ana) pro ERP. Processamento pesado (leitura de PDF,
// decodificação Type3 da TRI) roda no worker/ — esta tela só sobe arquivo,
// grava o job e faz polling curto até `concluido`/`erro`.

const BUCKET = "extrator-beneficios";
const JOB_KEY = "extrator_beneficios_job";

export type TomadorBeneficio = "ufrgs" | "samu" | "sms" | "tj";
export type StatusJobExtrator = "pendente" | "processando" | "concluido" | "erro";

export interface JobExtratorBeneficios {
  id: string;
  tomador: TomadorBeneficio;
  status: StatusJobExtrator;
  parametros: Record<string, unknown>;
  arquivos_entrada: Record<string, string>;
  arquivo_saida_path: string | null;
  mensagem_erro: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Histórico compartilhado (decisão do usuário: qualquer um com acesso vê
// os jobs de todo o financeiro, não só os próprios).
export function useJobsExtratorBeneficios() {
  return useQuery({
    queryKey: [JOB_KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("extrator_beneficios_job")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as JobExtratorBeneficios[];
    },
    // Só repete enquanto existir job em andamento — evita poll infinito
    // depois que tudo já foi processado.
    refetchInterval: (query) => {
      const jobs = (query.state.data ?? []) as JobExtratorBeneficios[];
      const temPendente = jobs.some((j) => j.status === "pendente" || j.status === "processando");
      return temPendente ? 5000 : false;
    },
  });
}

async function subirArquivo(tomador: TomadorBeneficio, jobId: string, chave: string, arquivo: File) {
  // O nome vai sanitizado: acento e espaço no caminho do bucket viram erro
  // de "Invalid key" no Storage, e nome de arquivo brasileiro tem os dois
  // (mesmo padrão de useDiarias.ts/useDiariasUfrgs.ts).
  const seguro = arquivo.name.normalize("NFD").replace(/[^\w.-]+/g, "_");
  const path = `${tomador}/${jobId}/${chave}-${seguro}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, arquivo, { upsert: true });
  if (error) throw error;
  return path;
}

// `arquivos`: chave lógica (ex. "base", "va", "vt", "ponto", "pdf") -> File.
export function useUploadJobExtrator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      tomador,
      parametros,
      arquivos,
    }: {
      tomador: TomadorBeneficio;
      parametros: Record<string, unknown>;
      arquivos: Record<string, File>;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      const jobId = novoUuid();

      const paths: Record<string, string> = {};
      for (const [chave, arquivo] of Object.entries(arquivos)) {
        paths[chave] = await subirArquivo(tomador, jobId, chave, arquivo);
      }

      const { error } = await (supabase as any).from("extrator_beneficios_job").insert({
        id: jobId,
        tomador,
        status: "pendente",
        parametros,
        arquivos_entrada: paths,
        created_by: userData.user?.id,
      });
      if (error) throw error;
      return jobId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [JOB_KEY] });
    },
  });
}

export function useBaixarResultadoExtrator() {
  return useMutation({
    mutationFn: async (path: string) => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 5);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}
