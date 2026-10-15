import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import QRCode from "qrcode";
import {
  AlertTriangle, ArrowLeft, ArrowLeftRight, Award, BookOpen, Building2, CalendarDays, ChevronLeft,
  ChevronRight, Clock, Download, GraduationCap, HeartPulse, History, IdCard, Loader2, Palmtree,
  QrCode, ShieldCheck, Shirt, UserCog, UserRound,
} from "lucide-react";
import { FotoCrachaCandidato } from "@/components/recrutamento/AlertaUrgenteAdmissao";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  formatarDuracao, minutosTrabalhadosNoDia, normalizarMarcacoesDoDia,
  temBatidaIncompleta,
} from "@/lib/ponto";
import {
  nivelUtilizavel, useFichaColaborador, useHistoricoColaborador, useMarcacoesDoMes, usePerfilColaborador,
  type EventoHistorico, type FichaColaborador as Ficha, type PerfilExtra,
} from "@/hooks/useEspacoColaborador";

// =====================================================================
// ESPAÇO DO COLABORADOR — a ficha de uma pessoa
//
// Junta num lugar só o que hoje está espalhado por quatro telas: o ponto do
// mês, as advertências, os uniformes/EPI entregues e as trocas de função.
//
// CADA LINHA MOSTRA O ID DA ORIGEM, e isso não é enfeite. A ficha existe
// para responder "o que aconteceu com essa pessoa" — e a resposta só vale
// se der para ir conferir: a bota saiu do pedido MAT-0000123, a advertência
// é a #482. Sem o identificador, a ficha vira resumo sem lastro, e quem
// precisa auditar volta a abrir quatro telas.
//
// O QR CODE DO CRACHÁ
//
// O técnico de segurança do trabalho visita o posto com o celular. Aponta
// para o crachá e cai AQUI, já autenticado com a própria conta (a rota é
// protegida como qualquer outra — o QR não é chave de acesso, é atalho de
// navegação). Por isso o código aponta para a MATRÍCULA, que é o número já
// impresso no crachá hoje, e não para um id interno.
// =====================================================================

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const fmtData = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
};

/** Um valor do jsonb `extra` vira texto legível — data ISO sai formatada. */
const fmtValorExtra = (v: unknown) => {
  const t = String(v);
  return /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(t) ? fmtData(t) : t;
};

export default function FichaColaboradorPagina() {
  return (
    <AcessoGate
      menu="central_servicos_espaco_colaborador"
      acao="visualizar"
      fallback={
        <div className="p-6">
          <PageHeader title="Espaço do Colaborador" module="Central de Serviços" />
          <Card className="p-6 text-sm text-muted-foreground">
            Você não tem acesso ao Espaço do Colaborador. Peça a liberação em
            Administração → Acesso por Usuário.
          </Card>
        </div>
      }
    >
      <Conteudo />
    </AcessoGate>
  );
}

function Conteudo() {
  const { id } = useParams<{ id: string }>();
  const { data: ficha, isLoading, error } = useFichaColaborador(id);

  if (isLoading) {
    return (
      <div className="p-6">
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando a ficha…
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <VoltarParaArvore />
        <Card className="p-6 text-sm text-destructive">
          Não foi possível carregar a ficha: {(error as Error).message}
        </Card>
      </div>
    );
  }

  if (!ficha) {
    return (
      <div className="p-6">
        <VoltarParaArvore />
        <Card className="p-6 text-sm text-muted-foreground">
          Nenhum colaborador encontrado para <strong>{id}</strong>. O endereço aceita a
          matrícula (o número do crachá) ou o ID do cadastro.
        </Card>
      </div>
    );
  }

  return <FichaCarregada ficha={ficha} />;
}

function VoltarParaArvore() {
  return (
    <Link
      to="/app/central-servicos/espaco-colaborador?aba=operacao"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Voltar para a árvore
    </Link>
  );
}

function FichaCarregada({ ficha }: { ficha: Ficha }) {
  return (
    <div className="p-6">
      <VoltarParaArvore />
      <PerfilColaborador ficha={ficha} />
    </div>
  );
}

/**
 * O perfil inteiro de uma pessoa — usado na ficha (/espaco-colaborador/:id) e
 * na aba "Meu perfil", a primeira coisa do Espaço do Colaborador (15/10/2026,
 * Pablo: "ao clicar em espaço do colaborador, vai aparecer o meu perfil.
 * Minha gestão de ponto, meus treinamentos, minhas férias, meus afastamentos,
 * minhas advertências, meus cursos, todo meu histórico completo, o crachá e
 * materiais também"). `proprio` só troca os textos ("Meu…").
 */
