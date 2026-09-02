import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle, Building2, CheckCircle2, Clock, FileText, Loader2, Paperclip,
  Plus, Receipt, Settings2, ShieldCheck, Trash2, XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogTitle,
} from "@/components/ui/dialog";
import { useMeuNome } from "@/hooks/useMeuNome";
import {
  useCriarReembolso, useDecidirReembolso, useMeusStats, useMeuSetor, useReembolsos,
  useTiposReembolso, type DespesaNova, type EtapaEnvio,
} from "@/hooks/useReembolso";
import {
  avisoDeTeto, competenciaDe, dataParaISO, descreveJanela, descreveTeto, fmtBRL,
  normalizaHora, podeLancar, tiposDisponiveis, totalEmCentavos, valorEmCentavos,
  type TipoReembolso,
} from "@/lib/reembolso/regras";
import { ListaReembolsos } from "./componentes/ListaReembolsos";

// =====================================================================
// SOLICITAR REEMBOLSO — a tela de quem pede.
//
// Substitui o bot de Discord, onde o fluxo era: clicar num botão do canal,
// preencher um modal, migrar para a DM, escolher a despesa num select, digitar
// o valor em outro modal e MANDAR O COMPROVANTE COMO ANEXO DE MENSAGEM. Sete
// idas e vindas entre canal e DM, e a sessão expirava em 30 minutos.
//
// Aqui é um formulário só: a viagem em cima, as despesas embaixo, e o botão de
// enviar quando fecha. A ordem não é estética — os tipos disponíveis DEPENDEM
// do horário da viagem, então saída e chegada precisam vir antes.
// =====================================================================

interface DespesaRascunho {
  tipo_codigo: string;
  valor: string;
  arquivo: File | null;
}

const rascunhoVazio = (): DespesaRascunho => ({ tipo_codigo: "", valor: "", arquivo: null });

/**
 * Os três estados que o clique em "Enviar para aprovação" pode produzir.
 *
 * União discriminada em vez de três `useState` soltos porque eles são
 * mutuamente exclusivos: com booleanos separados existia o estado "enviando e
 * com erro ao mesmo tempo", que nunca deveria acontecer e sempre acontecia.
 */
type EstadoEnvio =
  | { estado: "enviando"; progresso: EtapaEnvio }
  | { estado: "erro"; mensagem: string; chegouAoBanco: boolean }
  | { estado: "sucesso"; numero: string; total: number };

/** O bot aceitava PNG, JPG, JPEG e PDF. Mantido igual. */
const ACEITA = ".png,.jpg,.jpeg,.pdf";
const MIMES_OK = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];
const TAMANHO_MAX = 20 * 1024 * 1024; // o bucket recusa acima disso

