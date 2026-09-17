import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { baseDaUrl, rotasSolicitacoes } from "@/lib/solicitacoes/rotas";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMeuNome } from "@/hooks/useMeuNome";
import { PageHeader } from "@/components/layout/PageHeader";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BuscaColaborador, type EmpregadoEscolhido } from "@/components/demissao/BuscaColaborador";
import { ArrowRight, Building2, CheckCircle2, Loader2, Send, UserCog } from "lucide-react";
import { localEhEscritorio, statusInicial, TABELA, fmtData } from "@/lib/trocaFuncao/solicitacao";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { solicitacaoEmAberto, type SolicitacaoEmAberto } from "@/lib/solicitacoes/duplicidade";

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
 *
 * QUEM RESPONDE "é escritório?" é o encarregado, no checkbox (25/08/2026).
 * Antes era o cadastro, lido de "Descrição do Local" — e ele erra nos dois
 * sentidos, porque é espelho do Senior e ninguém aqui pode corrigir. A
 * solicitação nascia na fila errada e alguém tinha que ir no banco mudar o
 * status. O cadastro continua sendo lido, mas agora só para SUGERIR: aparece
 * um aviso ao lado do checkbox, e quem decide é quem está pedindo.
 */
export default function SolicitarTrocaFuncao() {
  // Mesma tela em Encarregados e em Central de Serviços › Solicitações.
  const rotas = rotasSolicitacoes(baseDaUrl(useLocation().pathname));
  const { user } = useAuth();
  const meuNome = useMeuNome();
  const nav = useNavigate();

  const [colaborador, setColaborador] = useState<EmpregadoEscolhido | null>(null);
  // Já tem mudança de função em andamento para quem foi escolhido? O banco
  // responde (solicitacao_em_aberto) e o envio não passa.
  const [duplicada, setDuplicada] = useState<SolicitacaoEmAberto | null>(null);
  useEffect(() => {
    let vivo = true;
    setDuplicada(null);
    if (!colaborador?.id) return;
    solicitacaoEmAberto(sb, "troca_funcao", colaborador.id).then((d) => { if (vivo) setDuplicada(d); });
    return () => { vivo = false; };
  }, [colaborador?.id]);
  const [cargoNovo, setCargoNovo] = useState("");
  // Só horário (15/09/2026): a função fica a mesma e o que muda é a carga
  // horária/escala. Na troca de função o horário novo também é obrigatório.
  const [soHorario, setSoHorario] = useState(false);
  const [horarioNovo, setHorarioNovo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [dataPretendida, setDataPretendida] = useState("");
  const [setor, setSetor] = useState("");
  const [eEscritorio, setEEscritorio] = useState(false);
  const [setores, setSetores] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [protocolo, setProtocolo] = useState<number | null>(null);

  // O local vem de "Descrição do Local"; a filial é o fallback de quem está
  // sem local no cadastro.
  const local = colaborador?.descricaoLocal || colaborador?.nomeFilial || "";
  /** O que o CADASTRO acha. Só vira aviso — quem marca é o encarregado. */
  const cadastroDizEscritorio = useMemo(() => localEhEscritorio(local), [local]);

  // O mesmo catálogo da Administração; setor aqui é descritivo e não
  // concede nada, então basta ler.
  useEffect(() => {
    (async () => {
      const { data } = await sb.from("setor_catalogo").select("nome").order("nome");
      setSetores((data ?? []).map((s: { nome: string }) => s.nome));
    })();
  }, []);

  const cargoAtual = colaborador?.cargo ?? "";
  const horarioAtual = colaborador?.escala ?? "";
  const mesmoCargo = !soHorario && cargoAtual.trim().toUpperCase() === cargoNovo.trim().toUpperCase()
                  && cargoNovo.trim().length > 0;
  const mesmoHorario = soHorario && horarioAtual.trim().toUpperCase() === horarioNovo.trim().toUpperCase()
                  && horarioNovo.trim().length > 0;

  const problema = (): string | null => {
    if (!colaborador) return "Escolha o colaborador na lista.";
    if (duplicada) return duplicada.mensagem;
    if (!soHorario && !cargoNovo.trim()) return "Informe para qual cargo a pessoa vai.";
    if (mesmoCargo) return "O cargo novo é igual ao atual — se é só o horário que muda, marque \"Só troca de horário\".";
    if (!horarioNovo.trim()) return soHorario ? "Informe o horário novo que a pessoa vai fazer." : "Informe a carga horária/escala que a pessoa vai fazer no cargo novo.";
    if (mesmoHorario) return "O horário novo é igual ao atual — não há o que trocar.";
    if (!motivo.trim()) return "Escreva o motivo da mudança.";
    // Escritório (15/09/2026): o setor é obrigatório — é por ele que o
    // administrativo acha o pedido na fila. Em contrato continua opcional.
    if (eEscritorio && !setor) return "Pedido do escritório administrativo precisa do setor.";
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
      // Só horário: o cargo "novo" é o mesmo — a coluna é NOT NULL e o
      // painel mostra "Só horário" pelo tipo.
      cargo_novo: soHorario ? (cargoAtual || "—") : cargoNovo.trim(),
      tipo: soHorario ? "horario" : "funcao",
      horario_atual: horarioAtual || null,
      horario_novo: horarioNovo.trim(),
      local: local || null,
      posto: colaborador!.posto || null,
      filial: colaborador!.nomeFilial || null,
      e_escritorio: eEscritorio,
      setor: setor || null,
      motivo: motivo.trim(),
      data_pretendida: dataPretendida || null,
      status: statusInicial(eEscritorio, setor || null),
    }).select("id").single();
    setEnviando(false);
    if (error) { toast.error("Não deu para enviar: " + error.message); return; }
    setProtocolo(data?.id ?? null);
  };

  const recomecar = () => {
    setColaborador(null); setCargoNovo(""); setMotivo(""); setSoHorario(false); setHorarioNovo("");
    setDataPretendida(""); setSetor(""); setEEscritorio(false); setProtocolo(null);
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
              Primeiro o analista valida. Depois vai para{" "}
              {eEscritorio ? "a aprovação do administrativo" : "o Operacional aprovar"}, o SST
              avalia o ASO — marca o exame ou dispensa, quando a função nova não exige — e o RH
              faz a alteração na Senior. Você acompanha o andamento em Minhas Solicitações.
            </p>
            <div className="mt-2 flex gap-2">
              <Button onClick={recomecar}>Nova solicitação</Button>
              <Button variant="outline" onClick={() => nav(rotas.minhas)}>
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
        subtitle="Peça a troca de cargo ou só de horário de alguém da sua equipe. O cargo e o horário atuais vêm do cadastro. Passa pelo analista, pela aprovação, pelo SST e termina no RH."
        module="Encarregados"
        breadcrumb={["Mudança de Função"]}
        actions={<ResumoDeFuncoes fluxo="troca_funcao" />}
      />

      <Card>
        <CardHeader><CardTitle className="text-base">Quem vai mudar</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Colaborador <span className="text-destructive">*</span></Label>
            <BuscaColaborador valor={colaborador} onEscolher={setColaborador} />
            {duplicada && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <p className="font-semibold">🚫 Este colaborador já tem mudança de função em andamento.</p>
                <p className="mt-0.5 text-destructive/90">{duplicada.mensagem}</p>
              </div>
            )}
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
          {/* Só horário: muita gente só aumenta/reduz a carga horária sem
              mudar de função. Marcado, o cargo some e fica só o horário. */}
          <div className={cn("rounded-lg border p-3 transition-colors", soHorario && "border-primary/40 bg-primary/5")}>
            <div className="flex items-start gap-2.5">
              <Checkbox id="so-horario" checked={soHorario}
                        onCheckedChange={v => { setSoHorario(v === true); if (v === true) setCargoNovo(""); }} className="mt-0.5" />
              <div className="space-y-1">
                <Label htmlFor="so-horario" className="cursor-pointer font-medium">
                  Só troca de horário (a função continua a mesma)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Aumento ou redução de carga horária, mudança de escala ou de turno. O cargo fica como está.
                </p>
              </div>
            </div>
          </div>

          {!soHorario && (
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
          )}

          {mesmoCargo && (
            <p className="text-sm text-destructive">O cargo novo é igual ao atual — se é só o horário que muda, marque “Só troca de horário”.</p>
          )}

          {/* Horário: obrigatório nos dois casos. Na troca de função é o
              que a pessoa vai fazer no cargo novo (pode ser o mesmo). */}
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <div className="space-y-1.5">
              <Label>Horário / carga horária atual</Label>
              <Input value={horarioAtual} readOnly disabled
                     placeholder="Escolha o colaborador para preencher"
                     className="bg-muted/60" />
            </div>
            <ArrowRight className="mb-2 hidden h-5 w-5 text-muted-foreground sm:block" />
            <div className="space-y-1.5">
              <Label>Horário / carga horária nova <span className="text-destructive">*</span></Label>
              <Input value={horarioNovo} onChange={e => setHorarioNovo(e.target.value)}
                     placeholder="Ex.: 40h 5x2, 08:00–17:00" />
              {!soHorario && horarioAtual && !horarioNovo && (
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setHorarioNovo(horarioAtual)}>
                  Mantém o mesmo horário
                </button>
              )}
            </div>
          </div>
          {mesmoHorario && (
            <p className="text-sm text-destructive">O horário novo é igual ao atual — não há o que trocar.</p>
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

          {/* Setor: opcional em contrato, OBRIGATÓRIO no escritório (15/09/2026)
              — é por ele que o administrativo acha o pedido na fila. */}
          <div className="space-y-1.5">
            <Label>Setor {eEscritorio ? <span className="text-destructive">*</span> : "(opcional)"}</Label>
            <Select value={setor || "nenhum"} onValueChange={v => setSetor(v === "nenhum" ? "" : v)}>
              <SelectTrigger className={"sm:w-72" + (eEscritorio && !setor ? " border-destructive" : "")}><SelectValue placeholder="Não informar" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhum">{eEscritorio ? "Selecione o setor" : "Não informar"}</SelectItem>
                {setores.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className={"text-xs " + (eEscritorio && !setor ? "font-medium text-destructive" : "text-muted-foreground")}>
              {eEscritorio
                ? "Pedido do escritório administrativo: o setor é obrigatório."
                : "Serve para os gerentes filtrarem a fila por setor. Não muda quem aprova."}
            </p>
          </div>

          <div className="rounded-lg border p-3">
            <div className="flex items-start gap-2.5">
              <Checkbox id="e-escritorio" checked={eEscritorio}
                        onCheckedChange={v => setEEscritorio(v === true)} className="mt-0.5" />
              <div className="space-y-1">
                <Label htmlFor="e-escritorio" className="cursor-pointer font-medium">
                  É do escritório administrativo
                </Label>
                <p className="text-xs text-muted-foreground">
                  Marcado, a aprovação é do administrativo. Desmarcado, é do Operacional.
                </p>
                {colaborador && cadastroDizEscritorio && !eEscritorio && (
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    O cadastro diz que {colaborador.nome} está em “{local}” — parece escritório. Confira antes de enviar.
                  </p>
                )}
              </div>
            </div>
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
                ? "Você marcou como escritório administrativo, então a aprovação é do administrativo."
                : `${local || "O local do colaborador"} vai como contrato, então quem aprova é o Operacional.`}
              {" "}Depois: SST avalia o ASO (marca ou dispensa) → RH altera na Senior.
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => nav(rotas.minhas)}>Cancelar</Button>
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
      <p className="text-[13px] font-bold uppercase tracking-wide text-slate-700">{rotulo}</p>
      <p className="text-sm font-medium">{valor || "—"}</p>
    </div>
  );
}
