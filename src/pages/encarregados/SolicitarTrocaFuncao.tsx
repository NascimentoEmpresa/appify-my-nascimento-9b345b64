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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { BuscaColaborador, type EmpregadoEscolhido } from "@/components/demissao/BuscaColaborador";
import { ArrowRight, Building2, Check, CheckCircle2, ChevronsUpDown, Loader2, MapPin, Send, UserCog } from "lucide-react";
import {
  localEhEscritorio, statusInicial, TABELA, fmtData, validarTroca, rotuloPosto, ROTULO_TIPO,
  type PostoTrabalho, type TipoTroca,
} from "@/lib/trocaFuncao/solicitacao";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { solicitacaoEmAberto, type SolicitacaoEmAberto } from "@/lib/solicitacoes/duplicidade";

const sb = supabase as any;

const EXPLICA_TIPO: Record<TipoTroca, string> = {
  funcao: "Muda o cargo. Informe o horário no cargo novo; o posto pode mudar junto.",
  horario: "Aumento ou redução de carga horária, escala ou turno. Cargo e posto ficam.",
  posto: "Muda o posto de trabalho. Cargo fica; horário só se mudar também.",
};
const ROTULO_DATA: Record<TipoTroca, string> = {
  funcao: "Data da troca de função",
  horario: "Data da troca de horário",
  posto: "Data da troca de posto",
};
const QUANDO_VALE: Record<TipoTroca, string> = {
  funcao: "a nova função",
  horario: "o horário novo",
  posto: "o posto novo",
};

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
  // Três tipos (23/10/2026). Só horário (15/09/2026): a função fica a mesma
  // e o que muda é a carga horária/escala. Só posto: muda o posto de
  // trabalho e mais nada é obrigatório. Na troca de função o horário novo é
  // obrigatório e o posto novo é opcional.
  const [tipo, setTipo] = useState<TipoTroca>("funcao");
  const soHorario = tipo === "horario";
  const [horarioNovo, setHorarioNovo] = useState("");
  const [postoNovo, setPostoNovo] = useState<PostoTrabalho | null>(null);
  const [postos, setPostos] = useState<PostoTrabalho[] | null>(null);
  const [erroPostos, setErroPostos] = useState("");
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

  // Os postos de trabalho da Senior (RH_POSTO_TRABALHO), com contrato e
  // unidade. A tabela é fechada para quem não tem a Hierarquia de Postos;
  // a RPC abre só a lista para quem pede/decide mudança de função.
  useEffect(() => {
    (async () => {
      const { data, error } = await sb.rpc("stf_postos_trabalho");
      if (error) { setErroPostos(error.message); setPostos([]); return; }
      setPostos(data ?? []);
    })();
  }, []);

  const cargoAtual = colaborador?.cargo ?? "";
  const horarioAtual = colaborador?.escala ?? "";
  const postoAtualCodigo = colaborador?.postoCodigo ?? "";
  const postoAtual = useMemo(() => {
    if (!colaborador) return "";
    const p = postos?.find(x => x.codigo === postoAtualCodigo);
    if (p) return rotuloPosto(p);
    return [postoAtualCodigo, colaborador.nomePosto].filter(Boolean).join(" — ") || colaborador.posto || "";
  }, [colaborador, postos, postoAtualCodigo]);
  const mesmoCargo = tipo === "funcao" && cargoAtual.trim().toUpperCase() === cargoNovo.trim().toUpperCase()
                  && cargoNovo.trim().length > 0;
  const mesmoHorario = soHorario && horarioAtual.trim().toUpperCase() === horarioNovo.trim().toUpperCase()
                  && horarioNovo.trim().length > 0;
  const mesmoPosto = !!postoNovo && postoNovo.codigo === postoAtualCodigo;

  const escolherTipo = (t: TipoTroca) => {
    setTipo(t);
    if (t !== "funcao") setCargoNovo("");
    if (t === "horario") setPostoNovo(null);
  };

  const problema = (): string | null => {
    if (!colaborador) return "Escolha o colaborador na lista.";
    if (duplicada) return duplicada.mensagem;
    const daTroca = validarTroca({
      tipo, cargoAtual, cargoNovo, horarioAtual, horarioNovo,
      postoAtualCodigo, postoNovoCodigo: postoNovo?.codigo ?? "",
    });
    if (daTroca) return daTroca;
    if (!motivo.trim()) return "Escreva o motivo da mudança.";
    // Obrigatória desde 25/09/2026 (mig 243): chegou pedido sem a data e o RH
    // não tinha como fazer a troca — não sabia a partir de quando vale.
    if (!dataPretendida) return `Informe a partir de quando vale ${QUANDO_VALE[tipo]}.`;
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
      // Só horário / só posto: o cargo "novo" é o mesmo — a coluna é NOT
      // NULL e o painel mostra o tipo.
      cargo_novo: tipo === "funcao" ? cargoNovo.trim() : (cargoAtual || "—"),
      tipo,
      horario_atual: horarioAtual || null,
      horario_novo: horarioNovo.trim() || null,
      local: local || null,
      posto: colaborador!.posto || null,
      // O posto ATUAL e o nome/contrato do novo o banco preenche (stf_valida_troca).
      posto_novo_codigo: postoNovo?.codigo ?? null,
      filial: colaborador!.nomeFilial || null,
      e_escritorio: eEscritorio,
      setor: setor || null,
      motivo: motivo.trim(),
      data_pretendida: dataPretendida,
      status: statusInicial(eEscritorio, setor || null),
    }).select("id").single();
    setEnviando(false);
    if (error) { toast.error("Não deu para enviar: " + error.message); return; }
    setProtocolo(data?.id ?? null);
  };

  const recomecar = () => {
    setColaborador(null); setCargoNovo(""); setMotivo(""); setTipo("funcao"); setHorarioNovo(""); setPostoNovo(null);
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
        subtitle="Peça a troca de cargo, de horário ou de posto de alguém da sua equipe. Cargo, posto e horário atuais vêm do cadastro. Passa pelo analista, pela aprovação, pelo SST e termina no RH."
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
          {/* O tipo de movimentação (23/10/2026). Só horário: muita gente só
              aumenta/reduz a carga horária sem mudar de função. Só posto: a
              pessoa muda de posto de trabalho e o resto fica. */}
          <RadioGroup value={tipo} onValueChange={v => escolherTipo(v as TipoTroca)} className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(ROTULO_TIPO) as TipoTroca[]).map(t => (
              <Label key={t} htmlFor={`tipo-${t}`}
                     className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 font-normal transition-colors",
                                   tipo === t && "border-primary/40 bg-primary/5")}>
                <RadioGroupItem id={`tipo-${t}`} value={t} className="mt-0.5" />
                <span className="space-y-1">
                  <span className="block font-medium">{ROTULO_TIPO[t]}</span>
                  <span className="block text-xs text-muted-foreground">{EXPLICA_TIPO[t]}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>

          {tipo === "funcao" && (
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
            <p className="text-sm text-destructive">O cargo novo é igual ao atual — se é só o horário ou o posto que muda, escolha “Só horário” ou “Só posto”.</p>
          )}

          {/* Posto: obrigatório no "Só posto", opcional na troca de função
              (vazio = continua no mesmo), fora do "Só horário". Só dá para
              escolher posto cadastrado — nada de digitar. */}
          {tipo !== "horario" && (
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
              <div className="space-y-1.5">
                <Label>Posto atual</Label>
                <div className={cn("flex min-h-10 items-center rounded-md border bg-muted/60 px-3 py-2 text-sm",
                                   !postoAtual && "text-muted-foreground")}>
                  {postoAtual || (colaborador ? "Sem posto no cadastro" : "Escolha o colaborador para preencher")}
                </div>
              </div>
              <ArrowRight className="mb-2 hidden h-5 w-5 text-muted-foreground sm:block" />
              <div className="space-y-1.5">
                <Label>
                  Posto novo {tipo === "posto" ? <span className="text-destructive">*</span> : <span className="font-normal text-muted-foreground">(opcional)</span>}
                </Label>
                <EscolhaPosto postos={postos} valor={postoNovo} onEscolher={setPostoNovo}
                              atual={postoAtualCodigo} erro={erroPostos}
                              vazio={tipo === "posto" ? "Escolha o posto novo" : "Continua no mesmo posto"} />
              </div>
            </div>
          )}
          {mesmoPosto && (
            <p className="text-sm text-destructive">O posto novo é o mesmo em que a pessoa já está.</p>
          )}

          {/* Horário: obrigatório na troca de função (o que a pessoa vai
              fazer no cargo novo, pode ser o mesmo) e no "Só horário";
              opcional no "Só posto" (vazio = continua o mesmo). */}
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <div className="space-y-1.5">
              <Label>Horário / carga horária atual</Label>
              <Input value={horarioAtual} readOnly disabled
                     placeholder="Escolha o colaborador para preencher"
                     className="bg-muted/60" />
            </div>
            <ArrowRight className="mb-2 hidden h-5 w-5 text-muted-foreground sm:block" />
            <div className="space-y-1.5">
              <Label>
                Horário / carga horária nova {tipo === "posto" ? <span className="font-normal text-muted-foreground">(opcional)</span> : <span className="text-destructive">*</span>}
              </Label>
              <Input value={horarioNovo} onChange={e => setHorarioNovo(e.target.value)}
                     placeholder={tipo === "posto" ? "Vazio = continua o mesmo horário" : "Ex.: 40h 5x2, 08:00–17:00"} />
              {tipo === "funcao" && horarioAtual && !horarioNovo && (
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
            <Label>{ROTULO_DATA[tipo]} <span className="text-destructive">*</span></Label>
            <Input type="date" className="sm:w-56" value={dataPretendida} required
                   onChange={e => setDataPretendida(e.target.value)} />
            <p className="text-xs text-muted-foreground">A partir de quando a mudança vale — sem ela o RH não consegue fazer a troca.</p>
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

/**
 * Posto novo: só os postos cadastrados (sem digitar), com contrato, unidade
 * e nome na mesma linha — são ~400 postos e o nome sozinho
 * ("RECEPCIONISTA-B 40H 5X2") se repete entre contratos. A busca é local
 * (cmdk) sobre a lista inteira, que chega de uma vez.
 */
function EscolhaPosto({ postos, valor, onEscolher, atual, erro, vazio }: {
  postos: PostoTrabalho[] | null;
  valor: PostoTrabalho | null;
  onEscolher: (p: PostoTrabalho | null) => void;
  atual: string;
  erro: string;
  vazio: string;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={aberto}
                className="h-auto min-h-10 w-full justify-between px-3 py-2 text-left font-normal">
          {valor ? (
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{valor.codigo} — {valor.nome}</span>
              <span className="truncate text-xs text-muted-foreground">
                {[valor.contrato, valor.unidade].filter(Boolean).join(" · ") || "Contrato não identificado"}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">{vazio}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(36rem,calc(100vw-2rem))] p-0" align="end">
        <Command>
          <CommandInput placeholder="Contrato, unidade, código ou nome do posto…" />
          <CommandList>
            {postos === null ? (
              <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando postos…
              </div>
            ) : (
              <CommandEmpty>{erro ? `Não deu para carregar os postos: ${erro}` : "Nenhum posto encontrado."}</CommandEmpty>
            )}
            {valor && (
              <CommandGroup>
                <CommandItem value="__limpar" onSelect={() => { onEscolher(null); setAberto(false); }}>
                  <span className="text-muted-foreground">{vazio}</span>
                </CommandItem>
              </CommandGroup>
            )}
            {!!postos?.length && (
              <CommandGroup heading="Postos de trabalho">
                {postos.map(p => (
                  <CommandItem key={p.codigo} value={rotuloPosto(p)} disabled={p.codigo === atual}
                               onSelect={() => { onEscolher(p); setAberto(false); }}>
                    <MapPin className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{p.codigo} — {p.nome}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[p.contrato, p.unidade].filter(Boolean).join(" · ") || "Contrato não identificado"}
                        {p.codigo === atual ? " · posto atual" : ""}
                      </span>
                    </span>
                    <Check className={cn("ml-2 h-4 w-4 shrink-0", valor?.codigo === p.codigo ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
