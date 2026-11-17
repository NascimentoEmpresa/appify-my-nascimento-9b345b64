import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, PenLine, Printer, Type } from "lucide-react";
import { toast } from "sonner";
import { CertificadoFrente, CertificadoVerso, dataCertificado } from "@/pages/treinamentos/plataforma/CertificadoPreview";
import type { CertificadoModelo } from "@/pages/treinamentos/plataforma/tipos";
import { AssinaturaTraco, FONTES_ASSINATURA, useFontesAssinatura } from "@/pages/treinamentos/plataforma/assinaturaFolha";
import { QuadroAssinatura } from "@/components/assinatura/QuadroAssinatura";
import { Input } from "@/components/ui/input";
import {
  useAssinarCertificado, useCertificadoColaborador, type CertificadoAluno, type CertificadoPendenteAssinatura,
} from "@/hooks/useColaboradorPortal";
import {
  certificadoLiberado, nomeParaAssinar, payloadAssinatura, problemaAssinaturaColaborador, rascunhoInicial, type AssinaturaColaborador,
} from "@/lib/treinamentos/certificadoColaborador";
import { Carregando, Erro, Secao } from "./ui";

// =====================================================================
// PORTAL DO COLABORADOR — certificado do curso (visualizar / imprimir)
// Reaproveita a folha do módulo Treinamentos (CertificadoPreview): mesma
// arte que o gestor vê ao emitir. O modelo vem inteiro pela RPC.
//
// 13/11/2026 (mig 20261115000200): antes de abrir, o colaborador ASSINA —
// nome escrito numa letra cursiva ou desenhado no mesmo quadro do
// Treinamentos. Sem assinatura a RPC não devolve a folha. Quem já assinou
// outro certificado abre com a última assinatura preenchida e só confirma
// (regras e motivo em lib/treinamentos/certificadoColaborador).
// =====================================================================

/** As 8 letras originais do Treinamentos: no celular, menos opção é mais rápido. */
const FONTES = FONTES_ASSINATURA.slice(0, 8);

export default function CertificadoColaborador() {
  const { cursoId } = useParams<{ cursoId: string }>();
  const q = useCertificadoColaborador(cursoId);
  const voltar = <Link to={`/colaborador/treinamentos/${cursoId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary"><ArrowLeft className="h-4 w-4" /> Voltar ao curso</Link>;

  if (q.isLoading) return <Carregando texto="Buscando o certificado…" />;
  if (q.isError || !q.data) {
    return <div className="space-y-3">{voltar}<Erro erro={q.error} /></div>;
  }
  if (!certificadoLiberado(q.data as CertificadoAluno)) {
    return <div className="space-y-3">{voltar}<EtapaAssinatura cursoId={cursoId} pendente={q.data as CertificadoPendenteAssinatura} /></div>;
  }
  const c = q.data as CertificadoAluno;
  const modelo = (c.modelo ?? {
    id: "", nome: "Padrão", titulo: "Certificado de conclusão de curso", texto_superior: "A instituição de ensino Grupo Nascimento certifica que o(a) aluno(a)", texto_inferior: "Concluiu o curso de ${curso} no dia ${data}",
    exibir_nome_negocio: true, exibir_logo: false, exibir_cnpj: false, exibir_carga_horaria: true, exibir_qr: true, exibir_documento: true,
    frente_verso: false, verso_somente_modulos: false, verso_titulo: null, layout: "esquerda", fundo_path: null, fundo_verso_path: null, created_at: "", updated_at: "",
  }) as unknown as CertificadoModelo;
  const dados = {
    aluno: c.aluno,
    documento: c.documento,
    curso: c.curso,
    data: dataCertificado(c.emitido_em),
    cargaHorariaMin: c.carga_horaria_min,
    codigo: c.codigo,
    modulos: c.modulos,
    assinatura: c.assinatura ?? null,
    assinaturaAluno: c.assinatura_aluno,
    empresa: c.empresa,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        {voltar}
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

function EtapaAssinatura({ cursoId, pendente }: { cursoId: string | undefined; pendente: CertificadoPendenteAssinatura }) {
  useFontesAssinatura();
  const assinar = useAssinarCertificado(cursoId);
  const [a, setA] = useState<AssinaturaColaborador>(() => rascunhoInicial(pendente.ultima_assinatura, pendente.aluno, FONTES[0].id));
  const set = (p: Partial<AssinaturaColaborador>) => setA((v) => ({ ...v, ...p }));
  const problema = problemaAssinaturaColaborador(a);
  const reaproveitando = !!pendente.ultima_assinatura && !problemaAssinaturaColaborador(pendente.ultima_assinatura);

  const enviar = () => {
    if (problema) { toast.error(problema); return; }
    assinar.mutate(payloadAssinatura(a), {
      onSuccess: () => toast.success("Assinatura registrada. Seu certificado está pronto."),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível assinar agora."),
    });
  };

  return (
    <Secao titulo="Assine para emitir o seu certificado" descricao={`Curso: ${pendente.curso}. A sua assinatura vai no certificado junto com a da técnica responsável.`}>
      {reaproveitando && (
        <p className="mb-3 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
          Trouxemos a assinatura que você usou no último certificado. Confira e confirme — ou troque, se quiser.
        </p>
      )}
      <div className="mb-3 inline-flex rounded-lg border p-0.5">
        {([["texto", "Escrever o nome", Type], ["desenho", "Desenhar", PenLine]] as const).map(([t, rot, Ic]) => (
          <button key={t} type="button" onClick={() => set(t === "texto" && !a.texto ? { tipo: t, texto: nomeParaAssinar(pendente.aluno), fonte: a.fonte ?? FONTES[0].id } : { tipo: t })}
            className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold ${a.tipo === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            <Ic className="h-4 w-4" /> {rot}
          </button>
        ))}
      </div>

      {a.tipo === "desenho" ? (
        <QuadroAssinatura imagem={a.imagem ?? null} onChange={(imagem) => set({ imagem })} />
      ) : (
        <div className="grid gap-3">
          <Input value={a.texto ?? ""} maxLength={80} onChange={(e) => set({ texto: e.target.value })} placeholder="Seu nome" />
          <div className="grid grid-cols-2 gap-2">
            {FONTES.map((f) => (
              <button key={f.id} type="button" onClick={() => set({ fonte: f.id })}
                className={`overflow-hidden rounded-lg border-2 bg-white px-2 pb-1 pt-2 ${a.fonte === f.id ? "border-primary ring-2 ring-primary/30" : "border-border"}`}>
                <AssinaturaTraco a={{ nome_completo: pendente.aluno, cargo: null, registro: null, tipo: "texto", imagem: null, texto: a.texto?.trim() || nomeParaAssinar(pendente.aluno), fonte: f.id, tamanho: 1 }} altura="34px" />
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Ao assinar, você confirma que concluiu este treinamento. A assinatura fica gravada neste certificado e não pode ser trocada depois.
      </p>
      <button type="button" onClick={enviar} disabled={assinar.isPending}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {assinar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />} Assinar e ver o certificado
      </button>
    </Secao>
  );
}
