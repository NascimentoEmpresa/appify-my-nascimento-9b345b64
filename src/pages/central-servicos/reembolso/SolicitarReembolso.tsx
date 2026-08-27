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
import { useMeuNome } from "@/hooks/useMeuNome";
import {
  useCriarReembolso, useDecidirReembolso, useMeusStats, useMeuSetor, useReembolsos,
  useTiposReembolso, type DespesaNova,
} from "@/hooks/useReembolso";
import {
  competenciaDe, dataParaISO, descreveJanela, descreveTeto, fmtBRL, normalizaHora,
  podeLancar, tiposDisponiveis, totalEmCentavos, valorEmCentavos,
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
    // O banco recusa de qualquer forma (a trigger levanta excecao), mas deixar
    // a pessoa subir tres comprovantes para so entao descobrir que o cadastro
    // dela nao tem setor seria cruel.
    if (!meuSetor) {
      return toast.error("Seu cadastro nao tem setor, entao nao ha para quem enviar. Peca ao RH para preencher.");
    }
    if (!pix.trim()) return toast.error("Informe o PIX que vai receber o reembolso.");
    if (!dataOk) return toast.error("Data da viagem inválida. Use DD/MM/AAAA.");
    if (!saidaOk || !chegadaOk) return toast.error("Horário de saída ou chegada inválido.");

    const km = Number(String(distancia).replace(",", "."));
    if (!Number.isFinite(km) || km < 0) return toast.error("Distância inválida.");

    const preenchidas = despesas.filter((d) => d.tipo_codigo || d.valor || d.arquivo);
    if (!preenchidas.length) return toast.error("Adicione pelo menos uma despesa.");

    const prontas: DespesaNova[] = [];
    for (const d of preenchidas) {
      const tipo = porCodigo.get(d.tipo_codigo);
      const centavos = valorEmCentavos(d.valor);
      const veredito = podeLancar(tipo, centavos, saidaOk, chegadaOk);
      if (!veredito.ok) return toast.error(veredito.mensagem ?? "Despesa inválida.");
      if (!d.arquivo) {
        return toast.error(`Falta o comprovante de ${tipo?.nome ?? d.tipo_codigo}.`);
      }
      prontas.push({ tipo_codigo: d.tipo_codigo, valor_centavos: centavos!, arquivo: d.arquivo });
    }

    const repetido = prontas.map((p) => p.tipo_codigo)
      .find((c, i, arr) => arr.indexOf(c) !== i);
    if (repetido) {
      return toast.error(`${porCodigo.get(repetido)?.nome ?? repetido} está lançado duas vezes.`);
    }

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
      });
      toast.success(`Solicitação ${criada.numero ?? ""} enviada para aprovação.`);
      limpar();
    } catch (e: any) {
      toast.error(e?.message ?? "Não deu para enviar a solicitação.");
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
                  vem do seu cadastro e define quem aprova este reembolso.
                </span>
              </Card>
            ) : (
              <Card className="mb-4 flex items-start gap-2 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong>Seu cadastro não tem setor definido</strong>, então não há para quem
                  enviar o reembolso. Peça ao RH para preencher o setor no seu cadastro — se você
                  tem mais de um setor no perfil, é preciso deixar só o principal.
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
                                 onChange={(e) => alterarDespesa(i, { valor: e.target.value })} />
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