export default function SolicitarReembolso() {
  const meuNome = useMeuNome();
  // Vem do banco, nao do cadastro lido no front: e exatamente o que a trigger
  // vai carimbar. Se os dois discordassem, a pessoa veria um setor na tela e a
  // solicitacao chegaria para o aprovador de outro.
  const { data: meuSetor, isLoading: carregandoSetor } = useMeuSetor();
  const { data: tipos = [], isLoading: carregandoTipos } = useTiposReembolso();
  const { data: stats } = useMeusStats();
  const criar = useCriarReembolso();
  const decidir = useDecidirReembolso();

  // Dados da viagem
  const [pix, setPix] = useState("");
  const [distancia, setDistancia] = useState("");
  const [data, setData] = useState("");
  const [saida, setSaida] = useState("");
  const [chegada, setChegada] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [despesas, setDespesas] = useState<DespesaRascunho[]>([rascunhoVazio()]);

  /**
   * TUDO que o botão "Enviar para aprovação" tem a dizer, no meio da tela.
   *
   * Toast não serve para nenhum dos três momentos deste botão:
   *
   *  • ENVIANDO — são um upload e um insert por despesa, sequenciais. Com
   *    comprovante de celular em rede de obra passa de dez segundos, e nesse
   *    tempo um botão escrito "Enviando…" não distingue lento de travado.
   *  • ERRO — foi o que motivou este redesenho (02/09/2026): a tarja no canto
   *    aparecia junto com o formulário ainda cheio e sumia sozinha em segundos.
   *    A leitura de quem usa era "deu um errinho mas foi" — e não tinha ido.
   *    Erro de envio agora PARA a tela e espera ser lido.
   *  • SUCESSO — o formulário se esvazia no mesmo instante; ver a tela em
   *    branco com uma tarja sumindo no canto deixa a dúvida de sempre, "foi?".
   *
   * As três viram o mesmo painel central, porque são a mesma pergunta ("e
   * aí?") em três respostas. Validação de campo (PIX vazio, hora inválida)
   * também entra aqui: sai do mesmo clique, e mandar metade da resposta para o
   * canto e metade para o meio era o que confundia.
   */
  const [envio, setEnvio] = useState<EstadoEnvio | null>(null);

  const saidaOk = normalizaHora(saida);
  const chegadaOk = normalizaHora(chegada);
  const dataOk = dataParaISO(data);

  /**
   * O catálogo recortado por ESTA viagem.
   *
   * Enquanto saída e chegada não forem válidas não dá para dizer o que a
   * pessoa pode pedir — e oferecer os seis tipos para depois recusar era
   * exatamente o que o bot fazia.
   */
  const disponiveis = useMemo(
    () => (saidaOk && chegadaOk ? tiposDisponiveis(tipos, saidaOk, chegadaOk) : []),
    [tipos, saidaOk, chegadaOk],
  );

  /** Tipos que existem mas ficaram de fora — a tela explica por quê. */
  const fora = useMemo(() => {
    if (!saidaOk || !chegadaOk) return [];
    const dentro = new Set(disponiveis.map((t) => t.codigo));
    return tipos.filter((t) => t.ativo && !dentro.has(t.codigo));
  }, [tipos, disponiveis, saidaOk, chegadaOk]);

  const porCodigo = useMemo(() => {
    const m = new Map<string, TipoReembolso>();
    tipos.forEach((t) => m.set(t.codigo, t));
    return m;
  }, [tipos]);

  const totalRascunho = totalEmCentavos(
    despesas.map((d) => ({ valor_centavos: valorEmCentavos(d.valor) ?? 0 })),
  );

  const alterarDespesa = (i: number, patch: Partial<DespesaRascunho>) =>
    setDespesas((atual) => atual.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  const anexar = (i: number, file: File | null) => {
    if (!file) return alterarDespesa(i, { arquivo: null });
    if (!MIMES_OK.includes(file.type)) {
      toast.error("Comprovante tem que ser PNG, JPG ou PDF.");
      return;
    }
    if (file.size > TAMANHO_MAX) {
      toast.error("Comprovante acima de 20 MB.");
      return;
    }
    alterarDespesa(i, { arquivo: file });
  };

  const limpar = () => {
    setPix(""); setDistancia(""); setData(""); setSaida(""); setChegada("");
    setObservacoes(""); setDespesas([rascunhoVazio()]);
  };

  /**
   * Valida tudo ANTES de tocar no banco.
   *
   * As mesmas regras existem em trigger, e é lá que elas valem de verdade —
   * mas deixar a pessoa subir três comprovantes para o quarto ser recusado é o
   * tipo de coisa que faz o formulário ser abandonado.
   */
  const enviar = async () => {
    /** Recusa que ainda nem tocou no banco — o formulário continua intacto. */
    const recusa = (mensagem: string) => {
      setEnvio({ estado: "erro", mensagem, chegouAoBanco: false });
    };

    // O banco recusa de qualquer forma (a trigger levanta excecao), mas deixar
    // a pessoa subir tres comprovantes para so entao descobrir que o cadastro
    // dela nao tem setor seria cruel.
    if (!meuSetor) {
      return recusa("Seu usuário não tem um setor definido, então não há para quem enviar. Peça a quem administra o ERP para marcar o setor em Administração › Acesso por Usuário.");
    }
    if (!pix.trim()) return recusa("Informe o PIX que vai receber o reembolso.");
    if (!dataOk) return recusa("Data da viagem inválida. Use DD/MM/AAAA.");
    if (!saidaOk || !chegadaOk) return recusa("Horário de saída ou chegada inválido.");

    const km = Number(String(distancia).replace(",", "."));
    if (!Number.isFinite(km) || km < 0) return recusa("Distância inválida.");

    const preenchidas = despesas.filter((d) => d.tipo_codigo || d.valor || d.arquivo);
    if (!preenchidas.length) return recusa("Adicione pelo menos uma despesa.");

    const prontas: DespesaNova[] = [];
    for (const d of preenchidas) {
      const tipo = porCodigo.get(d.tipo_codigo);
      const centavos = valorEmCentavos(d.valor);
      const veredito = podeLancar(tipo, centavos, saidaOk, chegadaOk);
      if (!veredito.ok) return recusa(veredito.mensagem ?? "Despesa inválida.");
      if (!d.arquivo) {
        return recusa(`Falta o comprovante de ${tipo?.nome ?? d.tipo_codigo}.`);
      }
      prontas.push({ tipo_codigo: d.tipo_codigo, valor_centavos: centavos!, arquivo: d.arquivo });
    }

    const repetido = prontas.map((p) => p.tipo_codigo)
      .find((c, i, arr) => arr.indexOf(c) !== i);
    if (repetido) {
      return recusa(`${porCodigo.get(repetido)?.nome ?? repetido} está lançado duas vezes.`);
    }

    const total = totalRascunho;
    setEnvio({
      estado: "enviando",
      progresso: { etapa: "abrindo", indice: 0, total: prontas.length },
    });

    try {
      const criada = await criar.mutateAsync({
        pix: pix.trim(),
        distancia_km: km,
        data_viagem: dataOk,
        competencia: competenciaDe(dataOk),
        saida: saidaOk,
        chegada: chegadaOk,
        observacoes: observacoes.trim() || null,
        solicitante_nome: meuNome,
        despesas: prontas,
        onProgresso: (progresso) =>
          setEnvio((atual) =>
            atual?.estado === "enviando" ? { ...atual, progresso } : atual),
      });
      setEnvio({ estado: "sucesso", numero: criada.numero ?? "", total });
      limpar();
    } catch (e: any) {
      // `chegouAoBanco` muda o texto do rodapé: aqui o cabeçalho chegou a ser
      // criado e o hook desfez tudo, então vale dizer que não sobrou nada
      // pendurado — é a dúvida que o toast antigo deixava no ar.
      setEnvio({
        estado: "erro",
        mensagem: e?.message ?? "Não deu para enviar a solicitação.",
        chegouAoBanco: true,
      });
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Solicitar Reembolso"
        subtitle="Despesas de viagem a trabalho: informe o trajeto, lance cada despesa com o comprovante e envie para aprovação."
        module="Central de Serviços"
        breadcrumb={["Solicitar Reembolso"]}
        actions={
          <div className="flex gap-2">
            <AcessoGate menu="central_servicos_reembolso_aprovacao" acao="visualizar">
              <Button variant="outline" size="sm" asChild>
                <Link to="/app/central-servicos/reembolso/aprovacao">
                  <ShieldCheck className="mr-2 h-4 w-4" /> Fila de aprovação
                </Link>
              </Button>
            </AcessoGate>
            <AcessoGate menu="central_servicos_reembolso_config" acao="alterar">
              <Button variant="outline" size="sm" asChild>
                <Link to="/app/central-servicos/reembolso/configuracao">
                  <Settings2 className="mr-2 h-4 w-4" /> Tipos e limites
                </Link>
              </Button>
            </AcessoGate>
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Kpi titulo="Aguardando aprovação" valor={String(stats?.pendentes ?? 0)} icone={Clock}
             cor="bg-amber-100 text-amber-700" />
        <Kpi titulo="Aprovadas" valor={String(stats?.aprovados ?? 0)} icone={CheckCircle2}
             cor="bg-emerald-100 text-emerald-700" />
        <Kpi titulo="Reprovadas" valor={String(stats?.reprovados ?? 0)} icone={XCircle}
             cor="bg-rose-100 text-rose-700" />
        <Kpi titulo="Total aprovado" valor={fmtBRL(stats?.total_aprovado_centavos ?? 0)} icone={Receipt}
             cor="bg-sky-100 text-sky-700" />
      </div>

      <Tabs defaultValue="nova">
        <TabsList className="mb-4">
          <TabsTrigger value="nova">Nova solicitação</TabsTrigger>
          <TabsTrigger value="minhas">Minhas solicitações</TabsTrigger>
        </TabsList>

        <TabsContent value="nova">
          <AcessoGate
            menu="central_servicos_reembolso"
            acao="incluir"
            fallback={
              <Card className="p-6 text-sm text-muted-foreground">
                Você pode acompanhar as suas solicitações, mas não tem liberação para abrir novas.
                Peça a permissão de <strong>incluir</strong> em Administração › Acesso por Usuário.
              </Card>
            }
          >
            {/* O setor não é campo: é consequência do cadastro. Fica visível
                porque é ele que decide para quem a solicitação vai — a pessoa
                precisa saber quem vai receber, mesmo não podendo escolher. */}
            {carregandoSetor ? null : meuSetor ? (
              <Card className="mb-4 flex flex-wrap items-center gap-2 p-4 text-sm">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Seu setor:</span>
                <Badge variant="outline">{meuSetor}</Badge>
                <span className="text-xs text-muted-foreground">
                  vem do seu usuário no ERP e define quem aprova este reembolso.
                </span>
              </Card>
            ) : (
              <Card className="mb-4 flex items-start gap-2 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong>Seu usuário não tem um setor definido</strong>, então não há para quem
                  enviar o reembolso. Peça a quem administra o ERP para marcar o seu setor em
                  Administração › Acesso por Usuário — e, se houver mais de um marcado, deixar
                  só o principal: com dois, não há como saber qual aprovador deve receber.
                </span>
              </Card>
            )}

            <Card className="mb-4 p-5">
              <h3 className="mb-1 text-sm font-semibold">A viagem</h3>
              <p className="mb-4 text-xs text-muted-foreground">
                O horário decide quais despesas você pode lançar — almoço só vale se a viagem
                passou pela janela do almoço.
              </p>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pix">PIX para receber <span className="text-destructive">*</span></Label>
                  <Input id="pix" value={pix} onChange={(e) => setPix(e.target.value)}
                         placeholder="CPF, telefone, e-mail ou chave aleatória" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="km">Distância média (KM)</Label>
                  <Input id="km" inputMode="decimal" value={distancia}
                         onChange={(e) => setDistancia(e.target.value)} placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="data">Data da viagem <span className="text-destructive">*</span></Label>
                  <Input id="data" value={data} onChange={(e) => setData(e.target.value)}
                         placeholder="DD/MM/AAAA" />
                  {data && !dataOk && (
                    <p className="text-xs text-destructive">Data inválida.</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="saida">Hora de saída <span className="text-destructive">*</span></Label>
                  <Input id="saida" value={saida} onChange={(e) => setSaida(e.target.value)}
                         placeholder="08:00" />
                  {saida && !saidaOk && <p className="text-xs text-destructive">Horário inválido.</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="chegada">Hora de chegada <span className="text-destructive">*</span></Label>
                  <Input id="chegada" value={chegada} onChange={(e) => setChegada(e.target.value)}
                         placeholder="18:00" />
                  {chegada && !chegadaOk && <p className="text-xs text-destructive">Horário inválido.</p>}
                </div>
                <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                  <Label htmlFor="obs">Observações</Label>
                  <Textarea id="obs" rows={1} value={observacoes}
                            onChange={(e) => setObservacoes(e.target.value)}
                            placeholder="Algo que o aprovador precise saber" />
                </div>
              </div>
            </Card>

            <Card className="mb-4 p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">As despesas</h3>
                  <p className="text-xs text-muted-foreground">
                    Uma linha por tipo, cada uma com comprovante (PNG, JPG ou PDF).
                  </p>
                </div>
                <p className="text-sm font-semibold">Total: {fmtBRL(totalRascunho)}</p>
              </div>

              {!saidaOk || !chegadaOk ? (
                <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                  Preencha a saída e a chegada para ver quais despesas você pode lançar nesta viagem.
                </p>
              ) : carregandoTipos ? (
                <p className="text-sm text-muted-foreground">Carregando os tipos…</p>
              ) : !disponiveis.length ? (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  Nenhum tipo de despesa se encaixa numa viagem das {saidaOk} às {chegadaOk}.
                </p>
              ) : (
                <div className="space-y-3">
                  {despesas.map((d, i) => {
                    const tipo = porCodigo.get(d.tipo_codigo);
                    const centavos = valorEmCentavos(d.valor);
                    const veredito = d.tipo_codigo && d.valor
                      ? podeLancar(tipo, centavos, saidaOk, chegadaOk)
                      : { ok: true };
                    // Aviso, não impedimento: o valor é o que a pessoa gastou,
                    // e quem decide sobre o excedente é o aprovador.
                    const aviso = avisoDeTeto(tipo, centavos);
                    return (
                      <div key={i} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_140px_1fr_auto]">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Tipo</Label>
                          <Select value={d.tipo_codigo}
                                  onValueChange={(v) => alterarDespesa(i, { tipo_codigo: v })}>
                            <SelectTrigger><SelectValue placeholder="Escolha a despesa" /></SelectTrigger>
                            <SelectContent>
                              {disponiveis.map((t) => (
                                <SelectItem key={t.codigo} value={t.codigo}>
                                  {t.nome} — teto {descreveTeto(t)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Valor (R$)</Label>
                          <Input inputMode="decimal" placeholder="0,00" value={d.valor}
                                 className={aviso ? "border-amber-400 focus-visible:ring-amber-400" : undefined}
                                 onChange={(e) => alterarDespesa(i, { valor: e.target.value })} />
                          {tipo && (
                            <p className="text-[11px] leading-tight text-muted-foreground">
                              Teto {descreveTeto(tipo)}
                            </p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Comprovante</Label>
                          <Input type="file" accept={ACEITA}
                                 onChange={(e) => anexar(i, e.target.files?.[0] ?? null)} />
                          {d.arquivo && (
                            <p className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Paperclip className="h-3 w-3" /> {d.arquivo.name}
                            </p>
                          )}
                        </div>

                        <div className="flex items-end">
                          <Button variant="ghost" size="icon" title="Remover despesa"
                                  onClick={() => setDespesas((a) => a.filter((_, idx) => idx !== i))}
                                  disabled={despesas.length === 1}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        {!veredito.ok && (
                          <p className="flex items-start gap-1.5 text-xs text-destructive sm:col-span-4">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {veredito.mensagem}
                          </p>
                        )}

                        {aviso && (
                          <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 sm:col-span-4">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {aviso}
                          </p>
                        )}
                      </div>
                    );
                  })}

                  <Button variant="outline" size="sm"
                          onClick={() => setDespesas((a) => [...a, rascunhoVazio()])}>
                    <Plus className="mr-2 h-4 w-4" /> Adicionar despesa
                  </Button>
                </div>
              )}

              {fora.length > 0 && (
                <div className="mt-4 rounded-lg bg-muted/50 p-3">
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">
                    Fora desta viagem
                  </p>
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {fora.map((t) => (
                      <li key={t.codigo}>
                        <strong>{t.nome}</strong> — vale para viagem que passe entre {descreveJanela(t)}.
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            <div className="flex flex-wrap gap-2">
              <Button onClick={enviar} disabled={criar.isPending || !meuSetor}>
                {criar.isPending
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</>
                  : <><FileText className="mr-2 h-4 w-4" /> Enviar para aprovação</>}
              </Button>
              <Button variant="ghost" onClick={limpar} disabled={criar.isPending}>
                Limpar
              </Button>
            </div>
          </AcessoGate>
        </TabsContent>

        <TabsContent value="minhas">
          <MinhasSolicitacoes
            onCancelar={(id) =>
              decidir.mutate({ id, acao: "cancelar" }, {
                onSuccess: () => toast.success("Solicitação cancelada."),
                onError: (e: any) => toast.error(e?.message ?? "Não deu para cancelar."),
              })
            }
            cancelando={decidir.isPending}
          />
        </TabsContent>
      </Tabs>

      <PainelDeEnvio envio={envio} onFechar={() => setEnvio(null)} />
    </div>
  );
}

/**
 * O painel central do envio — esperando, deu errado, ou foi.
 *
 * É `Dialog` (Radix) de propósito, e não uma div com `fixed`: enquanto ele
 * está aberto o foco fica preso dentro, o resto da página vira inerte para
 * leitor de tela, e Esc fecha. Um overlay caseiro dava o mesmo desenho e
 * nenhuma dessas três coisas.
 *
 * As animações são as que os Chamados já usam (`check-pop`, `status-flash`,
 * `rise-in`, `shake`, `float-soft`, `ring-pulse`) em vez de keyframe novo para
 * o mesmo gesto — assim o ERP confirma e recusa coisa sempre do mesmo jeito.
 */
function PainelDeEnvio({ envio, onFechar }: {
  envio: EstadoEnvio | null;
  onFechar: () => void;
}) {
  const enviando = envio?.estado === "enviando";
  return (
    <Dialog
      open={!!envio}
      onOpenChange={(aberto) => {
        // Fechar no meio do envio não cancelaria upload nenhum — só esconderia
        // o que está acontecendo. Enquanto envia, o painel não fecha.
        if (!aberto && !enviando) onFechar();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => { if (enviando) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (enviando) e.preventDefault(); }}
      >
        {envio?.estado === "enviando" && <EnviandoAgora progresso={envio.progresso} />}
        {envio?.estado === "erro" && <EnvioRecusado envio={envio} onFechar={onFechar} />}
        {envio?.estado === "sucesso" && <EnvioConfirmado envio={envio} onFechar={onFechar} />}
      </DialogContent>
    </Dialog>
  );
}

/** Passo a passo do envio, para dez segundos de espera não parecerem travamento. */
function EnviandoAgora({ progresso }: { progresso: EtapaEnvio }) {
  const { etapa, indice, total, nomeArquivo } = progresso;

  // O cabeçalho é o passo 0; cada despesa vale um passo. A barra anda por
  // ETAPA concluída, não por tempo — inventar um tempo que não se conhece é o
  // que faz barra de progresso empacar em 90%.
  const passos = total + 1;
  const feitos = etapa === "abrindo" ? 0
    : etapa === "concluido" ? passos
    : indice; // comprovante/registro da despesa `indice`: as anteriores fecharam
  const pct = Math.round((feitos / passos) * 100);

  const legenda =
    etapa === "abrindo" ? "Abrindo a solicitação…"
    : etapa === "comprovante" ? `Enviando o comprovante ${indice} de ${total}…`
    : etapa === "registrando" ? `Registrando a despesa ${indice} de ${total}…`
    : "Fechando a solicitação…";

  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <DialogTitle className="sr-only">Enviando a solicitação</DialogTitle>
      <DialogDescription className="sr-only">{legenda}</DialogDescription>

      {/* Recibo subindo dentro de um anel que pulsa: o mesmo ícone da tela,
          em movimento. */}
      <span className="relative grid h-24 w-24 place-items-center">
        <span className="absolute inset-0 animate-ring-pulse rounded-full bg-primary/10" />
        <span className="absolute inset-2 rounded-full border-2 border-dashed border-primary/30 [animation:spin_9s_linear_infinite]" />
        <Receipt className="h-10 w-10 animate-float-soft text-primary" />
      </span>

      <div className="w-full space-y-2">
        <p aria-live="polite" className="text-sm font-medium">{legenda}</p>
        {nomeArquivo && (
          <p className="truncate text-xs text-muted-foreground">{nomeArquivo}</p>
        )}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(pct, 8)}%` }}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Não feche a página — os comprovantes ainda estão subindo.
      </p>
    </div>
  );
}

/** A recusa. Fica parada até ser lida; era isso que faltava no toast. */
function EnvioRecusado({ envio, onFechar }: {
  envio: Extract<EstadoEnvio, { estado: "erro" }>;
  onFechar: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <span className="grid h-20 w-20 animate-shake place-items-center rounded-full bg-rose-100">
        <AlertTriangle className="h-10 w-10 animate-check-pop text-rose-600" />
      </span>

      <div className="animate-rise-in space-y-1">
        <DialogTitle className="text-xl">A solicitação não foi enviada</DialogTitle>
        <DialogDescription>{envio.mensagem}</DialogDescription>
      </div>

      <p className="animate-rise-in text-xs text-muted-foreground [animation-delay:80ms]">
        {envio.chegouAoBanco
          ? "Nada ficou pendurado: o que já tinha subido foi desfeito. Corrija o que a mensagem aponta e envie de novo — o formulário continua preenchido."
          : "O formulário continua preenchido. Corrija o campo apontado e envie de novo."}
      </p>

      <Button variant="outline" className="w-full" onClick={onFechar}>
        Voltar ao formulário
      </Button>
    </div>
  );
}

/** O recibo: segura o número da solicitação até a pessoa fechar. */
function EnvioConfirmado({ envio, onFechar }: {
  envio: Extract<EstadoEnvio, { estado: "sucesso" }>;
  onFechar: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <span className="grid h-20 w-20 animate-status-flash place-items-center rounded-full bg-emerald-100">
        <CheckCircle2 className="h-11 w-11 animate-check-pop text-emerald-600" />
      </span>

      <div className="animate-rise-in space-y-1">
        <DialogTitle className="text-xl">Solicitação enviada!</DialogTitle>
        <DialogDescription>
          Ela já está na fila de quem aprova o seu setor.
        </DialogDescription>
      </div>

      <div className="w-full animate-rise-in rounded-xl border bg-muted/40 p-4 [animation-delay:80ms]">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Número</span>
          <span className="font-semibold">{envio.numero || "—"}</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Total</span>
          <span className="font-semibold">{fmtBRL(envio.total)}</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Acompanhe em <strong>Minhas solicitações</strong> — dá para cancelar
        enquanto ninguém decidir.
      </p>

      <Button className="w-full" onClick={onFechar}>Entendi</Button>
    </div>
  );
}

function MinhasSolicitacoes({ onCancelar, cancelando }: {
  onCancelar: (id: string) => void;
  cancelando: boolean;
}) {
  const { data: lista = [], isLoading } = useReembolsos("meus");
  return (
    <ListaReembolsos
      lista={lista}
      carregando={isLoading}
      vazio="Você ainda não pediu nenhum reembolso."
      acoes={(r) =>
        r.status === "pendente" ? (
          <Button variant="outline" size="sm" disabled={cancelando}
                  onClick={() => onCancelar(r.id)}>
            Cancelar
          </Button>
        ) : null
      }
    />
  );
}

function Kpi({ titulo, valor, icone: Icone, cor }: {
  titulo: string; valor: string; icone: typeof Clock; cor: string;
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${cor}`}>
        <Icone className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{titulo}</p>
        <p className="truncate text-lg font-semibold">{valor}</p>
      </div>
    </Card>
  );
}
