import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useReuniaoDetalhe } from "./useReuniaoDetalhe";
import { useUsuariosAtivos } from "./useReunioes";
import { ChecklistPreInicio } from "./componentes/ChecklistPreInicio";
import { ChecklistEncerramento } from "./componentes/ChecklistEncerramento";
import { CronometroReuniao } from "./componentes/CronometroReuniao";
import { PautaConducao } from "./componentes/PautaConducao";
import { PresencaConducaoPainel } from "./componentes/PresencaConducaoPainel";
import { AssuntoForaPautaModal } from "./componentes/AssuntoForaPautaModal";
import { ETAPA_COR, ETAPA_LABEL, FINALIDADE_LABEL, TIPO_REUNIAO_LABEL, nomeUsuario, TRATATIVA_ASSUNTO_LABEL } from "./types";

export default function ConducaoReuniao() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: usuarios = [] } = useUsuariosAtivos();
  const [assuntoOpen, setAssuntoOpen] = useState(false);
  const [iniciando, setIniciando] = useState(false);
  const [encerrando, setEncerrando] = useState(false);

  const {
    reuniao, isLoading, pauta, respostas, convidados, decisoesAcoes, assuntosForaPauta, pautaAnexos,
    iniciarReuniao, encerrarReuniao, atualizarPautaItem, salvarChecklistConducaoItem, salvarResposta,
    uploadPautaAnexo, downloadAnexo, removerPautaAnexo,
    marcarPresenca, criarDecisaoAcao, criarAcaoPlanoAcao, atualizarDecisaoAcao, removerDecisaoAcao, criarAssuntoForaPauta,
    marcarAssuntoForaPautaConcluido,
  } = useReuniaoDetalhe(id);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;

  if (!reuniao) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-sm text-muted-foreground">Reunião não encontrada.</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/app/central-servicos/reunioes"><ArrowLeft className="mr-1 h-4 w-4" /> Voltar</Link>
        </Button>
      </div>
    );
  }

  // Nada a conduzir depois de encerrada/cancelada — volta pro detalhe normal.
  if (reuniao.etapa === "concluida" || reuniao.etapa === "cancelada") {
    return <Navigate to={`/app/central-servicos/reunioes/${id}`} replace />;
  }

  const podeGerenciar = user?.id === reuniao.criado_por || user?.id === reuniao.responsavel_preenchimento_user_id || user?.id === reuniao.organizador_user_id;
  const souParticipante = podeGerenciar || convidados.some((c) => c.user_id === user?.id);

  if (!souParticipante) {
    return <Navigate to={`/app/central-servicos/reunioes/${id}`} replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Condução da Reunião"
        module="Central de Serviços"
        breadcrumb={["Agenda de Reunião", reuniao.titulo, "Condução"]}
        actions={
          <>
            {reuniao.etapa === "em_andamento" && reuniao.hora_inicio_real && <CronometroReuniao inicioIso={reuniao.hora_inicio_real} />}
            <Badge variant="outline" className={ETAPA_COR[reuniao.etapa]}>{ETAPA_LABEL[reuniao.etapa]}</Badge>
            <Button asChild variant="outline" size="sm">
              <Link to={`/app/central-servicos/reunioes/${id}`}><ArrowLeft className="mr-1 h-4 w-4" /> Voltar pro detalhe</Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Reunião</p>
          <p className="text-sm font-semibold">{reuniao.numero}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Tipo</p>
          <p className="text-sm font-semibold">{reuniao.tipo_reuniao ? TIPO_REUNIAO_LABEL[reuniao.tipo_reuniao] : "—"}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Finalidade</p>
          <p className="text-sm font-semibold">{reuniao.finalidade.length > 0 ? reuniao.finalidade.map((f) => FINALIDADE_LABEL[f]).join(", ") : "—"}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Data e hora</p>
          <p className="text-sm font-semibold">{new Date(reuniao.data_hora).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Duração prevista</p>
          <p className="text-sm font-semibold">{reuniao.duracao_minutos} min</p>
        </Card>
      </div>

      {podeGerenciar && reuniao.etapa === "agendada" && (
        <ChecklistPreInicio
          iniciando={iniciando}
          onIniciar={async (checklist) => {
            setIniciando(true);
            await iniciarReuniao(checklist);
            setIniciando(false);
          }}
        />
      )}

      {reuniao.etapa === "em_andamento" && !podeGerenciar && (
        <Card className="mx-auto max-w-md p-4">
          <PresencaConducaoPainel convidados={convidados} usuarios={usuarios} userId={user?.id} podeGerenciar={podeGerenciar} onMarcar={marcarPresenca} />
        </Card>
      )}

      {reuniao.etapa === "em_andamento" && podeGerenciar && (
        <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
          <Card className="min-w-0 space-y-6 p-4">
            <PautaConducao
              pauta={pauta}
              respostas={respostas}
              decisoesAcoes={decisoesAcoes}
              usuarios={usuarios}
              setorPadrao={reuniao.setor_responsavel}
              onAtualizarNatureza={(pautaId, natureza) => atualizarPautaItem(pautaId, { natureza })}
              onAtualizarPrazo={(pautaId, prazo) => atualizarPautaItem(pautaId, { prazo })}
              pautaAnexos={pautaAnexos}
              onUploadPautaAnexo={uploadPautaAnexo}
              onDownloadAnexo={downloadAnexo}
              onRemoverPautaAnexo={removerPautaAnexo}
              onSalvarChecklist={salvarChecklistConducaoItem}
              onSalvarResposta={salvarResposta}
              onCriarDecisaoAcao={criarDecisaoAcao}
              onCriarAcaoPlanoAcao={criarAcaoPlanoAcao}
              onAtualizarDecisaoAcao={atualizarDecisaoAcao}
              onRemoverDecisaoAcao={removerDecisaoAcao}
            />
          </Card>

          <div className="space-y-4">
            <Card className="p-4">
              <PresencaConducaoPainel convidados={convidados} usuarios={usuarios} userId={user?.id} podeGerenciar={podeGerenciar} onMarcar={marcarPresenca} />
            </Card>

            <Card className="space-y-2 p-4">
              <p className="text-sm font-semibold">Assuntos fora da pauta ({assuntosForaPauta.length})</p>
              <div className="space-y-1">
                {assuntosForaPauta.map((a) => (
                  <div key={a.id} className={`rounded border border-border p-2 text-xs ${a.concluido ? "opacity-60" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{a.assunto_estacionado || TRATATIVA_ASSUNTO_LABEL[a.tratativa]}</p>
                      {a.tratativa === "estacionar" && (
                        <Button
                          type="button" size="sm" variant={a.concluido ? "outline" : "default"} className="h-6 shrink-0 px-2 text-[10px]"
                          onClick={() => marcarAssuntoForaPautaConcluido(a.id, !a.concluido)}
                        >
                          {a.concluido ? "Reabrir" : "Marcar como resolvido"}
                        </Button>
                      )}
                    </div>
                    <p className="text-muted-foreground">
                      {TRATATIVA_ASSUNTO_LABEL[a.tratativa]}
                      {a.responsavel_tratativa_user_id && ` · ${nomeUsuario(usuarios, a.responsavel_tratativa_user_id)}`}
                      {a.data_prevista && ` · ${new Date(a.data_prevista).toLocaleDateString("pt-BR")}`}
                      {a.concluido && " · Resolvido"}
                    </p>
                  </div>
                ))}
                {assuntosForaPauta.length === 0 && <p className="text-xs text-muted-foreground">Nenhum assunto registrado.</p>}
              </div>
              <Button type="button" size="sm" variant="outline" className="w-full gap-1.5" onClick={() => setAssuntoOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Registrar novo assunto fora da pauta
              </Button>
            </Card>

            <ChecklistEncerramento
              horaInicioReal={reuniao.hora_inicio_real}
              encerrando={encerrando}
              onEncerrar={async (checklist) => {
                setEncerrando(true);
                const ok = await encerrarReuniao(usuarios, checklist);
                setEncerrando(false);
                if (ok) navigate(`/app/central-servicos/reunioes/${id}`);
              }}
            />
          </div>
        </div>
      )}

      {podeGerenciar && (
        <AssuntoForaPautaModal open={assuntoOpen} onOpenChange={setAssuntoOpen} usuarios={usuarios} onSalvar={criarAssuntoForaPauta} />
      )}
    </div>
  );
}
