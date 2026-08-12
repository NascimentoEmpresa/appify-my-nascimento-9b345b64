import { useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Car } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { useAuth } from "@/hooks/useAuth";
import {
  conflitoNaAgenda,
  disponibilidadeDoVeiculo,
  hojeISO,
  useAgendamentos,
  useContratosParaAgendamento,
  useCriarAgendamento,
  useFrota,
  type ContratoOpcao,
  type Turno,
  type VeiculoFrota,
} from "@/hooks/useAgendamentoVeiculos";
import { CardVeiculo } from "./componentes/CardVeiculo";
import { CalendarioGeral } from "./componentes/CalendarioGeral";
import { ComoUsarDialog } from "./componentes/ComoUsarDialog";
import { MeusAgendamentos } from "./componentes/MeusAgendamentos";
import { Passos, type IndicePasso } from "./componentes/Passos";
import { PassoConfirmar } from "./componentes/PassoConfirmar";
import { PassoContratos } from "./componentes/PassoContratos";
import { PassoDataTurno } from "./componentes/PassoDataTurno";
import { PainelFrota } from "./componentes/PainelFrota";
import { ProximosAgendamentos } from "./componentes/ProximosAgendamentos";
import { StatusRapido } from "./componentes/StatusRapido";

/**
 * Função e não constante: com a aba aberta desde ontem, uma data congelada no
 * carregamento do módulo já nasceria no passado e o banco recusaria a reserva.
 */
const rascunhoInicial = () => ({
  veiculo: null as VeiculoFrota | null,
  dataInicio: hojeISO(),
  dataFim: hojeISO(),
  turno: "dia_todo" as Turno,
  contratos: [] as string[],
  destino: "",
  motivo: "",
  observacoes: "",
});
type Rascunho = ReturnType<typeof rascunhoInicial>;

/**
 * Agendamento de Veículos — Central de Serviços.
 *
 * A frota vem do módulo de Patrimônio (`sup_patrimonio`) e é SÓ LIDA: quem
 * marca um carro como em manutenção é o pessoal do Patrimônio, e esta tela
 * apenas obedece. Ver o cabeçalho da migration
 * 20260828000001_central_servicos_agendamento_veiculos.sql.
 */
