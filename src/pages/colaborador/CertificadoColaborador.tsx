import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { CertificadoFrente, CertificadoVerso } from "@/pages/treinamentos/plataforma/CertificadoPreview";
import type { CertificadoModelo } from "@/pages/treinamentos/plataforma/tipos";
import { useCertificadoColaborador } from "@/hooks/useColaboradorPortal";
import { Carregando, Erro } from "./ui";

// =====================================================================
// PORTAL DO COLABORADOR — certificado do curso (visualizar / imprimir)
// Reaproveita a folha do módulo Treinamentos (CertificadoPreview): mesma
// arte que o gestor vê ao emitir. O modelo vem inteiro pela RPC.
// =====================================================================

export default function CertificadoColaborador() {
  const { cursoId } = useParams<{ cursoId: string }>();
  const q = useCertificadoColaborador(cursoId);

  if (q.isLoading) return <Carregando texto="Buscando o certificado…" />;
  if (q.isError || !q.data) {
    return (
      <div className="space-y-3">
        <Link to={`/colaborador/treinamentos/${cursoId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary"><ArrowLeft className="h-4 w-4" /> Voltar ao curso</Link>
        <Erro erro={q.error} />
      </div>
    );
  }
  const c = q.data;
  const modelo = (c.modelo ?? {
    id: "", nome: "Padrão", titulo: "Certificado de conclusão de curso", texto_superior: "Certificamos que", texto_inferior: "concluiu com êxito o curso ${curso} em ${data}.",
    exibir_nome_negocio: true, exibir_logo: false, exibir_cnpj: false, exibir_carga_horaria: true, exibir_qr: false, exibir_documento: true,
    frente_verso: false, verso_somente_modulos: false, verso_titulo: null, layout: "centro", fundo_path: null, fundo_verso_path: null, created_at: "", updated_at: "",
  }) as unknown as CertificadoModelo;
  const dados = {
    aluno: c.aluno,
    documento: c.documento,
    curso: c.curso,
    data: new Date(c.emitido_em).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" }),
    cargaHorariaMin: c.carga_horaria_min,
    codigo: c.codigo,
    modulos: c.modulos,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link to={`/colaborador/treinamentos/${cursoId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary"><ArrowLeft className="h-4 w-4" /> Voltar ao curso</Link>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          <Printer className="h-4 w-4" /> Imprimir / salvar PDF
        </button>
      </div>
      <div className="text-[10px] sm:text-xs md:text-sm">
        <CertificadoFrente modelo={modelo} dados={dados} />
      </div>
      {modelo.frente_verso && (
        <div className="text-[10px] sm:text-xs md:text-sm">
          <CertificadoVerso modelo={modelo} dados={dados} />
        </div>
      )}
      <p className="text-center text-xs text-muted-foreground print:hidden">
        Código de validação <b className="font-mono">{c.codigo}</b> · emitido em {new Date(c.emitido_em).toLocaleDateString("pt-BR")}
      </p>
    </div>
  );
}
