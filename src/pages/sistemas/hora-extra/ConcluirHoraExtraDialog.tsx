import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, ExternalLink, FileCheck2, FileText, Info, LoaderCircle, Pencil, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  buscarInformacoesPrHoraExtra,
  useConcluirHoraExtra,
  useEnviarAnexosHoraExtra,
} from "@/hooks/useHoraExtra";
import {
  calcularHoraExtra,
  diaSemana,
  formatarData,
  formatarDuracao,
  formatarQuantidadeChamados,
  JORNADA_PADRAO_MIN,
  mediaConclusao,
  mensagemErro,
  validarConclusao,
} from "./horaExtraUtils";
import { Campo, DropzoneAnexos, SecaoForm, TotalHoras } from "./HoraExtraUI";
import { normalizarNumeroPr, totalizarLinhasRelatorioPr } from "./prHoraExtraUtils";
import type { ChamadoHoraExtra, SolicitacaoHoraExtra, StatusExecucao } from "./types";

interface LinhaConclusao {
  id: string;
  chave: string;
  chamado_id: string;
  numero: string;
  assunto: string;
  setor?: string | null;
  previsto: number | null;
  concluido: number;
  status: StatusExecucao;
  observacao: string;
  adicional: boolean;
  pr_texto: string;
  pr_numero: number | null;
  pr_url: string | null;
  pr_titulo: string | null;
  pr_linhas_adicionadas: number | null;
  pr_commits: number | null;
  pr_arquivos_adicionados: number | null;
}