export default function AgendamentoVeiculos() {
  const { user } = useAuth();
  const { data: access } = useAccessibleMenus("visualizar");

  const frota = useFrota();
  const agenda = useAgendamentos();
  // Inativos só entram quando a pessoa pede (são 141 contra 58 ativos).
  const [incluirInativos, setIncluirInativos] = useState(false);
  const contratos = useContratosParaAgendamento(incluirInativos);
  const criar = useCriarAgendamento();

  const [passo, setPasso] = useState<IndicePasso>(0);
  const [maximo, setMaximo] = useState<IndicePasso>(0);
  const [rascunho, setRascunho] = useState<Rascunho>(rascunhoInicial);

  const agendamentos = agenda.data ?? [];
  const listaFrota = frota.data ?? [];
  // Quem gerencia a frota é quem administra Suprimentos › Patrimônio — não
  // existe permissão própria aqui de propósito: dois lugares respondendo a
  // mesma pergunta sempre acabam discordando. Mesmo gate da RLS.
  const podeGerirFrota = !!access?.codes.has("sup_patrimonio");

  const irPara = (p: IndicePasso) => {
    setPasso(p);
    setMaximo((m) => (p > m ? p : m));
  };

  const mudar = (v: Partial<Rascunho>) => setRascunho((r) => ({ ...r, ...v }));

  const escolherVeiculo = (v: VeiculoFrota) => {
    mudar({ veiculo: v });
    irPara(1);
  };

  // A lista muda quando a flag de inativos vira, mas a seleção fica. Se
  // alguém marca um contrato inativo e depois desmarca a flag, o item sai da
  // lista — e resolvendo pela lista atual o nome e o código dele se perderiam
  // na hora de salvar. Então guardamos tudo que já passou pela tela.
  const vistos = useRef(new Map<string, ContratoOpcao>());
  contratos.data?.forEach((c) => vistos.current.set(c.id, c));

  // Contrato marcado que saiu da lista (inativo, flag desligada depois) segue
  // aparecendo: marcado num lugar onde não dá para desmarcar seria pior do que
  // não aparecer. Entra logo depois do ADMINISTRATIVO, que fica sempre no topo.
  const contratosVisiveis = useMemo(() => {
    const lista = contratos.data ?? [];
    const naLista = new Set(lista.map((c) => c.id));
    const ocultos = rascunho.contratos
      .filter((id) => !naLista.has(id))
      .map((id) => vistos.current.get(id))
      .filter((c): c is ContratoOpcao => !!c);
    if (!ocultos.length) return lista;
    const [primeiro, ...resto] = lista;
    return primeiro?.administrativo ? [primeiro, ...ocultos, ...resto] : [...ocultos, ...lista];
  }, [contratos.data, rascunho.contratos]);

  // Resolve pela lista visível, que já traz junto o que estava selecionado e
  // saiu da lista — assim nome e código sobrevivem ao liga-desliga da flag.
  const acharContrato = (id: string) => contratosVisiveis.find((c) => c.id === id);

  const nomesDosContratos = useMemo(
    () =>
      rascunho.contratos
        .map((id) => contratosVisiveis.find((c) => c.id === id)?.nome)
        .filter((n): n is string => !!n),
    [rascunho.contratos, contratosVisiveis],
  );

  // Cada passo só libera o próximo quando está de fato resolvido.
  const podeAvancar = (() => {
    const { veiculo, dataInicio, dataFim, turno, contratos: ctr } = rascunho;
    if (passo === 0) return !!veiculo;
    if (passo === 1) {
      if (!veiculo || !dataInicio || !dataFim || dataFim < dataInicio) return false;
      if (!disponibilidadeDoVeiculo(veiculo, dataInicio).disponivel) return false;
      return !conflitoNaAgenda(agendamentos, veiculo.id, dataInicio, dataFim, turno);
    }
    if (passo === 2) return ctr.length > 0;
    return true;
  })();

  const confirmar = async () => {
    if (!rascunho.veiculo) return;
    try {
      await criar.mutateAsync({
        veiculo: rascunho.veiculo,
        data_inicio: rascunho.dataInicio,
        data_fim: rascunho.dataFim,
        turno: rascunho.turno,
        destino: rascunho.destino,
        motivo: rascunho.motivo,
        observacoes: rascunho.observacoes,
        contratos: rascunho.contratos.map((id) => {
          const c = acharContrato(id);
          return {
            codigo: c?.codigo ?? null,
            nome: c?.nome ?? "Contrato",
            administrativo: !!c?.administrativo,
          };
        }),
      });
      setRascunho(rascunhoInicial());
      setPasso(0);
      setMaximo(0);
    } catch {
      // A mutation já mostrou o toast com a mensagem do banco; o rascunho
      // fica de pé para o usuário corrigir a data e tentar de novo.
    }
  };

  const atualizar = () => { frota.refetch(); agenda.refetch(); };

  return (
    <div>
      <PageHeader
        title="Agendamento de Veículos"
        subtitle="Reserve um carro da frota, veja quem está com cada veículo e quais estão na oficina."
        module="Central de Serviços"
        breadcrumb={["Agendamento de Veículos"]}
        // Sem atalho para o Patrimônio: quem gerencia a frota vai direto na
        // aba de Patrimônio, a pedido. Esta tela só agenda.
        actions={<ComoUsarDialog />}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Tabs defaultValue="novo">
          <TabsList className="mb-4">
            <TabsTrigger value="novo">Novo Agendamento</TabsTrigger>
            <TabsTrigger value="meus">Meus Agendamentos</TabsTrigger>
            {/* Só quem administra o Patrimônio mexe em reserva alheia — para
                os demais a aba nem existe, em vez de existir e negar a ação
                depois. */}
            {podeGerirFrota && <TabsTrigger value="frota">Toda a Frota</TabsTrigger>}
            <TabsTrigger value="calendario">Calendário Geral</TabsTrigger>
          </TabsList>

          <TabsContent value="novo">
            <Card className="p-5">
              <Passos atual={passo} maximoAlcancado={maximo} onIr={irPara} />
              <div className="mt-6">
                {passo === 0 && (
                  <div className="animate-fade-in space-y-4">
                    <div>
                      <h3 className="text-lg font-bold text-foreground">Selecione o Veículo</h3>
                      <p className="text-sm text-muted-foreground">Clique no veículo que deseja reservar.</p>
                    </div>

                    {frota.isLoading && (
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                          <Skeleton key={i} className="h-44 rounded-2xl" />
                        ))}
                      </div>
                    )}

                    {frota.isError && (
                      <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                        Não foi possível carregar a frota. Verifique se o seu perfil tem acesso a
                        Agendamento de Veículos.
                      </p>
                    )}

                    {!frota.isLoading && !frota.isError && listaFrota.length === 0 && (
                      // Desde a 20260828000007 a frota é do grupo inteiro, sem
                      // filtro por empresa: chegar aqui significa mesmo que não
                      // há veículo ativo cadastrado.
                      <div className="rounded-xl border border-dashed border-border p-10 text-center">
                        <Car className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
                        <p className="font-medium text-foreground">Nenhum veículo cadastrado</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          A frota vem do módulo de Patrimônio — cadastre os veículos por lá.
                        </p>
                      </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {listaFrota.map((v, i) => (
                        <CardVeiculo
                          key={v.id}
                          veiculo={v}
                          indice={i}
                          disponibilidade={disponibilidadeDoVeiculo(v, rascunho.dataInicio)}
                          selecionado={rascunho.veiculo?.id === v.id}
                          onSelecionar={escolherVeiculo}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {passo === 1 && rascunho.veiculo && (
                  <PassoDataTurno
                    veiculo={rascunho.veiculo}
                    agendamentos={agendamentos}
                    dataInicio={rascunho.dataInicio}
                    dataFim={rascunho.dataFim}
                    turno={rascunho.turno}
                    onMudar={(v) =>
                      mudar({
                        ...(v.dataInicio !== undefined ? { dataInicio: v.dataInicio } : {}),
                        ...(v.dataFim !== undefined ? { dataFim: v.dataFim } : {}),
                        ...(v.turno !== undefined ? { turno: v.turno } : {}),
                      })
                    }
                  />
                )}

                {passo === 2 && (
                  <PassoContratos
                    contratos={contratosVisiveis}
                    carregando={contratos.isLoading}
                    incluirInativos={incluirInativos}
                    onIncluirInativos={setIncluirInativos}
                    selecionados={rascunho.contratos}
                    destino={rascunho.destino}
                    motivo={rascunho.motivo}
                    onAlternar={(id) =>
                      mudar({
                        contratos: rascunho.contratos.includes(id)
                          ? rascunho.contratos.filter((c) => c !== id)
                          : [...rascunho.contratos, id],
                      })
                    }
                    onMudar={mudar}
                  />
                )}

                {passo === 3 && rascunho.veiculo && (
                  <PassoConfirmar
                    veiculo={rascunho.veiculo}
                    dataInicio={rascunho.dataInicio}
                    dataFim={rascunho.dataFim}
                    turno={rascunho.turno}
                    contratos={nomesDosContratos}
                    destino={rascunho.destino}
                    motivo={rascunho.motivo}
                    observacoes={rascunho.observacoes}
                    onMudar={mudar}
                  />
                )}
              </div>

              {/* O passo 1 não tem botão de avançar: escolher o card já avança. */}
              {passo > 0 && (
                <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-5">
                  <Button variant="outline" className="gap-1.5" onClick={() => irPara((passo - 1) as IndicePasso)}>
                    <ArrowLeft className="h-4 w-4" />
                    Voltar
                  </Button>
                  {passo < 3 ? (
                    <Button
                      className="gap-1.5"
                      disabled={!podeAvancar}
                      onClick={() => irPara((passo + 1) as IndicePasso)}
                    >
                      Próximo
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button className="gap-1.5" disabled={criar.isPending} onClick={confirmar}>
                      {criar.isPending ? "Confirmando..." : "Confirmar Agendamento"}
                    </Button>
                  )}
                </div>
              )}
            </Card>

            {/* O card do assistente é mais baixo que a coluna da direita, e
                sobrava um vazio grande embaixo. Preenche com o uso real da
                frota — que só existe porque o histórico foi importado; sem
                dado, o painel se esconde em vez de mostrar caixas zeradas. */}
            <PainelFrota agendamentos={agendamentos} frota={listaFrota} />
          </TabsContent>

          <TabsContent value="meus">
            {agenda.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
              </div>
            ) : (
              <MeusAgendamentos
                agendamentos={agendamentos.filter((a) => a.solicitante_id === user?.id)}
                podeCancelarDeTerceiros={false}
                usuarioId={user?.id ?? null}
              />
            )}
          </TabsContent>

          {podeGerirFrota && (
            <TabsContent value="frota">
              <MeusAgendamentos
                agendamentos={agendamentos}
                podeCancelarDeTerceiros
                usuarioId={user?.id ?? null}
              />
            </TabsContent>
          )}

          <TabsContent value="calendario">
            <CalendarioGeral agendamentos={agendamentos} frota={listaFrota} />
          </TabsContent>
        </Tabs>

        <aside className="space-y-4">
          <StatusRapido
            frota={listaFrota}
            agendamentos={agendamentos}
            atualizando={frota.isFetching || agenda.isFetching}
            onAtualizar={atualizar}
          />
          <ProximosAgendamentos agendamentos={agendamentos} />
        </aside>
      </div>
    </div>
  );
}
