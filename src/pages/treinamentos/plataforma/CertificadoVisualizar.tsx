import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buscarAssinatura } from "@/hooks/useTreinamentosPlataforma";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Certificado, CertificadoModelo } from "./tipos";
import { CertificadoFrente, CertificadoVerso, dataCertificado, type DadosCertificado } from "./CertificadoPreview";
import { TrnCarregando, TrnEstilo } from "./ui";

// =====================================================================
// TREINAMENTOS — certificado emitido, pronto para imprimir/salvar em PDF
// (Ctrl+P → "Salvar como PDF"). A frente e, se o modelo pedir, o verso com
// o conteúdo programático montado dos módulos/aulas do curso. Com a
// assinatura gravada na emissão, se houver (mig 20261005000003).
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export default function CertificadoVisualizar() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["trn-certificado", id],
    enabled: !!id,
    queryFn: async () => {
      const { data: c, error } = await sb.from("TRN_CERTIFICADO").select("*, aluno:TRN_ALUNO(nome, documento), curso:TRN_CURSO(nome, carga_horaria_min)").eq("id", id).single();
      if (error) throw error;
      const cert = c as Certificado & { aluno: { nome: string; documento: string | null }; curso: { nome: string; carga_horaria_min: number | null } };
      const [{ data: modelo }, { data: mods }, assinatura] = await Promise.all([
        cert.modelo_id ? sb.from("TRN_CERTIFICADO_MODELO").select("*").eq("id", cert.modelo_id).maybeSingle() : Promise.resolve({ data: null }),
        sb.from("TRN_MODULO").select("nome, posicao, TRN_AULA(nome, posicao)").eq("curso_id", cert.curso_id).order("posicao"),
        buscarAssinatura(cert.assinatura_id),
      ]);
      return { cert, modelo: modelo as CertificadoModelo | null, modulos: (mods ?? []) as any[], assinatura };
    },
  });

  if (isLoading) return <TrnCarregando texto="Montando o certificado…" />;
  if (error || !data) return <Card className="p-6 text-sm text-muted-foreground">Certificado não encontrado.</Card>;
  if (!data.modelo) return <Card className="p-6 text-sm text-muted-foreground">O modelo deste certificado foi excluído. Cadastre outro em Cursos › Certificados e vincule ao curso.</Card>;

  const dados: DadosCertificado = {
    aluno: data.cert.aluno.nome, documento: data.cert.aluno.documento, curso: data.cert.curso.nome,
    data: dataCertificado(data.cert.emitido_em),
    cargaHorariaMin: data.cert.carga_horaria_min ?? data.cert.curso.carga_horaria_min, codigo: data.cert.codigo_validacao,
    modulos: data.modulos.map((m) => ({ nome: m.nome, aulas: (m.TRN_AULA ?? []).sort((a: any, b: any) => a.posicao - b.posicao).map((a: any) => a.nome) })),
    assinatura: data.assinatura,
  };

  return (
    <div className="trn mx-auto max-w-5xl">
      <TrnEstilo />
      <style>{`@media print { body * { visibility: hidden } .trn-cert, .trn-cert * { visibility: visible } .trn-cert { position: fixed; inset: 0; width: 100vw; height: 100vh; border: none; border-radius: 0; page-break-after: always } }`}</style>
      <div className="mb-3 flex items-center justify-between print:hidden">
        <div className="text-sm text-slate-600">Certificado de <b>{dados.aluno}</b> · {dados.curso} · código <span className="font-mono">{dados.codigo}</span></div>
        <Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Imprimir / salvar PDF</Button>
      </div>
      <div className="space-y-4">
        <CertificadoFrente modelo={data.modelo} dados={dados} />
        {data.modelo.frente_verso && <CertificadoVerso modelo={data.modelo} dados={dados} />}
      </div>
    </div>
  );
}
