import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMeuNome } from "@/hooks/useMeuNome";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BuscaColaborador, type EmpregadoEscolhido } from "@/components/demissao/BuscaColaborador";
import { ArrowRight, Building2, CheckCircle2, Loader2, Send, UserCog } from "lucide-react";
import { localEhEscritorio, statusInicial, TABELA, fmtData } from "@/lib/trocaFuncao/solicitacao";
import { toast } from "sonner";

const sb = supabase as any;

/**
 * Encarregado — pedir a mudança de função de alguém da equipe.
 *
 * O caminho é o mesmo de Solicitar Demissão: escolhe o colaborador e o
 * cadastro preenche o resto. O CARGO ATUAL chega travado justamente porque
 * sai de EMPREGADOS — digitar à mão é como se cria pedido para um cargo que
 * a pessoa nem ocupa.
 *
 * Para onde vai é decidido aqui e MOSTRADO antes de enviar: contrato vai
 * para o Operacional, escritório para o administrativo. Quem só descobre o
 * caminho depois volta para perguntar "com quem está?".
 */
export default function SolicitarTrocaFuncao() {
  const { user } = useAuth();
  const meuNome = useMeuNome();
  const nav = useNavigate();

  const [colaborador, setColaborador] = useState<EmpregadoEscolhido | null>(null);
  const [cargoNovo, setCargoNovo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [dataPretendida, setDataPretendida] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [protocolo, setProtocolo] = useState<number | null>(null);

  // O local vem de "Descrição do Local"; a filial é o fallback de quem está
  // sem local no cadastro.
  const local = colaborador?.descricaoLocal || colaborador?.nomeFilial || "";
  const eEscritorio = useMemo(() => localEhEscritorio(local), [local]);

  const cargoAtual = colaborador?.cargo ?? "";
  const mesmoCargo = cargoAtual.trim().toUpperCase() === cargoNovo.trim().toUpperCase()
                  && cargoNovo.trim().length > 0;

  const problema = (): string | null => {
    if (!colaborador) return "Escolha o colaborador na lista.";
    if (!cargoNovo.trim()) return "Informe para qual cargo a pessoa vai.";
    if (mesmoCargo) return "O cargo novo é igual ao atual — não há o que trocar.";
    if (!motivo.trim()) return "Escreva o motivo da mudança.";
    return null;
  };

  const enviar = async () => {
    const erro = problema();
    if (erro) { toast.error(erro); return; }
    setEnviando(true);
    const { data, error } = await sb.from(TABELA).insert({
      solicitante_nome: meuNome,
      solicitante_email: user?.email ?? null,
      colaborador_id: colaborador!.id,
      colaborador_nome: colaborador!.nome,
      colaborador_cpf: colaborador!.cpf,
      colaborador_admissao: colaborador!.admissao,
      cargo_atual: cargoAtual || null,
      cargo_novo: cargoNovo.trim(),
      local: local || null,
      posto: colaborador!.posto || null,
      filial: colaborador!.nomeFilial || null,
      e_escritorio: eEscritorio,
      motivo: motivo.trim(),
      data_pretendida: dataPretendida || null,
      status: statusInicial(eEscritorio),
    }).select("id").single();
    setEnviando(false);
    if (error) { toast.error("Não deu para enviar: " + error.message); return; }
    setProtocolo(data?.id ?? null);
  };

  const recomecar = () => {
    setColaborador(null); setCargoNovo(""); setMotivo("");
    setDataPretendida(""); setProtocolo(null);
  };

  if (protocolo) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Mudança de Função" module="Encarregados" breadcrumb={["Mudança de Função"]} />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CheckCircle2 className="h-14 w-14 text-emerald-600 animate-in zoom-in duration-500" />
            <h2 className="text-xl font-semibold">Solicitação #{protocolo} enviada</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {eEscritorio
                ? "Vai para a aprovação do administrativo."
                : "Vai para o Operacional aprovar."}{" "}
              Depois de aprovada, o SST marca o ASO de mudança de função e o RH faz a alteração na Senior.
              Você acompanha o andamento em Minhas Solicitações.
            </p>
            <div className="mt-2 flex gap-2">
              <Button onClick={recomecar}>Nova solicitação</Button>
              <Button variant="outline" onClick={() => nav("/app/encarregados/minhas-solicitacoes")}>
                Ver minhas solicitações
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Mudança de Função"
        subtitle="Peça a troca de cargo de alguém da sua equipe. O cargo atual vem do cadastro."
        module="Encarregados"
        breadcrumb={["Mudança de Função"]}
      />

      <Card>
        <CardHeader><CardTitle className="text-base">Quem vai mudar de função</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Colaborador <span className="text-destructive">*</span></Label>
            <BuscaColaborador valor={colaborador} onEscolher={setColaborador} />
          </div>

          {colaborador && (
            <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2 animate-in fade-in slide-in-from-bottom-1">
              <Campo rotulo="CPF" valor={colaborador.cpf} />
              <Campo rotulo="Admissão" valor={fmtData(colaborador.admissao)} />
              <Campo rotulo="Local / contrato" valor={local || "—"} />
              <Campo rotulo="Posto" valor={colaborador.posto || "—"} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">A troca</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <div className="space-y-1.5">
              <Label>Cargo atual</Label>
              {/* Travado de propósito: sai de EMPREGADOS. */}
              <Input value={cargoAtual} readOnly disabled
                     placeholder="Escolha o colaborador para preencher"
                     className="bg-muted/60" />
            </div>
            <ArrowRight className="mb-2 hidden h-5 w-5 text-muted-foreground sm:block" />
            <div className="space-y-1.5">
              <Label>Cargo novo <span className="text-destructive">*</span></Label>
              <Input value={cargoNovo} onChange={e => setCargoNovo(e.target.value)}
                     placeholder="Ex.: Encarregado de Limpeza" />
            </div>
          </div>

          {mesmoCargo && (
            <p className="text-sm text-destructive">O cargo novo é igual ao atual — não há o que trocar.</p>
          )}

          <div className="space-y-1.5">
            <Label>Motivo <span className="text-destructive">*</span></Label>
            <Textarea rows={3} value={motivo} onChange={e => setMotivo(e.target.value)}
                      placeholder="Por que a mudança faz sentido? O que a pessoa passa a fazer?" />
          </div>

          <div className="space-y-1.5">
            <Label>A partir de quando (opcional)</Label>
            <Input type="date" className="sm:w-56" value={dataPretendida}
                   onChange={e => setDataPretendida(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* O caminho, antes de enviar. */}
      {colaborador && (
        <div className="flex items-start gap-3 rounded-xl border bg-gradient-to-r from-primary/5 to-transparent p-4 animate-in fade-in">
          {eEscritorio ? <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                       : <UserCog className="mt-0.5 h-5 w-5 shrink-0 text-primary" />}
          <div className="text-sm">
            <p className="font-semibold">
              {eEscritorio ? "Aprovação do administrativo" : "Aprovação do Operacional"}
            </p>
            <p className="text-muted-foreground">
              {eEscritorio
                ? `${local} é escritório, então a aprovação é do administrativo.`
                : `${local || "O local do colaborador"} é contrato, então quem aprova é o Operacional.`}
              {" "}Depois: SST marca o ASO → RH altera na Senior.
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => nav("/app/encarregados/minhas-solicitacoes")}>Cancelar</Button>
        <Button onClick={enviar} disabled={enviando || !!problema()}>
          {enviando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</>
                    : <><Send className="mr-2 h-4 w-4" /> Enviar solicitação</>}
        </Button>
      </div>
    </div>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="text-sm font-medium">{valor || "—"}</p>
    </div>
  );
}