export function PerfilColaborador({ ficha, proprio = false }: { ficha: Ficha; proprio?: boolean }) {
  const { data: historico = [], isLoading: carregandoHist } = useHistoricoColaborador(ficha.empregado_id);
  const { data: perfil, isLoading: carregandoPerfil, error: erroPerfil } = usePerfilColaborador(ficha.empregado_id);

  const advertencias = historico.filter((e) => e.origem === "advertencia");
  const materiais = historico.filter((e) => e.origem === "material");
  const trocas = historico.filter((e) => e.origem === "troca_funcao");
  const meu = (m: string, o: string) => (proprio ? m : o);

  return (
    <>
      <PageHeader
        title={proprio ? `Olá, ${ficha.nome.split(" ")[0].charAt(0)}${ficha.nome.split(" ")[0].slice(1).toLowerCase()}` : ficha.nome}
        subtitle={[proprio ? ficha.nome : null, ficha.cargo, ficha.contrato_nome ?? ficha.filial].filter(Boolean).join(" · ")}
        module="Central de Serviços"
        breadcrumb={["Espaço do Colaborador", proprio ? "Meu perfil" : ficha.nome]}
        actions={<BotaoQrCracha ficha={ficha} />}
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Dado rotulo="Matrícula" valor={ficha.matricula ?? "—"} destaque />
          <Dado rotulo="Situação" valor={ficha.situacao ?? "—"} />
          <Dado rotulo="Admissão" valor={fmtData(ficha.admissao)} />
          <Dado rotulo="Escala" valor={ficha.escala ?? "—"} />
          <Dado rotulo="Contrato" valor={ficha.contrato_nome ?? ficha.local ?? "—"} icone={Building2} />
          <Dado rotulo="Posto" valor={ficha.posto ?? "—"} />
          <Dado rotulo="Filial" valor={ficha.filial ?? "—"} />
          {/* EMPREGADOS."LIDER" DEVERIA guardar o nível hierárquico da pessoa,
              mas no banco real ela é "não" ou vazio em 97% das linhas (medido
              em 04/09/2026). Só aparece quando o conteúdo é um nível conhecido. */}
          {nivelUtilizavel(ficha.nivel) && (
            <Dado rotulo="Nível hierárquico" valor={ficha.nivel!} icone={ShieldCheck} />
          )}
          {/* O supervisor DESIGNADO (operacao_designacao); quando ele saiu da
              empresa a ficha diz isso em vez de exibir o nome como se nada
              tivesse acontecido. */}
          <Dado
            rotulo="Supervisor do contrato"
            valor={
              ficha.supervisor_nome
                ? ficha.supervisor_ativo === false
                  ? `${ficha.supervisor_nome} (inativo — redesignar)`
                  : ficha.supervisor_nome
                : "Sem supervisor designado"
            }
            icone={UserCog}
          />
        </div>
      </Card>

      {erroPerfil && (
        <Card className="mb-4 p-3 text-xs text-destructive">
          Parte do perfil não carregou: {(erroPerfil as Error).message}
        </Card>
      )}

      <Tabs defaultValue="ponto">
        {/* `h-auto` + wrap: a TabsList do shadcn tem altura fixa, e a segunda
            fileira de abas caía por cima do conteúdo em telas estreitas. */}
        <TabsList className="mb-4 h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="ponto" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" /> {meu("Minha gestão de ponto", "Ponto do mês")}
          </TabsTrigger>
          <TabsTrigger value="treinamentos" className="gap-1.5">
            <GraduationCap className="h-3.5 w-3.5" /> Treinamentos
            <Contador n={perfil?.treinamentos.length ?? 0} carregando={carregandoPerfil} />
          </TabsTrigger>
          <TabsTrigger value="cursos" className="gap-1.5">
            <BookOpen className="h-3.5 w-3.5" /> Cursos
            <Contador n={perfil?.cursos.length ?? 0} carregando={carregandoPerfil} />
          </TabsTrigger>
          <TabsTrigger value="ferias" className="gap-1.5">
            <Palmtree className="h-3.5 w-3.5" /> Férias
            <Contador n={perfil?.ferias.length ?? 0} carregando={carregandoPerfil} />
          </TabsTrigger>
          <TabsTrigger value="afastamentos" className="gap-1.5">
            <HeartPulse className="h-3.5 w-3.5" /> Afastamentos
          </TabsTrigger>
          <TabsTrigger value="advertencias" className="gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Advertências
            <Contador n={advertencias.length} carregando={carregandoHist} />
          </TabsTrigger>
          <TabsTrigger value="materiais" className="gap-1.5">
            <Shirt className="h-3.5 w-3.5" /> Uniformes e EPI
            <Contador n={materiais.length} carregando={carregandoHist} />
          </TabsTrigger>
          <TabsTrigger value="cracha" className="gap-1.5">
            <IdCard className="h-3.5 w-3.5" /> Crachá
          </TabsTrigger>
          <TabsTrigger value="funcoes" className="gap-1.5">
            <ArrowLeftRight className="h-3.5 w-3.5" /> Funções
            <Contador n={trocas.length} carregando={carregandoHist} />
          </TabsTrigger>
          <TabsTrigger value="historico" className="gap-1.5">
            <History className="h-3.5 w-3.5" /> Histórico completo
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ponto">
          <AbaPonto empregadoId={ficha.empregado_id} />
        </TabsContent>

        <TabsContent value="treinamentos">
          <AbaTreinamentos perfil={perfil} carregando={carregandoPerfil} proprio={proprio} />
        </TabsContent>

        <TabsContent value="cursos">
          <AbaCursos perfil={perfil} carregando={carregandoPerfil} proprio={proprio} />
        </TabsContent>

        <TabsContent value="ferias">
          <AbaFerias perfil={perfil} carregando={carregandoPerfil} proprio={proprio} />
        </TabsContent>

        <TabsContent value="afastamentos">
          <AbaAfastamentos perfil={perfil} carregando={carregandoPerfil} />
        </TabsContent>

        <TabsContent value="advertencias">
          <ListaEventos
            eventos={advertencias}
            carregando={carregandoHist}
            vazio={meu("Nenhuma advertência registrada para você.", "Nenhuma advertência registrada para este colaborador.")}
            rotuloId="Advertência"
          />
        </TabsContent>

        <TabsContent value="materiais">
          <ListaEventos
            eventos={materiais}
            carregando={carregandoHist}
            vazio={meu("Nenhum pedido de uniforme ou EPI em seu nome.", "Nenhuma solicitação de uniforme ou EPI vinculada a este colaborador.")}
            rotuloId="Pedido"
          />
        </TabsContent>

        <TabsContent value="cracha">
          <AbaCracha ficha={ficha} perfil={perfil} carregando={carregandoPerfil} />
        </TabsContent>

        <TabsContent value="funcoes">
          <ListaEventos
            eventos={trocas}
            carregando={carregandoHist}
            vazio="Nenhuma troca de função registrada. A função atual está no cabeçalho."
            rotuloId="Troca de função"
          />
        </TabsContent>

        <TabsContent value="historico">
          <AbaHistorico ficha={ficha} historico={historico} perfil={perfil} carregando={carregandoHist || carregandoPerfil} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function Contador({ n, carregando }: { n: number; carregando: boolean }) {
  if (carregando) return <Loader2 className="h-3 w-3 animate-spin" />;
  if (n === 0) return null;
  return <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{n}</Badge>;
}

function Dado({
  rotulo, valor, destaque, icone: Icone,
}: {
  rotulo: string; valor: string; destaque?: boolean; icone?: typeof Building2;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {Icone && <Icone className="h-3 w-3" />}
        {rotulo}
      </p>
      <p className={cn("truncate text-sm", destaque ? "font-semibold" : "font-medium")} title={valor}>
        {valor}
      </p>
    </div>
  );
}

// ── Aba: ponto do mês ────────────────────────────────────────────────

function AbaPonto({ empregadoId }: { empregadoId: number }) {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);

  const { data, isLoading } = useMarcacoesDoMes(empregadoId, ano, mes);

  const andarMes = (passo: number) => {
    const d = new Date(ano, mes - 1 + passo, 1);
    setAno(d.getFullYear());
    setMes(d.getMonth() + 1);
  };

  // As batidas chegam uma por linha; o dia é a unidade que se lê. Agrupar
  // aqui (e não no banco) mantém a RPC devolvendo o dado cru e a regra de
  // conversão num só lugar — src/lib/ponto.ts, que tem teste.
  const dias = useMemo(() => {
    const porDia = new Map<string, unknown[]>();
    for (const l of data?.linhas ?? []) {
      if (!l?.data) continue;
      if (!porDia.has(l.data)) porDia.set(l.data, []);
      porDia.get(l.data)!.push(l.minutos);
    }
    return [...porDia.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([data, minutos]) => ({
        data,
        batidas: normalizarMarcacoesDoDia(minutos),
        trabalhado: minutosTrabalhadosNoDia(minutos),
        incompleto: temBatidaIncompleta(minutos),
      }));
  }, [data]);

  const totalBatidas = dias.reduce((s, d) => s + d.batidas.length, 0);
  const totalTrabalhado = dias.reduce((s, d) => s + d.trabalhado, 0);

  return (
    <Card className="p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => andarMes(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[10rem] text-center text-sm font-semibold capitalize">
          {MESES[mes - 1]} de {ano}
        </span>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => andarMes(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span><strong className="text-foreground">{totalBatidas}</strong> batidas</span>
          <span><strong className="text-foreground">{dias.length}</strong> dias com registro</span>
          <span>Total <strong className="text-foreground">{formatarDuracao(totalTrabalhado)}</strong></span>
        </div>
      </div>

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lendo o relógio de ponto…
        </p>
      ) : !data?.disponivel ? (
        // Espelho ausente não é erro de quem está olhando a tela — é estado
        // conhecido do sistema, e a tela diz qual é.
        <div className="rounded-lg border border-dashed p-6 text-center">
          <Clock className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">Ponto indisponível</p>
          <p className="mx-auto mt-1 max-w-lg text-xs text-muted-foreground">
            {data?.motivo ?? "Não foi possível ler as marcações."}
          </p>
          <p className="mx-auto mt-2 max-w-lg text-xs text-muted-foreground">
            As batidas vêm do espelho do relógio de ponto (<code>espelho.BiMarcacoes</code>),
            alimentado pelo <code>espelho-mysql/</code>. Assim que a sincronização rodar, esta
            aba passa a mostrar os dados sem nenhuma alteração de código.
          </p>
        </div>
      ) : dias.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma batida registrada em {MESES[mes - 1]} de {ano}.
        </p>
      ) : (
        <>
          {/* CELULAR: um cartão por dia.
              A tabela de quatro colunas abaixo é ótima para conferir o mês
              inteiro numa tela larga e é ILEGÍVEL em 390px — as batidas
              quebram numa pilha vertical e a coluna "Trabalhado" sai da tela.
              E este não é um caso de borda: o QR Code do crachá desemboca
              nesta aba, no celular do técnico de segurança, em pé no posto.
              É a leitura mobile mais importante do sistema. */}
          <div className="space-y-2 sm:hidden">
            {dias.map((d) => (
              <div
                key={d.data}
                className={cn("rounded-lg border p-3", d.incompleto && "border-amber-500/40 bg-amber-500/5")}
              >
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="font-medium">{fmtData(d.data)}</span>
                  <span className="text-sm font-semibold">{formatarDuracao(d.trabalhado)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {d.batidas.map((b, i) => (
                    <span
                      key={i}
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
                      title={b.hora12}
                    >
                      {b.hora24}
                    </span>
                  ))}
                </div>
                {d.incompleto && (
                  <p className="mt-1.5 text-[11px] text-amber-600">
                    Número ímpar de batidas — falta uma saída.
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* TELA LARGA: a tabela, com as duas notações lado a lado. */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Dia</th>
                  <th className="py-2 pr-4 font-medium">Batidas (24h)</th>
                  <th className="hidden py-2 pr-4 font-medium lg:table-cell">Batidas (AM/PM)</th>
                  <th className="py-2 pr-4 text-right font-medium">Trabalhado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {dias.map((d) => (
                  <tr key={d.data} className={cn(d.incompleto && "bg-amber-500/5")}>
                    <td className="whitespace-nowrap py-2 pr-4 font-medium">
                      {fmtData(d.data)}
                      {d.incompleto && (
                        <Badge variant="outline" className="ml-2 border-amber-500/40 text-amber-600">
                          batida ímpar
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {d.batidas.map((b) => b.hora24).join("  ·  ")}
                    </td>
                    <td className="hidden py-2 pr-4 text-xs text-muted-foreground lg:table-cell">
                      {d.batidas.map((b) => b.hora12).join("  ·  ")}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right font-medium">
                      {formatarDuracao(d.trabalhado)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-muted-foreground">
            O relógio grava o minuto do dia (420 = 07:00). A conversão e a soma das horas
            ficam em <code>src/lib/ponto.ts</code>. Dia com número ímpar de batidas fica
            marcado: falta uma saída, e nenhuma hora é estimada por conta disso.
          </p>
        </>
      )}
    </Card>
  );
}

// ── Abas de histórico ────────────────────────────────────────────────

function ListaEventos({
  eventos, carregando, vazio, rotuloId,
}: {
  eventos: EventoHistorico[]; carregando: boolean; vazio: string; rotuloId: string;
}) {
  if (carregando) {
    return (
      <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </Card>
    );
  }

  if (eventos.length === 0) {
    return <Card className="p-6 text-sm text-muted-foreground">{vazio}</Card>;
  }

  return (
    <div className="space-y-3">
      {eventos.map((e) => (
        <Card key={`${e.origem}:${e.origem_id}`} className="p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-medium">{e.titulo ?? "—"}</span>
            {e.status && <Badge variant="secondary">{e.status}</Badge>}
            <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              {fmtData(e.data_ref)}
            </span>
          </div>

          {e.detalhe && (
            <p className="mb-2 whitespace-pre-wrap text-sm text-muted-foreground">{e.detalhe}</p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {/* O identificador é o ponto da ficha: sem ele não dá para ir
                conferir a origem, e a linha vira afirmação sem lastro. */}
            <span className="font-mono">
              {rotuloId} <strong className="text-foreground">#{e.protocolo ?? e.origem_id}</strong>
            </span>
            {Object.entries(e.extra ?? {})
              .filter(([chave, v]) =>
                chave !== "itens" && v !== null && v !== undefined && String(v).trim() !== "")
              .map(([chave, v]) => (
                <span key={chave}>
                  {chave.replace(/_/g, " ")}: <span className="text-foreground">{fmtValorExtra(v)}</span>
                </span>
              ))}
          </div>

          {Array.isArray(e.extra?.itens) && e.extra!.itens.length > 0 && (
            <ul className="mt-3 space-y-1 border-t pt-3 text-xs">
              {e.extra!.itens!.map((i) => (
                <li key={i.id} className="flex items-center gap-2">
                  <Shirt className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{i.quantidade}×</span>
                  <span className="truncate">{i.nome}</span>
                  {i.tamanho && <Badge variant="outline" className="h-4 px-1.5 text-[10px]">{i.tamanho}</Badge>}
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                    item {i.id}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

// ── QR Code do crachá ────────────────────────────────────────────────

function BotaoQrCracha({ ficha }: { ficha: Ficha }) {
  const [aberto, setAberto] = useState(false);
  const [png, setPng] = useState("");

  // A URL é absoluta de propósito: o QR é lido por um celular, que não tem
  // como resolver caminho relativo. `window.location.origin` faz o código
  // gerado em homologação apontar para homologação, e o de produção para
  // produção — um domínio fixo aqui imprimiria crachá errado no dia do teste.
  const url = useMemo(() => {
    const ref = ficha.matricula || String(ficha.empregado_id);
    return `${window.location.origin}/app/central-servicos/espaco-colaborador/${encodeURIComponent(ref)}`;
  }, [ficha]);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    QRCode.toDataURL(url, { width: 512, margin: 2, errorCorrectionLevel: "M" })
      .then((d) => { if (vivo) setPng(d); })
      .catch(() => { if (vivo) setPng(""); });
    return () => { vivo = false; };
  }, [aberto, url]);

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAberto(true)}>
        <QrCode className="h-4 w-4" /> QR do crachá
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-sm">
          <DialogTitle>QR Code do crachá</DialogTitle>
          <DialogDescription>
            Imprima no crachá de {ficha.nome}. Quem escanear cai nesta ficha já autenticado
            com a própria conta — o QR é atalho de navegação, não chave de acesso.
          </DialogDescription>

          <div className="flex flex-col items-center gap-3 py-2">
            {png ? (
              <img src={png} alt={`QR Code de ${ficha.nome}`} className="h-52 w-52 rounded border bg-white p-2" />
            ) : (
              <div className="flex h-52 w-52 items-center justify-center rounded border">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            <code className="break-all text-center text-[10px] text-muted-foreground">{url}</code>
            {png && (
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <a href={png} download={`cracha-${ficha.matricula || ficha.empregado_id}.png`}>
                  <Download className="h-4 w-4" /> Baixar PNG
                </a>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Abas do perfil (15/10/2026, mig 20261015000001) ───────────────────

function Carregando() {
  return (
    <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
    </Card>
  );
}

function AbaTreinamentos({ perfil, carregando, proprio }: { perfil?: PerfilExtra | null; carregando: boolean; proprio: boolean }) {
  if (carregando) return <Carregando />;
  if (!perfil?.tem_login) {
    return <Card className="p-6 text-sm text-muted-foreground">Os treinamentos do ERP ficam no login — {proprio ? "seu cadastro" : "este cadastro"} ainda não tem login vinculado.</Card>;
  }
  const lista = perfil.treinamentos;
  if (!lista.length) return <Card className="p-6 text-sm text-muted-foreground">{proprio ? "Você ainda não fez" : "Nenhum"} treinamento do ERP{proprio ? "" : " feito"}. Eles ficam em Treinamentos.</Card>;
  const feitos = lista.filter((t) => t.concluido_em).length;
  return (
    <Card className="p-4">
      <p className="mb-3 text-xs text-muted-foreground"><strong className="text-foreground">{feitos}</strong> concluído(s) · {lista.length - feitos} só assistido(s)</p>
      <div className="divide-y">
        {lista.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-2 py-2.5">
            <GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={t.titulo}>{t.titulo}</span>
            {t.concluido_em ? (
              <Badge variant="outline" className={cn(t.aprovado === false ? "border-red-300 text-red-700" : "border-emerald-300 text-emerald-700")}>
                {t.aprovado === false ? "Reprovado" : "Concluído"}{t.nota != null ? ` · nota ${t.nota}` : ""}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-300 text-amber-700">Assistido, sem conclusão</Badge>
            )}
            <span className="w-24 text-right text-xs text-muted-foreground">{fmtData(t.concluido_em ?? t.visto_em)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AbaCursos({ perfil, carregando, proprio }: { perfil?: PerfilExtra | null; carregando: boolean; proprio: boolean }) {
  if (carregando) return <Carregando />;
  const lista = perfil?.cursos ?? [];
  if (!lista.length) return <Card className="p-6 text-sm text-muted-foreground">{proprio ? "Você não está matriculado(a) em" : "Nenhuma matrícula em"} curso do Portal de Treinamentos.</Card>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {lista.map((c) => {
        const pct = c.aulas ? Math.round((c.concluidas / c.aulas) * 100) : 0;
        return (
          <Card key={c.curso_id} className="p-4">
            <div className="mb-2 flex items-start gap-2">
              <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm font-semibold">{c.curso}</span>
              {c.certificado_em && <Badge variant="outline" className="border-emerald-300 text-emerald-700"><Award className="mr-1 h-3 w-3" /> Certificado</Badge>}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-primary")} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {c.concluidas} de {c.aulas} aula(s) · {pct}% · inscrito em {fmtData(c.inscrito_em)}
              {c.certificado_em ? ` · certificado em ${fmtData(c.certificado_em)}${c.certificado_codigo ? ` (código ${c.certificado_codigo})` : ""}` : ""}
            </p>
          </Card>
        );
      })}
    </div>
  );
}

function AbaFerias({ perfil, carregando, proprio }: { perfil?: PerfilExtra | null; carregando: boolean; proprio: boolean }) {
  if (carregando) return <Carregando />;
  const lista = perfil?.ferias ?? [];
  const saldo = perfil?.ferias_saldo;
  return (
    <div className="space-y-3">
      {saldo && (
        <Card className="grid gap-3 p-4 sm:grid-cols-3">
          <Dado rotulo="Pode tirar (próximas férias)" valor={`${saldo.pode_tirar} dias`} destaque />
          <Dado rotulo="Pode vender sem tirar" valor={`${saldo.pode_vender} dias`} />
          <Dado rotulo="Vendidos nos últimos 12 meses" valor={`${saldo.vendidos_12m} dias`} />
        </Card>
      )}
      {!lista.length ? (
        <Card className="p-6 text-sm text-muted-foreground">Nenhuma solicitação de férias {proprio ? "em seu nome" : "para este colaborador"}.</Card>
      ) : (
        <Card className="divide-y p-0">
          {lista.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <Palmtree className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">
                {f.tipo === "venda"
                  ? `Venda de ${f.dias_vendidos ?? 0} dia(s), sem tirar`
                  : `${fmtData(f.data_saida)} a ${fmtData(f.data_retorno)} · ${f.dias_ferias ?? 0} dias${f.dias_vendidos ? ` + ${f.dias_vendidos} vendidos` : ""}`}
              </span>
              {f.status && <Badge variant="secondary">{f.status}</Badge>}
              <span className="ml-auto font-mono text-xs text-muted-foreground">#{f.id} · pedida em {fmtData(f.criado_em)}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function AbaAfastamentos({ perfil, carregando }: { perfil?: PerfilExtra | null; carregando: boolean }) {
  if (carregando) return <Carregando />;
  const a = perfil?.afastamento;
  // "Trabalhando" (código 1) vem com data 31/12/1900 da Senior — não é afastamento.
  const afastado = !!a && a.codigo != null && a.codigo !== 1;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <HeartPulse className={cn("h-5 w-5", afastado ? "text-amber-600" : "text-emerald-600")} />
        <div>
          <p className="text-sm font-semibold">{afastado ? (a!.descricao ?? `Situação ${a!.codigo}`) : "Sem afastamento hoje"}</p>
          <p className="text-xs text-muted-foreground">
            {afastado
              ? `Desde ${fmtData(a!.desde)}${a!.tipo && a!.tipo !== a!.descricao ? ` · ${a!.tipo}` : ""}`
              : `Situação na Senior: ${a?.descricao ?? perfil?.situacao_erp ?? "—"}`}
          </p>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Mostra a situação de hoje na Senior (atestado, férias, licença…). O histórico de afastamentos anteriores
        fica numa tabela da Senior que ainda não vem para o ERP.
      </p>
    </Card>
  );
}

function AbaCracha({ ficha, perfil, carregando }: { ficha: Ficha; perfil?: PerfilExtra | null; carregando: boolean }) {
  const [png, setPng] = useState("");
  const url = useMemo(() => {
    const ref = ficha.matricula || String(ficha.empregado_id);
    return `${window.location.origin}/app/central-servicos/espaco-colaborador/${encodeURIComponent(ref)}`;
  }, [ficha]);
  useEffect(() => {
    let vivo = true;
    QRCode.toDataURL(url, { width: 320, margin: 1, errorCorrectionLevel: "M" })
      .then((d) => { if (vivo) setPng(d); }).catch(() => { if (vivo) setPng(""); });
    return () => { vivo = false; };
  }, [url]);
  if (carregando) return <Carregando />;
  return (
    <div className="flex flex-wrap items-start gap-6">
      {/* O crachá como ele é: foto, nome, função, matrícula e o QR que abre esta ficha. */}
      <Card className="w-[260px] overflow-hidden p-0 shadow-md">
        <div className="bg-primary px-4 py-2 text-center text-xs font-bold uppercase tracking-wider text-primary-foreground">Grupo Nascimento</div>
        <div className="flex flex-col items-center gap-2 p-4 text-center">
          {perfil?.cracha_foto_path
            ? <FotoCrachaCandidato caminho={perfil.cracha_foto_path} tamanho={112} />
            : <div className="flex h-[140px] w-[112px] items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">Sem foto</div>}
          <p className="text-sm font-bold leading-tight">{ficha.nome}</p>
          <p className="text-xs text-muted-foreground">{ficha.cargo ?? "—"}</p>
          <p className="font-mono text-xs">Matrícula <strong>{ficha.matricula ?? "—"}</strong></p>
          {png ? <img src={png} alt="QR do crachá" className="mt-1 h-28 w-28" /> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        </div>
      </Card>
      <div className="min-w-[220px] flex-1 space-y-2 text-sm">
        <p className="font-semibold">Foto do crachá</p>
        <p className="text-muted-foreground">
          {perfil?.cracha_foto_path
            ? `Veio ${perfil.cracha_foto_origem === "recrutamento" ? "do Recrutamento, na admissão" : `do ${perfil.cracha_foto_origem}`}.`
            : "Nenhuma foto de crachá registrada. Na admissão, o Recrutamento anexa a foto ao mandar para SST + Compras."}
        </p>
        <p className="font-semibold">QR Code</p>
        <p className="text-muted-foreground">Quem escanear cai nesta ficha, já com o próprio login — o QR é atalho, não chave de acesso.</p>
        {png && (
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href={png} download={`cracha-${ficha.matricula || ficha.empregado_id}.png`}><Download className="h-4 w-4" /> Baixar QR</a>
          </Button>
        )}
      </div>
    </div>
  );
}

/** Tudo numa linha do tempo: admissão, ponto não (é diário), férias, treinamentos, cursos, advertências, materiais, funções. */
function AbaHistorico({ ficha, historico, perfil, carregando }: {
  ficha: Ficha; historico: EventoHistorico[]; perfil?: PerfilExtra | null; carregando: boolean;
}) {
  if (carregando) return <Carregando />;
  type Item = { chave: string; data: string | null; icone: typeof Clock; titulo: string; detalhe?: string | null; status?: string | null; cor: string };
  const itens: Item[] = [];
  const ROTULO: Record<string, [typeof Clock, string, string]> = {
    advertencia: [AlertTriangle, "Advertência", "text-red-600"],
    material: [Shirt, "Uniformes / EPI", "text-orange-600"],
    troca_funcao: [ArrowLeftRight, "Troca de função", "text-violet-600"],
  };
  for (const e of historico) {
    const [ic, rot, cor] = ROTULO[e.origem] ?? [CalendarDays, e.origem, "text-muted-foreground"];
    itens.push({ chave: `${e.origem}:${e.origem_id}`, data: e.data_ref, icone: ic, titulo: `${rot} — ${e.titulo ?? ""} #${e.protocolo ?? e.origem_id}`, detalhe: e.detalhe, status: e.status, cor });
  }
  for (const f of perfil?.ferias ?? []) {
    itens.push({ chave: `f:${f.id}`, data: f.criado_em, icone: Palmtree, cor: "text-sky-600", status: f.status,
      titulo: f.tipo === "venda" ? `Venda de ${f.dias_vendidos ?? 0} dia(s) de férias #${f.id}` : `Férias ${fmtData(f.data_saida)} a ${fmtData(f.data_retorno)} #${f.id}` });
  }
  for (const t of perfil?.treinamentos ?? []) {
    if (t.concluido_em) itens.push({ chave: `t:${t.id}`, data: t.concluido_em, icone: GraduationCap, cor: "text-emerald-600", titulo: `Treinamento concluído — ${t.titulo}`, status: t.aprovado === false ? "Reprovado" : null });
  }
  for (const c of perfil?.cursos ?? []) {
    itens.push({ chave: `c:${c.curso_id}`, data: c.inscrito_em, icone: BookOpen, cor: "text-indigo-600", titulo: `Inscrito no curso ${c.curso}` });
    if (c.certificado_em) itens.push({ chave: `cc:${c.curso_id}`, data: c.certificado_em, icone: Award, cor: "text-emerald-600", titulo: `Certificado — ${c.curso}` });
  }
  for (const a of perfil?.admissao ?? []) {
    itens.push({ chave: `a:${a.candidato_id}`, data: a.candidatura_em, icone: UserRound, cor: "text-primary", titulo: `Candidatura${a.cargo ? ` — ${a.cargo}` : ""}${a.vaga_id ? ` (vaga #${a.vaga_id})` : ""}`, detalhe: a.contrato });
  }
  if (ficha.admissao) itens.push({ chave: "adm", data: ficha.admissao, icone: Building2, cor: "text-primary", titulo: `Admissão${ficha.cargo ? ` — ${ficha.cargo}` : ""}` });
  itens.sort((x, y) => String(y.data ?? "").localeCompare(String(x.data ?? "")));
  if (!itens.length) return <Card className="p-6 text-sm text-muted-foreground">Nada registrado ainda.</Card>;
  return (
    <Card className="p-4">
      <ol className="relative space-y-4 border-l pl-5">
        {itens.map((i) => {
          const Ic = i.icone;
          return (
            <li key={i.chave} className="relative">
              <span className="absolute -left-[29px] flex h-6 w-6 items-center justify-center rounded-full border bg-background">
                <Ic className={cn("h-3.5 w-3.5", i.cor)} />
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{i.titulo}</span>
                {i.status && <Badge variant="secondary">{i.status}</Badge>}
                <span className="ml-auto text-xs text-muted-foreground">{fmtData(i.data)}</span>
              </div>
              {i.detalhe && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{i.detalhe}</p>}
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-[11px] text-muted-foreground">O ponto do dia a dia fica na aba de ponto; aqui entram os acontecimentos.</p>
    </Card>
  );
}
