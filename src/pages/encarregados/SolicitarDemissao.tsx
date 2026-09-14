import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/layout/PageHeader";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";
import { BuscaColaborador, carregarEmpregadoEscolhido, type EmpregadoEscolhido } from "@/components/demissao/BuscaColaborador";
import { ModalNovaVaga } from "@/components/recrutamento/ModalNovaVaga";
import {
  ACCEPT_ANEXO, BUCKET, MODELOS_AVISO, MOTIVOS_PEDIDO, MOTIVOS_SOLICITACAO,
  TABELA, TABELA_ANEXOS, TERMINOS_EXPERIENCIA,
  corDoStatus, emailValido, erroDoArquivo, explicaStatus, faltaVagaDeReposicao, fmtData, fmtTamanho,
  hojeISO, mascaraTelefone, telefoneCompleto, type SolicitacaoDemissao,
} from "@/lib/demissao/solicitacao";
import {
  CheckCircle2, ChevronLeft, ChevronRight, FileText, Loader2, Lock, Paperclip, Trash2, UserMinus,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { semCodigoFilial } from "@/lib/rh/colaboradoresUtils";

const sb = supabase as any;

/**
 * Solicitar Demissão — wizard do encarregado (4 passos).
 *
 * O caminho é o mesmo de Solicitar Vaga: o encarregado ESCOLHE o colaborador
 * e o cadastro preenche o resto. Posto, contrato e escala chegam travados de
 * propósito — se dessem para editar, a demissão poderia apontar para um posto
 * que a pessoa não ocupa, e é o operacional que descobriria isso depois.
 *
 * Ao enviar, a solicitação nasce em "Pendente Analista". A tela também
 * lista o que este encarregado já pediu, com o status de cada uma: o pedido
 * era acompanhar do começo ao fim, não só abrir e esperar aviso.
 */

const PASSOS = ["Solicitante e colaborador", "Motivos", "Aviso e documentos", "Conferência"];

const VAZIO = {
  data_solicitacao: hojeISO(),
  motivo_solicitacao: "",
  motivo_pedido: "",
  relato: "",
  termino_experiencia: "",
  data_aviso: "",
  modelo_aviso: "",
  // "Deseja solicitar a substituição desse colaborador?" — "sim" | "nao".
  // Nem toda demissão repõe alguém (redução de quadro, posto que fecha):
  // só o "sim" abre a vaga e prende o pedido a ela (vaga_obrigatoria).
  solicitar_substituicao: "",
  colaborador_telefone: "",
  colaborador_email: "",
};

/** Campo preenchido pelo cadastro: aparece, explica de onde veio e não edita. */
function CampoTravado({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <Label className="flex items-center gap-1.5">
        {label}
        <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
      </Label>
      <div className="mt-1 flex min-h-10 items-center rounded-md border bg-muted/50 px-3 py-2 text-sm">
        {valor || <span className="text-muted-foreground">Escolha o colaborador para preencher</span>}
      </div>
    </div>
  );
}

export default function SolicitarDemissao() {
  const { user } = useAuth();
  const [passo, setPasso] = useState(0);
  const [form, setForm] = useState({ ...VAZIO });
  const [colaborador, setColaborador] = useState<EmpregadoEscolhido | null>(null);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [protocolo, setProtocolo] = useState<number | null>(null);
  const inputArquivos = useRef<HTMLInputElement>(null);

  // DEMISSÃO ↔ VAGA. Toda demissão abre uma vaga de Substituição de quem
  // sai: gravou a demissão, o modal de vaga abre em seguida, já preenchido e
  // travado nela. Fechar sem criar não some com a obrigação — a lista abaixo
  // mostra "falta a vaga" com o botão, e o pedido não anda sem ela.
  const [vagaDe, setVagaDe] = useState<{ demissaoId: number; substituidoId: number; nome: string } | null>(null);
  const [vagaFechadaSemCriar, setVagaFechadaSemCriar] = useState(false);
  const abrirVagaDe = (s: { id: number; colaborador_id: number | null; colaborador_nome: string | null }) => {
    if (!s.colaborador_id) { toast.error("Esta solicitação não tem o colaborador vinculado — abra a vaga por Minhas Solicitações."); return; }
    setVagaFechadaSemCriar(false);
    setVagaDe({ demissaoId: s.id, substituidoId: s.colaborador_id, nome: s.colaborador_nome ?? "" });
  };

  // Veio da vaga de Substituição ("solicite a demissão primeiro"): abre com
  // a pessoa já escolhida.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = Number(params.get("colaborador"));
    if (!id) return;
    (async () => {
      const e = await carregarEmpregadoEscolhido(id);
      if (e) {
        escolherColaborador(e);
        toast.info(`Solicitação de demissão de ${e.nome}. Ao enviar, a vaga de Substituição abre em seguida.`);
      }
      setParams({}, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Quem está pedindo: nome oficial do perfil, não digitado.
  const [solicitante, setSolicitante] = useState({ nome: "", email: "" });
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase.from("profiles")
        .select("display_name, email").eq("id", user.id).maybeSingle();
      setSolicitante({
        nome: data?.display_name ?? user.email ?? "",
        email: data?.email ?? user.email ?? "",
      });
    })();
  }, [user?.id, user?.email]);

  // Contrato do colaborador: é a FILIAL dele, com o código na frente —
  // "1109 - POLICIA CIVIL RS LIMPEZA 066.2026" (EMPREGADOS."Nome Filial",
  // que desde a migration 20260930000089 já vem nesse formato).
  //
  // Três versões desta linha em duas semanas, cada uma errando de um jeito:
  //   1. EMPREGADOS.Filial → CONTRATOS.Filial pegando o primeiro que casasse.
  //      UMA FILIAL TEM MAIS DE UM CONTRATO (a 1093 tem "LIMPEZA HUSM" e
  //      "ADM E ESTAGIARIOS - NH"), então saía "LIMPEZA HUSM" num analista
  //      do administrativo.
  //   2. "Descrição do Local". Só que isso é o POSTO do organograma — a
  //      Vanessa (Polícia Civil) apareceu com contrato "1109 - PALÁCIO DA
  //      POLÍCIA", a colega ao lado com "1109 - DECA", e o RH não achava o
  //      contrato de ninguém.
  //   3. Esta: a filial, que é o que o Senior chama de contrato.
  const [contratos, setContratos] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await sb.from("CONTRATOS")
        .select('id, "NOME CONTRATO", Filial').eq("ATIVO", "SIM");
      setContratos(data ?? []);
    })();
  }, []);
  const nomeContrato = colaborador?.contrato || "";
  // O id só sai quando um contrato ativo da MESMA filial tem o mesmo nome
  // (sem o código — CONTRATOS."NOME CONTRATO" não leva código). Apontar para
  // um id que não corresponde ao nome exibido é pior do que não apontar.
  const contratoDoColaborador = useMemo(() => {
    const alvo = semCodigoFilial(nomeContrato).toUpperCase();
    const filial = colaborador?.filial ?? "";
    if (!alvo || !filial) return null;
    return contratos.find((c: any) =>
      String(c.Filial ?? "").trim() === filial
      && String(c["NOME CONTRATO"] ?? "").trim().toUpperCase() === alvo) ?? null;
  }, [contratos, nomeContrato, colaborador?.filial]);

  // Minhas solicitações, para acompanhar o andamento sem sair da tela.
  const [minhas, setMinhas] = useState<SolicitacaoDemissao[]>([]);
  const carregarMinhas = async (email: string) => {
    if (!email) return;
    const { data } = await sb.from(TABELA)
      .select("*").eq("solicitante_email", email)
      .order("criado_em", { ascending: false }).limit(20);
    setMinhas(data ?? []);
  };
  useEffect(() => { carregarMinhas(solicitante.email); }, [solicitante.email]);

  const setCampo = (campo: keyof typeof VAZIO, valor: string) =>
    setForm((f) => ({ ...f, [campo]: valor }));

  // Escolher a pessoa traz junto o contato do cadastro — o encarregado ainda
  // pode corrigir telefone/e-mail, que é o dado que mais desatualiza.
  const escolherColaborador = (e: EmpregadoEscolhido | null) => {
    setColaborador(e);
    if (e) {
      setForm((f) => ({
        ...f,
        colaborador_telefone: f.colaborador_telefone || mascaraTelefone(e.telefone),
        colaborador_email: f.colaborador_email || e.email,
      }));
    }
  };

  const adicionarArquivos = (lista: FileList | null) => {
    if (!lista?.length) return;
    const novos: File[] = [];
    for (const f of Array.from(lista)) {
      const erro = erroDoArquivo(f);
      if (erro) { toast.error(erro); continue; }
      if (arquivos.some((a) => a.name === f.name && a.size === f.size)) continue;  // mesmo arquivo 2x
      novos.push(f);
    }
    if (novos.length) setArquivos((a) => [...a, ...novos]);
    if (inputArquivos.current) inputArquivos.current.value = "";
  };

  // ── Validação por passo ────────────────────────────────────────────
  // Cada passo diz o que falta ANTES de avançar: descobrir no fim que o
  // telefone estava errado obrigaria a percorrer o formulário todo de novo.
  const faltaNoPasso = (p: number): string | null => {
    if (p === 0) {
      if (!form.data_solicitacao) return "Informe a data da solicitação.";
      if (!solicitante.nome || !solicitante.email) return "Não consegui identificar você. Recarregue a página.";
      if (!colaborador) return "Escolha o colaborador na lista.";
      return null;
    }
    if (p === 1) {
      if (!form.motivo_solicitacao) return "Selecione o motivo da solicitação.";
      if (!form.motivo_pedido) return "Selecione o motivo do pedido de demissão.";
      if (form.relato.trim().length < 20) return "Relate o motivo com pelo menos 20 caracteres.";
      return null;
    }
    if (p === 2) {
      if (!form.termino_experiencia) return "Informe o término de contrato de experiência.";
      if (!form.data_aviso) return "Informe a data do aviso.";
      if (!form.modelo_aviso) return "Selecione o modelo de aviso.";
      if (!telefoneCompleto(form.colaborador_telefone)) return "Informe o telefone do colaborador com DDD.";
      if (!emailValido(form.colaborador_email)) return "Informe um e-mail válido do colaborador.";
      if (!arquivos.length) return "Anexe pelo menos 1 documento.";
      if (!form.solicitar_substituicao) return "Responda se deseja solicitar a substituição do colaborador.";
      return null;
    }
    return null;
  };
  const querSubstituicao = form.solicitar_substituicao === "sim";

  const avancar = () => {
    const falta = faltaNoPasso(passo);
    if (falta) { toast.error(falta); return; }
    setPasso((p) => Math.min(p + 1, PASSOS.length - 1));
  };

  // ── Envio ──────────────────────────────────────────────────────────
  // A solicitação nasce primeiro para os anexos terem um id de verdade no
  // caminho do arquivo. Se algum upload falhar, o pedido é desfeito: uma
  // solicitação de demissão sem documento não serve para o operacional
  // decidir, e ficaria parada na fila sem ninguém entender por quê.
  const enviar = async () => {
    for (let p = 0; p < 3; p++) {
      const falta = faltaNoPasso(p);
      if (falta) { setPasso(p); toast.error(falta); return; }
    }
    setEnviando(true);
    const payload = {
      solicitante_nome: solicitante.nome,
      solicitante_email: solicitante.email,
      data_solicitacao: form.data_solicitacao,
      colaborador_id: colaborador!.id,
      colaborador_nome: colaborador!.nome,
      colaborador_cpf: colaborador!.cpf || null,
      colaborador_posto: colaborador!.posto || null,
      colaborador_cargo: colaborador!.cargo || null,
      colaborador_filial: colaborador!.nomeFilial || colaborador!.filial || null,
      colaborador_admissao: colaborador!.admissao,
      colaborador_telefone: form.colaborador_telefone,
      colaborador_email: form.colaborador_email.trim(),
      contrato: nomeContrato || null,
      contrato_id: contratoDoColaborador?.id ?? null,
      escala: colaborador!.escala || null,
      motivo_solicitacao: form.motivo_solicitacao,
      motivo_pedido: form.motivo_pedido,
      relato: form.relato.trim(),
      termino_experiencia: form.termino_experiencia,
      data_aviso: form.data_aviso,
      modelo_aviso: form.modelo_aviso,
      // Só com "sim" a demissão exige a vaga de Substituição (trigger
      // demissao_exige_vaga). "Não" = redução de quadro: segue sem vaga.
      vaga_obrigatoria: querSubstituicao,
      // Ver a nota igual em MinhasSolicitacoes: a etapa 1 passou para o
      // analista, e o status antigo não cai em fila nenhuma.
      status: "Pendente Analista",
    };

    const { data: criada, error } = await sb.from(TABELA).insert(payload).select("id").single();
    if (error) {
      setEnviando(false);
      toast.error("Erro ao enviar a solicitação: " + error.message);
      return;
    }

    const enviados: string[] = [];
    for (const arquivo of arquivos) {
      const limpo = arquivo.name.replace(/[^\w.\-]+/g, "_");
      const caminho = `${criada.id}/${Date.now()}-${limpo}`;
      const { error: erroUpload } = await supabase.storage.from(BUCKET).upload(caminho, arquivo);
      if (erroUpload) {
        if (enviados.length) await supabase.storage.from(BUCKET).remove(enviados);
        await sb.from(TABELA).delete().eq("id", criada.id);
        setEnviando(false);
        toast.error(`Não consegui enviar "${arquivo.name}": ${erroUpload.message}. Nada foi salvo — tente de novo.`);
        return;
      }
      enviados.push(caminho);
      await sb.from(TABELA_ANEXOS).insert({
        solicitacao_id: criada.id, nome: arquivo.name, storage_path: caminho,
        tamanho: arquivo.size, tipo: arquivo.type || null, enviado_por: solicitante.email,
      });
    }

    setEnviando(false);
    setProtocolo(criada.id);
    carregarMinhas(solicitante.email);
    if (querSubstituicao) {
      toast.success(`Solicitação #${criada.id} enviada. Agora a vaga de reposição.`);
      abrirVagaDe({ id: criada.id, colaborador_id: colaborador!.id, colaborador_nome: colaborador!.nome });
    } else {
      toast.success(`Solicitação #${criada.id} enviada.`);
    }
  };

  const recomecar = () => {
    setProtocolo(null); setPasso(0); setForm({ ...VAZIO });
    setColaborador(null); setArquivos([]);
  };

  // O modal da vaga fica fora do `if (protocolo)`: aparece no recibo E na
  // lista de acompanhamento (para a demissão que ficou sem vaga).
  const modalVaga = (
    <ModalNovaVaga
      aberto={!!vagaDe}
      vinculoDemissao={vagaDe}
      onFechar={() => { setVagaDe(null); setVagaFechadaSemCriar(true); }}
      onCriada={(id) => {
        setVagaFechadaSemCriar(false);
        toast.success(`Vaga #${id} aberta para repor ${vagaDe?.nome ?? "o colaborador"}.`);
        carregarMinhas(solicitante.email);
      }}
      onToast={(msg, tipo) => (tipo === "err" ? toast.error(msg) : toast.success(msg))}
    />
  );
  const demissaoDoRecibo = minhas.find((s) => s.id === protocolo);
  const reciboSemVaga = !!protocolo && (vagaFechadaSemCriar || (demissaoDoRecibo ? faltaVagaDeReposicao(demissaoDoRecibo) : false));

  // ── Recibo ─────────────────────────────────────────────────────────
  if (protocolo) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Solicitar Demissão" module="Encarregados" breadcrumb={["Recursos Humanos", "Solicitar Demissão"]} />
        {modalVaga}
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <h2 className="text-xl font-semibold">Solicitação #{protocolo} enviada</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              O analista vai aprovar ou reprovar. Depois de aprovada, o SST marca o ASO
              demissional e o RH confirma o desligamento. Você acompanha o andamento em
              Minhas Solicitações.
            </p>
            {reciboSemVaga ? (
              <div className="max-w-md rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <b>Falta a vaga de reposição.</b> Você pediu a substituição, então a demissão
                só sai da fila do analista com a vaga de Substituição aberta.
                <div className="mt-2">
                  <Button size="sm" onClick={() => demissaoDoRecibo ? abrirVagaDe(demissaoDoRecibo) : setVagaDe(v => v)}>
                    Solicitar a vaga de Substituição agora
                  </Button>
                </div>
              </div>
            ) : querSubstituicao ? (
              <p className="max-w-md text-sm text-emerald-700">
                A vaga de Substituição foi aberta junto — ela aparece em Minhas Solicitações.
              </p>
            ) : (
              <p className="max-w-md text-sm text-muted-foreground">
                Sem reposição: a demissão segue sozinha, sem vaga de Substituição.
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <Button onClick={recomecar}>Nova solicitação</Button>
              {/* Apontava para ESTA mesma rota: o clique não remontava a tela,
                  o estado de sucesso continuava na frente e nada acontecia.
                  A lista completa (demissão, vaga, férias, advertência) mora
                  em Minhas Solicitações — é para lá que o botão promete ir. */}
              <Button variant="outline" asChild><Link to="/app/encarregados/minhas-solicitacoes">Ver minhas solicitações</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Solicitar Demissão"
        subtitle="Escolha o colaborador e preencha os dados do desligamento. O analista aprova, o SST marca o ASO demissional e o RH confirma."
        module="Encarregados"
        breadcrumb={["Recursos Humanos", "Solicitar Demissão"]}
        actions={<ResumoDeFuncoes fluxo="demissao" />}
      />

      {/* Passos */}
      <div className="mb-4 flex items-center gap-2">
        {PASSOS.map((p, i) => (
          <div key={p} className="flex flex-1 items-center gap-1">
            <div className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
              i < passo ? "bg-emerald-500 text-white"
                : i === passo ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
            )}>
              {i < passo ? "✓" : i + 1}
            </div>
            <span className={cn("hidden truncate text-xs sm:inline",
              i === passo ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {p}
            </span>
            {i < PASSOS.length - 1 && <div className="h-px flex-1 bg-border" />}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{PASSOS[passo]}</CardTitle></CardHeader>
        <CardContent className="space-y-5">

          {/* ── Passo 1: solicitante e colaborador ── */}
          {passo === 0 && (
            <>
              <div>
                <Label htmlFor="data">Data *</Label>
                <Input id="data" type="date" className="mt-1" value={form.data_solicitacao}
                  onChange={(e) => setCampo("data_solicitacao", e.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <CampoTravado label="Nome completo do solicitante (você)" valor={solicitante.nome} />
                <CampoTravado label="E-mail do solicitante (você)" valor={solicitante.email} />
              </div>
              <div>
                <Label>Nome completo do(a) colaborador(a) *</Label>
                <BuscaColaborador valor={colaborador} onEscolher={escolherColaborador} />
                <p className="mt-1 text-xs text-muted-foreground">
                  Escolha na lista. Posto, contrato e escala vêm do cadastro e não podem ser trocados.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <CampoTravado label="Posto do(a) colaborador(a)" valor={colaborador?.posto ?? ""} />
                <CampoTravado label="Contrato" valor={nomeContrato} />
                <CampoTravado label="Escala que trabalha" valor={colaborador?.escala ?? ""} />
                <CampoTravado label="Cargo" valor={colaborador?.cargo ?? ""} />
              </div>
            </>
          )}

          {/* ── Passo 2: motivos ── */}
          {passo === 1 && (
            <>
              <div>
                <Label>Qual motivo da solicitação *</Label>
                <Select value={form.motivo_solicitacao} onValueChange={(v) => setCampo("motivo_solicitacao", v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione o motivo" /></SelectTrigger>
                  <SelectContent>
                    {MOTIVOS_SOLICITACAO.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Qual motivo do pedido de demissão *</Label>
                <Select value={form.motivo_pedido} onValueChange={(v) => setCampo("motivo_pedido", v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione o motivo" /></SelectTrigger>
                  <SelectContent>
                    {MOTIVOS_PEDIDO.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="relato">Relate abaixo o motivo da solicitação de demissão *</Label>
                <Textarea id="relato" className="mt-1 min-h-32" placeholder="Descreva detalhadamente o motivo…"
                  value={form.relato} onChange={(e) => setCampo("relato", e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">
                  {form.relato.trim().length}/20 caracteres mínimos — é o que o Operacional lê para decidir.
                </p>
              </div>
            </>
          )}

          {/* ── Passo 3: aviso e documentos ── */}
          {passo === 2 && (
            <>
              <div>
                <Label>Término de contrato de experiência *</Label>
                <Select value={form.termino_experiencia} onValueChange={(v) => setCampo("termino_experiencia", v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione (se aplicável)" /></SelectTrigger>
                  <SelectContent>
                    {TERMINOS_EXPERIENCIA.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="data_aviso">Data do aviso *</Label>
                  <Input id="data_aviso" type="date" className="mt-1" value={form.data_aviso}
                    onChange={(e) => setCampo("data_aviso", e.target.value)} />
                </div>
                <div>
                  <Label>Qual modelo de aviso *</Label>
                  <Select value={form.modelo_aviso} onValueChange={(v) => setCampo("modelo_aviso", v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione o modelo" /></SelectTrigger>
                    <SelectContent>
                      {MODELOS_AVISO.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="tel">Número de telefone do colaborador *</Label>
                  <Input id="tel" className="mt-1" placeholder="(00) 00000-0000" value={form.colaborador_telefone}
                    onChange={(e) => setCampo("colaborador_telefone", mascaraTelefone(e.target.value))} />
                </div>
                <div>
                  <Label htmlFor="mail">E-mail do colaborador *</Label>
                  <Input id="mail" type="email" className="mt-1" placeholder="exemplo@gmail.com"
                    value={form.colaborador_email} onChange={(e) => setCampo("colaborador_email", e.target.value)} />
                  <p className="mt-1 text-xs text-muted-foreground">Somente e-mails em formato válido são aceitos.</p>
                </div>
              </div>
              <div>
                <Label htmlFor="docs">Anexar documentos *</Label>
                <Input id="docs" ref={inputArquivos} type="file" multiple accept={ACCEPT_ANEXO} className="mt-1"
                  onChange={(e) => adicionarArquivos(e.target.files)} />
                <p className="mt-1 text-xs text-muted-foreground">
                  PDF, JPG, PNG, DOC, DOCX — máx. 10 MB por arquivo — obrigatório anexar ao menos 1 documento.
                </p>
                {arquivos.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {arquivos.map((a, i) => (
                      <li key={`${a.name}-${i}`} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                        <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{a.name}</span>
                        <span className="text-xs text-muted-foreground">{fmtTamanho(a.size)}</span>
                        <Button type="button" variant="ghost" size="sm"
                          onClick={() => setArquivos((lista) => lista.filter((_, j) => j !== i))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Reposição. Nem toda demissão abre vaga — redução de quadro,
                  posto que fecha — então quem pede diz. "Sim" abre a vaga de
                  Substituição logo após o envio e o pedido só anda com ela;
                  "Não" segue sem vaga. */}
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                <Label className="text-sm font-semibold">Deseja solicitar a substituição desse colaborador? *</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Com "Sim", a vaga de Substituição abre logo depois do envio, já preenchida com
                  {colaborador ? ` ${colaborador.nome.split(" ")[0]}` : " o colaborador"} — e a demissão
                  só segue para o analista com a vaga aberta. Com "Não" (redução de quadro, posto que
                  fecha), a demissão segue sozinha.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Button type="button" variant={querSubstituicao ? "default" : "outline"}
                    onClick={() => setCampo("solicitar_substituicao", "sim")}>
                    Sim — abrir a vaga de Substituição
                  </Button>
                  <Button type="button" variant={form.solicitar_substituicao === "nao" ? "default" : "outline"}
                    onClick={() => setCampo("solicitar_substituicao", "nao")}>
                    Não — sem reposição
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* ── Passo 4: conferência ── */}
          {passo === 3 && (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Confira antes de enviar. Depois do envio, quem decide é o Operacional.
              </p>
              <Bloco titulo="Solicitante e colaborador" itens={[
                ["Data", fmtData(form.data_solicitacao)],
                ["Solicitante", solicitante.nome],
                ["E-mail do solicitante", solicitante.email],
                ["Colaborador", colaborador?.nome ?? "—"],
                ["Posto", colaborador?.posto || "—"],
                ["Contrato", nomeContrato || "—"],
                ["Escala", colaborador?.escala || "—"],
                ["Cargo", colaborador?.cargo || "—"],
              ]} />
              <Bloco titulo="Motivos" itens={[
                ["Motivo da solicitação", form.motivo_solicitacao],
                ["Motivo do pedido", form.motivo_pedido],
                ["Relato", form.relato],
              ]} />
              <Bloco titulo="Aviso e contato" itens={[
                ["Término de experiência", form.termino_experiencia],
                ["Data do aviso", fmtData(form.data_aviso)],
                ["Modelo de aviso", form.modelo_aviso],
                ["Telefone", form.colaborador_telefone],
                ["E-mail", form.colaborador_email],
                ["Documentos", `${arquivos.length} arquivo(s)`],
                ["Substituição", querSubstituicao ? "Sim — a vaga abre após o envio" : "Não — sem reposição"],
              ]} />
            </div>
          )}

          {/* Navegação */}
          <div className="flex items-center justify-between gap-2 pt-2">
            <Button type="button" variant="outline" disabled={passo === 0 || enviando}
              onClick={() => setPasso((p) => Math.max(0, p - 1))}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Voltar
            </Button>
            {passo < PASSOS.length - 1 ? (
              <Button type="button" onClick={avancar}>
                Avançar <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button type="button" onClick={enviar} disabled={enviando}>
                {enviando
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</>
                  : <><UserMinus className="mr-2 h-4 w-4" /> Enviar solicitação</>}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {modalVaga}

      {/* Acompanhamento */}
      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Minhas solicitações</CardTitle></CardHeader>
        <CardContent>
          {minhas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Você ainda não abriu nenhuma solicitação de demissão.
            </p>
          ) : (
            <ul className="divide-y">
              {minhas.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-3">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">#{s.id} · {s.colaborador_nome}</span>
                  <span className="text-xs text-muted-foreground">{fmtData(s.criado_em)}</span>
                  <Badge variant="outline" className={cn("ml-auto", corDoStatus(s.status))}>{s.status}</Badge>
                  <p className="w-full text-xs text-muted-foreground">
                    {explicaStatus(s.status)}
                    {s.status === "Reprovada" && s.operacional_motivo ? ` Motivo: ${s.operacional_motivo}` : ""}
                  </p>
                  {s.vaga_id ? (
                    <p className="w-full text-xs text-muted-foreground">🔗 Vaga de Substituição #{s.vaga_id}</p>
                  ) : faltaVagaDeReposicao(s) ? (
                    <div className="flex w-full flex-wrap items-center gap-2 text-xs text-amber-800">
                      <span>⚠ Falta a vaga de reposição — o pedido não sai da fila do analista sem ela.</span>
                      <Button size="sm" variant="outline" className="h-7" onClick={() => abrirVagaDe(s)}>Solicitar vaga</Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Bloco({ titulo, itens }: { titulo: string; itens: [string, string][] }) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-2 text-sm font-semibold">{titulo}</h3>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {itens.map(([rotulo, valor]) => (
          <div key={rotulo} className="min-w-0">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
            <dd className="break-words">{valor || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