function novaChaveLinha() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `linha-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ConcluirHoraExtraDialog({
  aberto,
  aoFechar,
  solicitacao,
}: {
  aberto: boolean;
  aoFechar: () => void;
  solicitacao: SolicitacaoHoraExtra | null;
}) {
  const concluir = useConcluirHoraExtra();
  const [linhas, setLinhas] = useState<LinhaConclusao[]>([]);
  const [adicionais, setAdicionais] = useState<LinhaConclusao[]>([]);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const enviarAnexos = useEnviarAnexosHoraExtra();
  const [prsCarregando, setPrsCarregando] = useState<Record<string, boolean>>({});
  const [prsEmEdicao, setPrsEmEdicao] = useState<Record<string, boolean>>({});
  const [resumo, setResumo] = useState("");
  const [horarios, setHorarios] = useState({
    ponto_entrada_real: "07:30",
    ponto_saida_intervalo_real: "12:00",
    ponto_retorno_intervalo_real: "13:00",
    ponto_saida_real: "17:18",
  });
  useEffect(() => {
    if (!aberto || !solicitacao) return;
    setHorarios({
      ponto_entrada_real: (solicitacao.ponto_entrada_real || solicitacao.ponto_entrada).slice(0, 5),
      ponto_saida_intervalo_real: (solicitacao.ponto_saida_intervalo_real || solicitacao.ponto_saida_intervalo).slice(
        0,
        5,
      ),
      ponto_retorno_intervalo_real: (
        solicitacao.ponto_retorno_intervalo_real || solicitacao.ponto_retorno_intervalo
      ).slice(0, 5),
      ponto_saida_real: (solicitacao.ponto_saida_real || solicitacao.ponto_saida).slice(0, 5),
    });
    setResumo(solicitacao.resumo_conclusao || "");
    const converter = (c: ChamadoHoraExtra): LinhaConclusao => ({
      id: c.id,
      chave: c.id,
      chamado_id: c.chamado_id,
      numero: c.chamado_numero,
      assunto: c.chamado_assunto,
      setor: c.chamado_setor,
      previsto: c.percentual_previsto,
      concluido: Number(c.percentual_concluido || 0),
      status: c.status_execucao || "nao_iniciado",
      observacao: c.observacao || "",
      adicional: c.adicional,
      pr_texto: c.pr_numero ? `#${c.pr_numero}` : "",
      pr_numero: c.pr_numero ?? null,
      pr_url: c.pr_url ?? null,
      pr_titulo: c.pr_titulo ?? null,
      pr_linhas_adicionadas: c.pr_linhas_adicionadas ?? null,
      pr_commits: c.pr_commits ?? null,
      pr_arquivos_adicionados: c.pr_arquivos_adicionados ?? null,
    });
    setLinhas((solicitacao.chamados || []).filter((c) => !c.adicional).map(converter));
    setAdicionais((solicitacao.chamados || []).filter((c) => c.adicional).map(converter));
    setArquivos([]);
    setPrsCarregando({});
    setPrsEmEdicao({});
  }, [aberto, solicitacao]);
  const jornada = solicitacao?.jornada_minutos ?? JORNADA_PADRAO_MIN;
  const calculo = calcularHoraExtra(
    {
      entrada: horarios.ponto_entrada_real,
      saida_intervalo: horarios.ponto_saida_intervalo_real,
      retorno_intervalo: horarios.ponto_retorno_intervalo_real,
      saida: horarios.ponto_saida_real,
    },
    jornada,
  );
  const minutos = calculo.excedente;
  const media = mediaConclusao([...linhas, ...adicionais].map((l) => l.concluido));
  if (!solicitacao) return null;
  const mudarHorario = (campo: keyof typeof horarios, valor: string) => setHorarios((a) => ({ ...a, [campo]: valor }));
  const adicionarPr = () =>
    setAdicionais((xs) => [
      ...xs,
      {
        id: "",
        chave: novaChaveLinha(),
        chamado_id: "",
        numero: "",
        assunto: "",
        setor: null,
        previsto: null,
        concluido: 100,
        status: "concluido",
        observacao: "",
        adicional: true,
        pr_texto: "",
        pr_numero: null,
        pr_url: null,
        pr_titulo: null,
        pr_linhas_adicionadas: null,
        pr_commits: null,
        pr_arquivos_adicionados: null,
      },
    ]);
  const atualizarTextoPr = (grupo: "originais" | "adicionais", indice: number, pr_texto: string) => {
    const setter = grupo === "originais" ? setLinhas : setAdicionais;
    setter((xs) => xs.map((linha, i) => (i === indice ? { ...linha, pr_texto } : linha)));
  };
  const consultarPr = async (grupo: "originais" | "adicionais", indice: number) => {
    const linhasGrupo = grupo === "originais" ? linhas : adicionais;
    const linha = linhasGrupo[indice];
    if (!linha) return;
    const numeroPr = normalizarNumeroPr(linha.pr_texto);
    if (!numeroPr) {
      toast.error("Informe o número da PR no formato #624.");
      return;
    }
    if ([...linhas, ...adicionais].some((outra) => outra.chave !== linha.chave && outra.pr_numero === numeroPr)) {
      toast.error(`A PR #${numeroPr} já está vinculada a outro chamado nesta HE.`);
      return;
    }
    setPrsCarregando((atual) => ({ ...atual, [linha.chave]: true }));
    try {
      const dados = await buscarInformacoesPrHoraExtra(solicitacao.id, numeroPr);
      if (grupo === "originais" && dados.chamado.id !== linha.chamado_id) {
        throw new Error(
          `A PR #${numeroPr} pertence ao chamado #${dados.chamado.numero}, diferente deste chamado da solicitação.`,
        );
      }
      if (
        grupo === "adicionais" &&
        [...linhas, ...adicionais].some(
          (outra) => outra.chave !== linha.chave && outra.chamado_id === dados.chamado.id,
        )
      ) {
        throw new Error(`O chamado #${dados.chamado.numero} já está listado nesta HE.`);
      }
      const setter = grupo === "originais" ? setLinhas : setAdicionais;
      setter((xs) =>
        xs.map((atual, i) =>
          i === indice
            ? {
                ...atual,
                chamado_id: dados.chamado.id,
                numero: dados.chamado.numero,
                assunto: dados.chamado.assunto,
                setor: dados.chamado.setor,
                pr_texto: `#${dados.pr.numero}`,
                pr_numero: dados.pr.numero,
                pr_url: dados.pr.url,
                pr_titulo: dados.pr.titulo,
                pr_linhas_adicionadas: dados.pr.linhas_adicionadas,
                pr_commits: dados.pr.commits,
                pr_arquivos_adicionados: dados.pr.arquivos_adicionados,
                // O relatório é composto por PRs que comprovam a entrega do
                // chamado; por isso a conclusão desta linha passa a 100%.
                concluido: 100,
                status: "concluido",
              }
            : atual,
        ),
      );
      setPrsEmEdicao((atual) => ({ ...atual, [linha.chave]: false }));
    } catch (erro: unknown) {
      toast.error(mensagemErro(erro, "Não foi possível consultar esta PR."));
    } finally {
      setPrsCarregando((atual) => ({ ...atual, [linha.chave]: false }));
    }
  };
  const enviar = async () => {
    const erros = validarConclusao(
      {
        entrada: horarios.ponto_entrada_real,
        saida_intervalo: horarios.ponto_saida_intervalo_real,
        retorno_intervalo: horarios.ponto_retorno_intervalo_real,
        saida: horarios.ponto_saida_real,
      },
      jornada,
    );
    if (erros.length) {
      erros.forEach((erro) => toast.error(erro));
      return;
    }
    if (!resumo.trim()) {
      toast.error("Preencha o resumo e observações.");
      return;
    }
    const todasAsLinhas = [...linhas, ...adicionais];
    if (todasAsLinhas.some((linha) => !linha.pr_numero || !linha.pr_url)) {
      toast.error("Informe e valide uma PR do GitHub para cada chamado realizado na HE.");
      return;
    }
    if (adicionais.some((linha) => !linha.chamado_id)) {
      toast.error("Aguarde a validação do chamado encontrado no título da PR.");
      return;
    }
    try {
      await concluir.mutateAsync({
        p: {
          id: solicitacao.id,
          ...horarios,
          he_inicio_real: calculo.inicio,
          he_fim_real: calculo.fim,
          resumo_conclusao: resumo,
          chamados: linhas.map((l) => ({
            id: l.id,
            percentual_concluido: l.concluido,
            status_execucao: l.status,
            observacao: l.observacao,
            pr_numero: l.pr_numero,
            pr_url: l.pr_url,
            pr_titulo: l.pr_titulo,
            pr_linhas_adicionadas: l.pr_linhas_adicionadas,
            pr_commits: l.pr_commits,
            pr_arquivos_adicionados: l.pr_arquivos_adicionados,
          })),
          adicionais: adicionais.map((l) => ({
            chamado_id: l.chamado_id,
            percentual_concluido: l.concluido,
            status_execucao: l.status,
            observacao: l.observacao,
            pr_numero: l.pr_numero,
            pr_url: l.pr_url,
            pr_titulo: l.pr_titulo,
            pr_linhas_adicionadas: l.pr_linhas_adicionadas,
            pr_commits: l.pr_commits,
            pr_arquivos_adicionados: l.pr_arquivos_adicionados,
          })),
        },
      });
      const falhas = await enviarAnexos(solicitacao.id, "conclusao", arquivos);
      if (falhas.length) toast.warning(`Não foi possível anexar: ${falhas.join(", ")}`);
      toast.success("Conclusão enviada para aprovação.");
      aoFechar();
    } catch (e: unknown) {
      toast.error(mensagemErro(e, "Não foi possível concluir a HE."));
    }
  };
  const inputHora = (rotulo: string, campo: keyof typeof horarios) => (
    <Campo rotulo={rotulo}>
      <Input type="time" value={horarios[campo]} onChange={(e) => mudarHorario(campo, e.target.value)} />
    </Campo>
  );
  return (
    <>
      <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
        <DialogContent className="max-h-[96vh] max-w-[1180px] overflow-y-auto p-0">
          <DialogHeader className="border-b px-7 py-4">
            <div className="flex items-center gap-4">
              <span
                className={cn(
                  "grid h-14 w-14 place-items-center rounded-full bg-orange-100",
                  "text-orange-500 ring-8 ring-orange-50",
                )}
              >
                <CheckCircle2 className="h-8 w-8" />
              </span>
              <div>
                <DialogTitle className="text-2xl text-[#07194b]">Conclusão da Hora Extra</DialogTitle>
                <DialogDescription>
                  Informe abaixo os horários efetivos e o resultado de cada tarefa realizada na hora extra.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="grid gap-4 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_255px]">
            <div className="space-y-3">
              {solicitacao.motivo_devolucao && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  <strong>Devolvida para ajuste:</strong> {solicitacao.motivo_devolucao}
                </div>
              )}
              <SecaoForm titulo="1. Dados da solicitação" icone={<FileCheck2 className="h-5 w-5" />}>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  {[
                    ["ID da solicitação", `#${solicitacao.numero}`],
                    ["Colaborador", solicitacao.colaborador_nome],
                    ["Setor", solicitacao.setor || "—"],
                    ["Data da HE", formatarData(solicitacao.data_he)],
                    ["Tipo da HE", solicitacao.tipo === "normal" ? "Normal" : "Emergencial"],
                  ].map(([r, v]) => (
                    <Campo key={r} rotulo={r}>
                      <Input value={v} readOnly className="bg-slate-100" />
                    </Campo>
                  ))}
                </div>
              </SecaoForm>
              <SecaoForm
                titulo="2. Horário de ponto efetivo"
                subtitulo={
                  "Informe os horários que foram efetivamente registrados no seu ponto " +
                  "no dia da realização da hora extra."
                }
                icone={<Clock3 className="h-5 w-5" />}
              >
                <div className="grid gap-3 lg:grid-cols-[1.4fr_.9fr_.55fr]">
                  <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 md:grid-cols-4">
                    {inputHora("Entrada", "ponto_entrada_real")}
                    {inputHora("Saída (intervalo)", "ponto_saida_intervalo_real")}
                    {inputHora("Retorno (intervalo)", "ponto_retorno_intervalo_real")}
                    {inputHora("Saída", "ponto_saida_real")}
                  </div>
                  <div className="grid grid-cols-2 gap-3 rounded-lg bg-blue-50 p-3">
                    <div className="col-span-2 text-xs font-semibold text-blue-700">
                      Horário da HE (calculado pela escala de {formatarDuracao(jornada, true)})
                    </div>
                    <Campo rotulo="Início real">
                      <Input readOnly value={calculo.excedente ? calculo.inicio : "—"} className="bg-white" />
                    </Campo>
                    <Campo rotulo="Término real">
                      <Input readOnly value={calculo.excedente ? calculo.fim : "—"} className="bg-white" />
                    </Campo>
                  </div>
                  <TotalHoras minutos={minutos} trabalhado={calculo.trabalhado} />
                </div>
              </SecaoForm>
              <SecaoForm
                titulo="3. Chamados da solicitação"
                subtitulo="Informe a PR de cada chamado. As métricas e o ID do chamado são preenchidos automaticamente pelo GitHub."
                icone={<UsersRound className="h-5 w-5" />}
              >
                <TabelaRelatorioPr
                  linhas={linhas}
                  adicionais={false}
                  prsCarregando={prsCarregando}
                  prsEmEdicao={prsEmEdicao}
                  aoEditarPr={(chave) => setPrsEmEdicao((atual) => ({ ...atual, [chave]: true }))}
                  aoAlterarTextoPr={(i, valor) => atualizarTextoPr("originais", i, valor)}
                  aoConsultarPr={(i) => void consultarPr("originais", i)}
                />
              </SecaoForm>
              <SecaoForm
                titulo="4. Chamados adicionais (realizados durante a HE)"
                subtitulo="Adicione a PR: o chamado é identificado no título da PR e incluído automaticamente no relatório."
                icone={<UsersRound className="h-5 w-5" />}
              >
                <TabelaRelatorioPr
                  linhas={adicionais}
                  adicionais
                  prsCarregando={prsCarregando}
                  prsEmEdicao={prsEmEdicao}
                  aoEditarPr={(chave) => setPrsEmEdicao((atual) => ({ ...atual, [chave]: true }))}
                  aoAlterarTextoPr={(i, valor) => atualizarTextoPr("adicionais", i, valor)}
                  aoConsultarPr={(i) => void consultarPr("adicionais", i)}
                  aoExcluir={(i) => setAdicionais((xs) => xs.filter((_, j) => j !== i))}
                />
                <div className="mt-3 text-right">
                  <Button variant="outline" onClick={adicionarPr}>
                    + &nbsp; Adicionar PR
                  </Button>
                </div>
              </SecaoForm>
              <SecaoForm
                titulo="5. Resumo e observações"
                subtitulo={
                  "Descreva aqui um resumo do que foi realizado durante a hora extra " + "e se houve algum impedimento."
                }
                icone={<FileText className="h-5 w-5" />}
              >
                <Textarea maxLength={1000} rows={3} value={resumo} onChange={(e) => setResumo(e.target.value)} />
                <div className="mt-1 text-right text-xs text-slate-500">{resumo.length}/1000</div>
              </SecaoForm>
              <SecaoForm titulo="6. Anexos (opcional)" icone={<FileText className="h-5 w-5" />}>
                <DropzoneAnexos
                  arquivos={arquivos}
                  setArquivos={setArquivos}
                  descricao="comprovantes ou outros documentos que validem a execução da hora extra."
                />
              </SecaoForm>
            </div>
            <aside className="space-y-4">
              <div className="rounded-lg bg-blue-50 p-5 text-sm">
                <h3 className="mb-5 font-bold text-[#07194b]">Resumo da Solicitação</h3>
                <Resumo rotulo="ID da solicitação" valor={`#${solicitacao.numero}`} />
                <Resumo rotulo="Colaborador" valor={solicitacao.colaborador_nome} />
                <Resumo rotulo="Setor" valor={solicitacao.setor || "—"} />
                <Resumo
                  rotulo="Data"
                  valor={`${formatarData(solicitacao.data_he)} (${diaSemana(solicitacao.data_he)})`}
                />
                <Resumo rotulo="Tipo de HE" valor={solicitacao.tipo === "normal" ? "Normal" : "Emergencial"} />
                <hr className="my-4 border-blue-200" />
                <h3 className="mb-4 font-bold text-[#07194b]">Resumo da Conclusão</h3>
                <Resumo
                  rotulo="Horário da HE"
                  valor={calculo.excedente ? `${calculo.inicio} - ${calculo.fim}` : "—"}
                />
                <Resumo rotulo="Total trabalhado" valor={formatarDuracao(calculo.trabalhado)} />
                <Resumo rotulo="Total de hora extra" valor={formatarDuracao(minutos)} />
                <Resumo rotulo="Chamados originais" valor={formatarQuantidadeChamados(linhas.length)} />
                <Resumo
                  rotulo="Chamados adicionais"
                  valor={`${adicionais.length} ${adicionais.length === 1 ? "chamado" : "chamados"}`}
                />
                <Resumo rotulo="Média de conclusão" valor={`${media}%`} />
              </div>
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-5 text-sm text-[#07194b]">
                <h3 className="mb-3 flex gap-2 font-bold">
                  <Info className="h-5 w-5 text-orange-500" />
                  Importante
                </h3>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Informe os horários exatamente como registrados no seu ponto.</li>
                  <li>
                    A hora extra é <strong>calculada</strong>: conta só o tempo que passar da jornada da escala.
                  </li>
                  <li>Digite a PR no formato <strong>#624</strong> para preencher suas métricas automaticamente.</li>
                  <li>O título da PR precisa começar pelo ID do chamado, como <strong>SIS-2026-0459:</strong>.</li>
                  <li>É possível incluir PRs de chamados adicionais realizados durante a hora extra.</li>
                  <li>Após concluir, a solicitação será enviada para aprovação do seu gestor.</li>
                </ul>
              </div>
            </aside>
          </div>
          <div className="sticky bottom-0 flex justify-between border-t bg-white px-5 py-3">
            <Button variant="secondary" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button disabled={concluir.isPending} onClick={enviar} className="bg-orange-500 px-6 hover:bg-orange-600">
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Concluir e Enviar para Aprovação
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Resumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="mb-3">
      <div className="text-slate-500">{rotulo}</div>
      <div className="font-semibold text-[#07194b]">{valor}</div>
    </div>
  );
}
function TabelaRelatorioPr({
  linhas,
  adicionais,
  prsCarregando,
  prsEmEdicao,
  aoEditarPr,
  aoAlterarTextoPr,
  aoConsultarPr,
  aoExcluir,
}: {
  linhas: LinhaConclusao[];
  adicionais: boolean;
  prsCarregando: Record<string, boolean>;
  prsEmEdicao: Record<string, boolean>;
  aoEditarPr: (chave: string) => void;
  aoAlterarTextoPr: (i: number, valor: string) => void;
  aoConsultarPr: (i: number) => void;
  aoExcluir?: (i: number) => void;
}) {
  const totais = totalizarLinhasRelatorioPr(linhas);
  const totalChamados = new Set(linhas.filter((linha) => linha.chamado_id).map((linha) => linha.chamado_id)).size;
  const colunas = adicionais ? 6 : 5;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[860px] text-xs">
        <thead className="bg-[#254d86] text-left font-bold uppercase text-white">
          <tr>
            <th className="p-2">Número PR</th>
            <th className="p-2 text-center">Linhas de código adicionadas</th>
            <th className="p-2 text-center">Commits criados</th>
            <th className="p-2">Número do chamado</th>
            <th className="p-2 text-center" title="Somente arquivos novos adicionados pela PR">
              Arquivos alterados
            </th>
            {adicionais && <th className="p-2 text-center">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={l.chave} className="border-t align-middle">
              <td className="p-2">
                {l.pr_url && !prsEmEdicao[l.chave] ? (
                  <div className="flex items-center gap-1.5">
                    <a
                      href={l.pr_url}
                      target="_blank"
                      rel="noreferrer"
                      title={l.pr_titulo || `Abrir PR #${l.pr_numero} no GitHub`}
                      className="inline-flex items-center gap-1 font-bold text-blue-600 underline-offset-2 hover:underline"
                    >
                      #{l.pr_numero}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-slate-500"
                      onClick={() => aoEditarPr(l.chave)}
                      aria-label={`Alterar PR do chamado ${l.numero}`}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="relative min-w-28">
                    <Input
                      value={l.pr_texto}
                      onChange={(e) => aoAlterarTextoPr(i, e.target.value)}
                      onBlur={() => l.pr_texto.trim() && aoConsultarPr(i)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          aoConsultarPr(i);
                        }
                      }}
                      placeholder="#624"
                      disabled={prsCarregando[l.chave]}
                      aria-label="Número da Pull Request"
                      className="h-8 pr-8"
                    />
                    {prsCarregando[l.chave] && (
                      <LoaderCircle className="absolute right-2 top-2 h-4 w-4 animate-spin text-blue-600" aria-label="Consultando PR" />
                    )}
                  </div>
                )}
              </td>
              <td className="p-2 text-center font-medium tabular-nums">
                {l.pr_url ? (l.pr_linhas_adicionadas ?? 0).toLocaleString("pt-BR") : "—"}
              </td>
              <td className="p-2 text-center font-medium tabular-nums">{l.pr_url ? l.pr_commits ?? 0 : "—"}</td>
              <td className="p-2">
                {l.numero ? (
                  <>
                    <div className="font-semibold text-[#07194b]">#{l.numero}</div>
                    <div className="max-w-56 truncate text-slate-500" title={l.assunto}>
                      {l.assunto}
                    </div>
                  </>
                ) : (
                  <span className="text-slate-400">Preenchido pelo título da PR</span>
                )}
              </td>
              <td className="p-2 text-center font-medium tabular-nums">
                {l.pr_url ? l.pr_arquivos_adicionados ?? 0 : "—"}
              </td>
              {adicionais && (
                <td className="p-2 text-center">
                  <Button size="icon" variant="outline" onClick={() => aoExcluir?.(i)} aria-label="Remover PR adicional">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              )}
            </tr>
          ))}
          {!linhas.length && (
            <tr>
              <td colSpan={colunas} className="p-5 text-center text-slate-500">
                {adicionais ? "Nenhuma PR adicional." : "Nenhum chamado na solicitação."}
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100 font-bold text-red-600">
            <td className="p-2">TOTAL</td>
            <td className="p-2 text-center tabular-nums">{totais.linhas_adicionadas.toLocaleString("pt-BR")}</td>
            <td className="p-2 text-center tabular-nums">{totais.commits.toLocaleString("pt-BR")}</td>
            <td className="p-2">{totalChamados} {totalChamados === 1 ? "chamado" : "chamados"}</td>
            <td className="p-2 text-center tabular-nums">{totais.arquivos_adicionados.toLocaleString("pt-BR")}</td>
            {adicionais && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
