import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock3, ExternalLink, FileCheck2, FileText, Info, LoaderCircle, Pencil, RefreshCw, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  buscarInformacoesPrHoraExtra,
  useConcluirHoraExtra,
  useEnviarAnexosHoraExtra,
  usePontoMesHoraExtra,
} from "@/hooks/useHoraExtra";
import { mesDaData } from "@/lib/horaExtraLimite";
import {
  aplicarMarcacoesSenior,
  CAMPOS_PONTO,
  marcacoesDaJornada,
  ROTULO_CAMPO_PONTO,
  type CampoPonto,
  type ValoresPonto,
} from "@/lib/horaExtraPontoSenior";
import {
  calcularHoraExtra,
  diaSemana,
  formatarData,
  formatarDuracao,
  formatarQuantidadeChamados,
  JORNADA_PADRAO_MIN,
  jornadaParaCalculoHoraExtra,
  mediaConclusao,
  mensagemErro,
  normalizarPontoSemIntervalo,
  validarConclusao,
} from "./horaExtraUtils";
import {
  type DadosConclusao,
  gerarResumoConclusaoModelo,
  LIMITE_RESUMO_CONCLUSAO,
} from "../../../../supabase/functions/_shared/hora-extra-justificativa";
import { BotaoGerarMensagem, Campo, DropzoneAnexos, SecaoForm, TotalHoras } from "./HoraExtraUI";
import { pedirMensagemHoraExtra } from "./gerarMensagemHoraExtra";
import {
  contarRelatorioPr,
  linhaSemChamado,
  normalizarNumeroPr,
  removerLinhaRelatorioPr,
  textoChamadosRelatorioPr,
  totalizarLinhasRelatorioPr,
} from "./prHoraExtraUtils";
import type { ChamadoHoraExtra, SolicitacaoHoraExtra, StatusExecucao } from "./types";
import { useConfirmacaoLimite } from "./useConfirmacaoLimite";

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
  /**
   * PR sem chamado no título ([SEM-CHAMADO]). Vem como linha adicional ou,
   * desde 26/10/2026, como a linha planejada da HE emergencial sem chamado.
   */
  sem_chamado: boolean;
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
  const { conferirLimite, dialogoLimite } = useConfirmacaoLimite();
  const [linhas, setLinhas] = useState<LinhaConclusao[]>([]);
  const [adicionais, setAdicionais] = useState<LinhaConclusao[]>([]);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const enviarAnexos = useEnviarAnexosHoraExtra();
  const [prsCarregando, setPrsCarregando] = useState<Record<string, boolean>>({});
  const [prsEmEdicao, setPrsEmEdicao] = useState<Record<string, boolean>>({});
  const [linhaParaRemover, setLinhaParaRemover] = useState<LinhaConclusao | null>(null);
  const [resumo, setResumo] = useState("");
  const [gerando, setGerando] = useState(false);
  const [horarios, setHorarios] = useState({
    ponto_entrada_real: "07:30",
    ponto_saida_intervalo_real: "12:00",
    ponto_retorno_intervalo_real: "13:00",
    ponto_saida_real: "17:18",
  });
  // Ponto puxado da Senior (06/11/2026, regra em src/lib/horaExtraPontoSenior.ts).
  // Ref e não estado: o efeito que aplica as batidas lê editados e, como
  // dependência, se realimentaria.
  const editadosRef = useRef(new Set<CampoPonto>());
  const camposSeniorRef = useRef<ReadonlySet<CampoPonto>>(new Set());
  const [camposSenior, setCamposSenior] = useState<ReadonlySet<CampoPonto>>(new Set());
  const [puxadas, setPuxadas] = useState(0);
  useEffect(() => {
    if (!aberto || !solicitacao) return;
    // Horário já salvo (HE devolvida para ajuste) foi conferido por alguém:
    // não é trocado sozinho, só pelo botão "Puxar da Senior".
    editadosRef.current = new Set(CAMPOS_PONTO.filter((c) => solicitacao[`${c}_real` as const]));
    camposSeniorRef.current = new Set();
    setCamposSenior(camposSeniorRef.current);
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
      chamado_id: c.chamado_id ?? "",
      numero: linhaSemChamado(c) ? "" : c.chamado_numero,
      assunto: c.chamado_assunto,
      setor: c.chamado_setor,
      previsto: c.percentual_previsto,
      concluido: Number(c.percentual_concluido || 0),
      status: c.status_execucao || "nao_iniciado",
      observacao: c.observacao || "",
      adicional: c.adicional,
      sem_chamado: linhaSemChamado(c),
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
    setLinhaParaRemover(null);
  }, [aberto, solicitacao]);
  const jornada = solicitacao?.jornada_minutos ?? JORNADA_PADRAO_MIN;
  const semIntervalo = Boolean(solicitacao?.sem_intervalo);
  const jornadaCalculo = jornadaParaCalculoHoraExtra(jornada, solicitacao?.seguir_escala ?? true);
  const ponto = normalizarPontoSemIntervalo(
    {
      entrada: horarios.ponto_entrada_real,
      saida_intervalo: horarios.ponto_saida_intervalo_real,
      retorno_intervalo: horarios.ponto_retorno_intervalo_real,
      saida: horarios.ponto_saida_real,
    },
    semIntervalo,
  );
  const calculo = calcularHoraExtra(
    ponto,
    jornadaCalculo,
  );
  const minutos = calculo.excedente;
  const media = mediaConclusao([...linhas, ...adicionais].map((l) => l.concluido));
  const pontoMes = usePontoMesHoraExtra(
    aberto && solicitacao ? mesDaData(solicitacao.data_he) : null,
    solicitacao?.colaborador_id,
  );
  // null enquanto carrega: não mexe nos campos. Sem vínculo/espelho = [].
  const marcacoesSenior =
    aberto && solicitacao && pontoMes.data
      ? marcacoesDaJornada(pontoMes.data.colaborador?.batidas, solicitacao.data_he)
      : null;
  const chaveMarcacoes = marcacoesSenior?.join(",") ?? null;
  useEffect(() => {
    if (!aberto || !solicitacao || chaveMarcacoes === null) return;
    const planejado: ValoresPonto = {
      ponto_entrada: solicitacao.ponto_entrada.slice(0, 5),
      ponto_saida_intervalo: solicitacao.ponto_saida_intervalo.slice(0, 5),
      ponto_retorno_intervalo: solicitacao.ponto_retorno_intervalo.slice(0, 5),
      ponto_saida: solicitacao.ponto_saida.slice(0, 5),
    };
    const regra = {
      padrao: planejado,
      marcacoes: chaveMarcacoes ? chaveMarcacoes.split(",") : [],
      editados: new Set(editadosRef.current),
      daSenior: camposSeniorRef.current,
      semIntervalo: Boolean(solicitacao.sem_intervalo),
    };
    // Quais campos vieram da Senior não depende do valor atual. Fica fora do
    // updater do setHorarios, que precisa ser puro (o StrictMode roda duas vezes).
    const novos = aplicarMarcacoesSenior({ ...regra, atual: planejado }).daSenior;
    camposSeniorRef.current = novos;
    setCamposSenior(novos);
    setHorarios((atual) => {
      const r = aplicarMarcacoesSenior({
        ...regra,
        atual: {
          ponto_entrada: atual.ponto_entrada_real,
          ponto_saida_intervalo: atual.ponto_saida_intervalo_real,
          ponto_retorno_intervalo: atual.ponto_retorno_intervalo_real,
          ponto_saida: atual.ponto_saida_real,
        },
      });
      return {
        ponto_entrada_real: r.valores.ponto_entrada,
        ponto_saida_intervalo_real: r.valores.ponto_saida_intervalo,
        ponto_retorno_intervalo_real: r.valores.ponto_retorno_intervalo,
        ponto_saida_real: r.valores.ponto_saida,
      };
    });
  }, [aberto, solicitacao, chaveMarcacoes, puxadas]);
  if (!solicitacao) return null;
  /** O botão: as batidas voltam a valer sobre o que foi digitado, e busca de novo (a batida pode ter acabado de chegar). */
  const puxarDaSenior = () => {
    editadosRef.current = new Set();
    void pontoMes.refetch();
    setPuxadas((n) => n + 1);
  };
  const camposDoDia = CAMPOS_PONTO.filter(
    (c) => !semIntervalo || (c !== "ponto_saida_intervalo" && c !== "ponto_retorno_intervalo"),
  );
  const camposPuxados = camposDoDia.filter((c) => camposSenior.has(c));
  const camposSemBatida = camposDoDia.filter((c) => !camposSenior.has(c) && !editadosRef.current.has(c));
  const avisoSenior = pontoMes.isError
    ? "Não foi possível consultar o ponto da Senior. Preencha os horários manualmente."
    : !pontoMes.data
      ? "Buscando o ponto na Senior…"
      : !pontoMes.data.ponto_disponivel
        ? "Ponto da Senior indisponível para este colaborador. Preencha os horários manualmente."
        : [
            camposPuxados.length
              ? `Puxado da Senior: ${camposPuxados.map((c) => ROTULO_CAMPO_PONTO[c]).join(", ")}.`
              : "",
            camposSemBatida.length
              ? `Sem batida na Senior: ${camposSemBatida.map((c) => ROTULO_CAMPO_PONTO[c]).join(", ")}. Preencha manualmente.`
              : "",
            camposPuxados.length && !camposSemBatida.length ? "Confira e ajuste se precisar." : "",
          ]
            .filter(Boolean)
            .join(" ") || "Horários já informados mantidos. Use o botão para trocar pelas batidas da Senior.";
  const mudarHorario = (campo: keyof typeof horarios, valor: string) =>
    setHorarios((atual) =>
      semIntervalo && campo === "ponto_entrada_real"
        ? {
            ...atual,
            ponto_entrada_real: valor,
            ponto_saida_intervalo_real: valor,
            ponto_retorno_intervalo_real: valor,
          }
        : { ...atual, [campo]: valor },
    );
  const adicionarChamado = () =>
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
        sem_chamado: false,
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
      toast.error(`A PR #${numeroPr} já está em outra linha desta HE.`);
      return;
    }
    setPrsCarregando((atual) => ({ ...atual, [linha.chave]: true }));
    try {
      const dados = await buscarInformacoesPrHoraExtra(solicitacao.id, numeroPr);
      // O chamado planejado precisa de uma PR DELE. PR de outro chamado, uma
      // segunda PR do mesmo chamado ou PR sem chamado entram pelo "Adicionar
      // Chamado" — o mesmo chamado pode ter quantas linhas (PRs) precisar.
      // Na HE emergencial sem chamado (26/10/2026) é o contrário: a linha
      // planejada já nasce sem chamado e espera justamente uma PR
      // [SEM-CHAMADO]. PR COM chamado é que não cabe nela — entra pelo
      // "Adicionar Chamado", como qualquer chamado fora da solicitação.
      if (grupo === "originais" && !linha.sem_chamado && !dados.chamado) {
        throw new Error(
          `A PR #${numeroPr} não tem chamado no título. PR sem chamado entra como linha adicional (botão Adicionar Chamado).`,
        );
      }
      if (grupo === "originais" && linha.sem_chamado && dados.chamado) {
        throw new Error(
          `A PR #${numeroPr} tem o chamado #${dados.chamado.numero} no título, e esta HE foi aberta como ` +
            "emergencial sem chamado. Inclua essa PR pelo botão Adicionar Chamado.",
        );
      }
      if (grupo === "originais" && dados.chamado && dados.chamado.id !== linha.chamado_id) {
        throw new Error(
          `A PR #${numeroPr} pertence ao chamado #${dados.chamado.numero}, diferente deste chamado da solicitação.`,
        );
      }
      const semChamado = !dados.chamado;
      const setter = grupo === "originais" ? setLinhas : setAdicionais;
      setter((xs) =>
        xs.map((atual, i) =>
          i === indice
            ? {
                ...atual,
                chamado_id: dados.chamado?.id ?? "",
                numero: dados.chamado?.numero ?? "",
                assunto: dados.chamado?.assunto ?? dados.pr.titulo,
                setor: dados.chamado?.setor ?? null,
                sem_chamado: semChamado,
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
  const grupoDaLinha = (chave: string): { grupo: "originais" | "adicionais"; indice: number } | null => {
    const indiceOriginal = linhas.findIndex((linha) => linha.chave === chave);
    if (indiceOriginal >= 0) return { grupo: "originais", indice: indiceOriginal };
    const indiceAdicional = adicionais.findIndex((linha) => linha.chave === chave);
    return indiceAdicional >= 0 ? { grupo: "adicionais", indice: indiceAdicional } : null;
  };
  const atualizarTextoPrPorChave = (chave: string, pr_texto: string) => {
    const linha = grupoDaLinha(chave);
    if (linha) atualizarTextoPr(linha.grupo, linha.indice, pr_texto);
  };
  const consultarPrPorChave = (chave: string) => {
    const linha = grupoDaLinha(chave);
    if (linha) void consultarPr(linha.grupo, linha.indice);
  };
  /**
   * Tira a linha do relatório. Vale tanto para o chamado adicional quanto
   * para o que veio na solicitação: o chamado que não foi realizado na HE
   * sai daqui em vez de travar o envio por falta de PR, continua aberto e
   * pode entrar em outra hora extra depois.
   */
  const removerLinha = (chave: string) => {
    const resultado = removerLinhaRelatorioPr(linhas, adicionais, chave);
    if (resultado.erro) {
      toast.error(resultado.erro);
      return;
    }
    setLinhas(resultado.originais);
    setAdicionais(resultado.adicionais);
    const esquecer = (atual: Record<string, boolean>) => {
      const { [chave]: removida, ...resto } = atual;
      return resto;
    };
    setPrsCarregando(esquecer);
    setPrsEmEdicao(esquecer);
  };
  const pedirRemocaoLinha = (chave: string) => {
    const linha = [...linhas, ...adicionais].find((atual) => atual.chave === chave);
    if (!linha) return;
    // Linha adicional ainda em branco não tem nada a perder: sai direto.
    if (linha.adicional && !linha.chamado_id && !linha.pr_numero) {
      removerLinha(chave);
      return;
    }
    setLinhaParaRemover(linha);
  };
  // "Gerar mensagem" na conclusão (04/11/2026, Pablo: "esse mesmo botão tem
  // que ter quando for concluir a H.E"): o mesmo botão da justificativa da
  // solicitação, no modo "conclusao" da Edge hora-extra-justificativa-ia.
  // Conta só as linhas com PR validada — é o que de fato foi entregue. Falha
  // da I.A cai no resumo por modelo, como na solicitação.
  const linhasComPr = [...linhas, ...adicionais].filter((l) => l.pr_numero && l.pr_url);
  const gerarMensagem = async () => {
    const dados: DadosConclusao = {
      tipo: solicitacao.tipo,
      total_he: minutos ? formatarDuracao(minutos) : null,
      horario: calculo.excedente ? `${calculo.inicio} - ${calculo.fim}` : null,
      chamados: linhasComPr.map((l) => ({
        numero: l.sem_chamado ? null : l.numero || null,
        assunto: l.assunto || null,
        setor: l.setor ?? null,
        sem_chamado: l.sem_chamado,
        adicional: l.adicional,
        percentual_concluido: l.concluido,
        pr_numero: l.pr_numero,
        pr_titulo: l.pr_titulo,
        pr_linhas_adicionadas: l.pr_linhas_adicionadas,
        pr_commits: l.pr_commits,
      })),
    };
    setGerando(true);
    try {
      const texto = await pedirMensagemHoraExtra({ modo: "conclusao", conclusao: dados }, "conclusao");
      setResumo(texto.slice(0, LIMITE_RESUMO_CONCLUSAO));
    } catch (erro: unknown) {
      setResumo(gerarResumoConclusaoModelo(dados));
      toast.error(
        `${mensagemErro(erro, "Não foi possível gerar com a I.A.")} Usamos um texto padrão — revise antes de enviar.`,
      );
    } finally {
      setGerando(false);
    }
  };
  const enviar = async () => {
    const erros = validarConclusao(
      ponto,
      jornadaCalculo,
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
    if (adicionais.some((linha) => !linha.chamado_id && !linha.sem_chamado)) {
      toast.error("Aguarde a validação do chamado encontrado no título da PR.");
      return;
    }
    const seguir = await conferirLimite({
      colaboradorId: solicitacao.colaborador_id,
      data: solicitacao.data_he,
      minutos,
      ignorarId: solicitacao.id,
    });
    if (!seguir) return;
    try {
      await concluir.mutateAsync({
        p: {
          id: solicitacao.id,
          ...horarios,
          ponto_saida_intervalo_real: ponto.saida_intervalo,
          ponto_retorno_intervalo_real: ponto.retorno_intervalo,
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
            chamado_id: l.chamado_id || null,
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
  const inputHora = (rotulo: string, campoPonto: CampoPonto, desabilitado = false) => {
    const campo = `${campoPonto}_real` as keyof typeof horarios;
    const daSenior = camposSenior.has(campoPonto);
    return (
      <Campo rotulo={rotulo}>
        <Input
          type="time"
          disabled={desabilitado}
          value={horarios[campo]}
          title={daSenior ? "Puxado do ponto da Senior" : undefined}
          className={cn(daSenior && "border-emerald-300 bg-emerald-50")}
          onChange={(e) => {
            editadosRef.current.add(campoPonto);
            camposSeniorRef.current = new Set([...camposSeniorRef.current].filter((c) => c !== campoPonto));
            setCamposSenior(camposSeniorRef.current);
            mudarHorario(campo, e.target.value);
          }}
        />
      </Campo>
    );
  };
  return (
    <>
      <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
        <DialogContent className="w-[calc(100vw-2rem)] max-h-[96vh] max-w-[1500px] overflow-y-auto p-0">
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
                  "Os horários vêm do seu ponto na Senior no dia da hora extra. " +
                  "O que não tiver batida fica para preencher manualmente."
                }
                icone={<Clock3 className="h-5 w-5" />}
              >
                <div className="grid gap-3 lg:grid-cols-[1.4fr_.9fr_.55fr]">
                  <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 md:grid-cols-4">
                    {inputHora("Entrada", "ponto_entrada")}
                    {inputHora("Saída (intervalo)", "ponto_saida_intervalo", semIntervalo)}
                    {inputHora("Retorno (intervalo)", "ponto_retorno_intervalo", semIntervalo)}
                    {inputHora("Saída", "ponto_saida")}
                    {semIntervalo && (
                      <p className="col-span-2 text-xs font-medium text-blue-700 md:col-span-4">
                        Sem intervalo neste dia.
                      </p>
                    )}
                    <div className="col-span-2 flex items-start justify-between gap-2 md:col-span-4">
                      <p
                        className={cn(
                          "text-[11px]",
                          camposSemBatida.length || pontoMes.isError || pontoMes.data?.ponto_disponivel === false
                            ? "text-amber-700"
                            : camposPuxados.length
                              ? "text-emerald-700"
                              : "text-slate-500",
                        )}
                      >
                        {avisoSenior}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 shrink-0 px-2 text-[11px]"
                        disabled={pontoMes.isFetching}
                        onClick={puxarDaSenior}
                      >
                        <RefreshCw className={cn("mr-1 h-3 w-3", pontoMes.isFetching && "animate-spin")} />
                        Puxar da Senior
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 rounded-lg bg-blue-50 p-3">
                    <div className="col-span-2 text-xs font-semibold text-blue-700">
                      {jornadaCalculo
                        ? `Horário da HE (calculado pela escala de ${formatarDuracao(jornada, true)})`
                        : "Horário da HE (todo o período trabalhado)"}
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
                subtitulo={
                  "Informe a PR de cada chamado. As métricas e o ID do chamado são preenchidos " +
                  "automaticamente pelo GitHub. Chamado que não foi realizado pode ser removido da tabela."
                }
                icone={<UsersRound className="h-5 w-5" />}
              >
                <TabelaRelatorioPr
                  linhas={[...linhas, ...adicionais]}
                  prsCarregando={prsCarregando}
                  prsEmEdicao={prsEmEdicao}
                  aoEditarPr={(chave) => setPrsEmEdicao((atual) => ({ ...atual, [chave]: true }))}
                  aoAlterarTextoPr={atualizarTextoPrPorChave}
                  aoConsultarPr={consultarPrPorChave}
                  aoExcluir={pedirRemocaoLinha}
                />
                <div className="mt-3 text-right">
                  <Button type="button" variant="outline" onClick={adicionarChamado}>
                    + &nbsp; Adicionar Chamado
                  </Button>
                </div>
              </SecaoForm>
              <SecaoForm
                titulo="4. Resumo e observações"
                subtitulo={
                  "Descreva aqui um resumo do que foi realizado durante a hora extra " + "e se houve algum impedimento."
                }
                icone={<FileText className="h-5 w-5" />}
              >
                <BotaoGerarMensagem
                  gerando={gerando}
                  desabilitado={!linhasComPr.length}
                  dica="Informe e valide ao menos uma PR na seção 3."
                  aoClicar={gerarMensagem}
                />
                <Textarea
                  maxLength={LIMITE_RESUMO_CONCLUSAO}
                  rows={3}
                  value={resumo}
                  onChange={(e) => setResumo(e.target.value)}
                />
                <div className="mt-1 text-right text-xs text-slate-500">
                  {resumo.length}/{LIMITE_RESUMO_CONCLUSAO}
                </div>
              </SecaoForm>
              <SecaoForm titulo="5. Anexos (opcional)" icone={<FileText className="h-5 w-5" />}>
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
                  valor={`${formatarData(solicitacao.data_he)} (${diaSemana(solicitacao.data_he)})${solicitacao.feriado ? " · Feriado" : ""}`}
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
                  rotulo="Linhas adicionais"
                  valor={`${adicionais.length} ${adicionais.length === 1 ? "PR" : "PRs"}${
                    adicionais.some((l) => l.sem_chamado) ? ` · ${adicionais.filter((l) => l.sem_chamado).length} sem chamado` : ""
                  }`}
                />
                <Resumo rotulo="Média de conclusão" valor={`${media}%`} />
              </div>
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-5 text-sm text-[#07194b]">
                <h3 className="mb-3 flex gap-2 font-bold">
                  <Info className="h-5 w-5 text-orange-500" />
                  Importante
                </h3>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Os horários vêm do seu ponto na Senior. Sem batida, informe exatamente como registrado no ponto.</li>
                  <li>
                    {jornadaCalculo ? (
                      <>A hora extra é <strong>calculada</strong>: conta só o tempo que passar da jornada da escala.</>
                    ) : (
                      <>Neste fim de semana, <strong>todo o período trabalhado</strong> conta como hora extra.</>
                    )}
                  </li>
                  <li>Digite a PR no formato <strong>#624</strong> para preencher suas métricas automaticamente.</li>
                  <li>O título da PR precisa começar pelo ID do chamado, como <strong>SIS-2026-0459:</strong>.</li>
                  <li>É possível incluir PRs de chamados adicionais realizados durante a hora extra.</li>
                  <li>
                    Mais de uma PR para o mesmo chamado: uma linha para cada PR (botão <strong>Adicionar Chamado</strong>).
                  </li>
                  <li>
                    PR <strong>sem chamado</strong> ([SEM-CHAMADO]) também entra, como linha adicional.
                  </li>
                  <li>
                    Chamado que você <strong>não realizou</strong> pode sair da tabela pela lixeira: ele
                    continua aberto para entrar em outra HE.
                  </li>
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
      {dialogoLimite}
      <AlertDialog open={Boolean(linhaParaRemover)} onOpenChange={(v) => !v && setLinhaParaRemover(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {linhaParaRemover?.numero
                ? `Remover o chamado #${linhaParaRemover.numero} do relatório?`
                : "Remover esta linha do relatório?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {linhaParaRemover?.adicional
                ? "O chamado sai do relatório desta hora extra. Dá para incluí-lo de novo pelo botão Adicionar Chamado."
                : "O chamado sai desta hora extra e deixa de exigir PR para concluir a solicitação. " +
                  "Ele continua aberto e pode ser incluído em outra HE depois."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (linhaParaRemover) removerLinha(linhaParaRemover.chave);
                setLinhaParaRemover(null);
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  prsCarregando,
  prsEmEdicao,
  aoEditarPr,
  aoAlterarTextoPr,
  aoConsultarPr,
  aoExcluir,
}: {
  linhas: LinhaConclusao[];
  prsCarregando: Record<string, boolean>;
  prsEmEdicao: Record<string, boolean>;
  aoEditarPr: (chave: string) => void;
  aoAlterarTextoPr: (chave: string, valor: string) => void;
  aoConsultarPr: (chave: string) => void;
  aoExcluir: (chave: string) => void;
}) {
  const totais = totalizarLinhasRelatorioPr(linhas);
  const contagem = contarRelatorioPr(linhas);
  const colunas = 6;
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
            <th className="p-2 text-center">Ações</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
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
                      onChange={(e) => aoAlterarTextoPr(l.chave, e.target.value)}
                      onBlur={() => l.pr_texto.trim() && aoConsultarPr(l.chave)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          aoConsultarPr(l.chave);
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
                {l.sem_chamado ? (
                  <>
                    <div className="font-semibold text-slate-500">Sem chamado</div>
                    {l.assunto && (
                      <div className="max-w-56 truncate text-slate-500" title={l.assunto}>
                        {l.assunto}
                      </div>
                    )}
                  </>
                ) : l.numero ? (
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
              <td className="p-2 text-center">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => aoExcluir(l.chave)}
                  title={
                    l.adicional
                      ? "Remover este chamado adicional"
                      : "Remover este chamado da hora extra"
                  }
                  aria-label={
                    l.numero ? `Remover o chamado ${l.numero} do relatório` : "Remover esta linha do relatório"
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </td>
            </tr>
          ))}
          {!linhas.length && (
            <tr>
              <td colSpan={colunas} className="p-5 text-center text-slate-500">
                Nenhum chamado na solicitação.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100 font-bold text-red-600">
            <td className="p-2">TOTAL · {contagem.prs} {contagem.prs === 1 ? "PR" : "PRs"}</td>
            <td className="p-2 text-center tabular-nums">{totais.linhas_adicionadas.toLocaleString("pt-BR")}</td>
            <td className="p-2 text-center tabular-nums">{totais.commits.toLocaleString("pt-BR")}</td>
            <td className="p-2">{textoChamadosRelatorioPr(contagem)}</td>
            <td className="p-2 text-center tabular-nums">{totais.arquivos_adicionados.toLocaleString("pt-BR")}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
