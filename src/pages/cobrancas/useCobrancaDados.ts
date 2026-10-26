import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNfsEmissao } from "@/hooks/useNfEmissao";
import { linhasDeCobranca, type DecisaoAuto, type LinhaCobranca, type ModoAuto, type NfParaCobranca, type NfParaRecebido, type PlanoDoContrato } from "./cobrancaNotas";

// SIS-2026-0653: dados da tela Cobranças. As notas vêm direto do Relatório de Serviços (nf_emissao), a mesma fonte da cobrança
// automática; o plano de cada contrato (próxima ação) vem da simulação da edge function e o "último e-mail" da trilha de envios.

export interface PlanoSimulado {
  contrato_id: string;
  decisao: DecisaoAuto;
  proximo_envio: string | null;
  motivo: string;
  destinatarios: string[];
}

export interface Simulacao {
  ok: boolean;
  modo: ModoAuto;
  janela_aberta: boolean;
  envio_configurado: boolean;
  gerado_em: string;
  contagem: Partial<Record<DecisaoAuto, number>>;
  planos: (PlanoSimulado & Record<string, unknown>)[];
  error?: string;
}

export interface EmpresaCobranca {
  id: string;
  codigo: string;
  nome: string;
}

export function useSimulacaoCobranca() {
  return useQuery<Simulacao>({
    queryKey: ["cobranca-auto-simulacao"],
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("cobranca-automatica", { body: { acao: "simular" } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha ao simular a cobrança.");
      return data as Simulacao;
    },
  });
}

export function useCobrancaDados() {
  const { data: nfs = [], isLoading: carregandoNfs } = useNfsEmissao(null, { todasEmpresas: true });

  const { data: empresas = [] } = useQuery<EmpresaCobranca[]>({
    queryKey: ["cobranca-empresas"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("empresas").select("id, codigo, nome_fantasia, razao_social").eq("ativa", true).order("codigo");
      if (error) throw error;
      return (data ?? []).map((e: any) => ({ id: e.id, codigo: e.codigo ?? "", nome: e.nome_fantasia || e.razao_social }));
    },
  });

  // Último e-mail de cobrança de cada contrato: só envio real (produção). O piloto manda para um e-mail de teste e não conta.
  const { data: ultimoEnvio = new Map<string, string>() } = useQuery<Map<string, string>>({
    queryKey: ["cobranca-ultimo-envio"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("cobranca_auto_envio")
        .select("contrato_id, criado_em")
        .eq("status", "enviado")
        .eq("modo", "producao")
        .order("criado_em", { ascending: false })
        .limit(5000);
      if (error) return new Map<string, string>(); // tabela ainda não existe no ambiente: coluna fica em branco
      const mapa = new Map<string, string>();
      for (const r of data ?? []) if (r.contrato_id && !mapa.has(r.contrato_id)) mapa.set(r.contrato_id, r.criado_em);
      return mapa;
    },
  });

  const simulacao = useSimulacaoCobranca();

  const codigoPorEmpresa = useMemo(() => new Map(empresas.map((e) => [e.id, e.codigo || e.nome])), [empresas]);
  const linhas: LinhaCobranca[] = useMemo(() => linhasDeCobranca(nfs as unknown as NfParaCobranca[], codigoPorEmpresa), [nfs, codigoPorEmpresa]);
  const planoPorContrato = useMemo(() => {
    const m = new Map<string, PlanoDoContrato>();
    for (const p of simulacao.data?.planos ?? []) m.set(p.contrato_id, { decisao: p.decisao, proximo_envio: p.proximo_envio });
    return m;
  }, [simulacao.data]);

  return {
    carregando: carregandoNfs,
    nfsParaRecebido: nfs as unknown as NfParaRecebido[],
    empresas,
    linhas,
    planoPorContrato,
    modoAuto: simulacao.data?.modo,
    automacaoIndisponivel: simulacao.isError,
    ultimoEnvio,
  };
}
