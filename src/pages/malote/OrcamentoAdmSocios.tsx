import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ArrowUpDown, Info } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { useClassificacoesOrcamentoAdmin } from "@/hooks/usePlanejamentoOrcamentario";
import { useContratosERP } from "@/hooks/useContratosERP";
import { useOrcamentoContratos } from "@/hooks/useOrcamentoContratos";
import { useUtilizadoOrcamento } from "@/hooks/useUtilizadoOrcamento";
import { useIntegrantesOrcamento, usePessoasOrcamento, useSalvarIntegrantesOrcamento } from "@/hooks/useOrcamentoAdmSocios";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { anoMesAtual } from "@/hooks/usePlanilhaCusto";
import { ehContratoAdministrativo } from "@/pages/controladoria/faturamento/regras";
import { fmtMoney } from "./orcamentoUtils";
import { SeletorContratos } from "./orcamento-adm-socios/SeletorContratos";
import {
  CONFIG_VAZIA, agruparPorSetor, aplicarEmGrupo, configVazia, equipesDasPessoas, filtrarPessoas, ordenarPessoas, pessoaDaEquipe, saldoDaClassificacao, setorDaPessoa,
  type ChaveOrdem, type ConfigPessoa, type DirecaoOrdem, type PessoaOrcamento, type TipoOrcamento,
} from "./orcamento-adm-socios/regras";

// SIS-2026-0858 (continuação do SIS-2026-0830): cadastro do Orçamento ADM e Sócios POR INTEGRANTE, conforme o HTML do Iury. Cada pessoa tem uma
// classificação de origem e um ou mais contratos (centros de custo de onde sai o orçamento); o saldo da classificação é só consulta.
// Mover alguém para Sócios (ou de volta) grava na hora; a configuração de cada pessoa só é gravada em "Salvar distribuição".

const TEXTO: Record<TipoOrcamento, { titulo: string; subtitulo: string; lista: string; busca: string; grupo: string; aplicar: string; selecionarTodos: string; contagem: string }> = {
  administrativo: {
    titulo: "CADASTRO DE ORÇAMENTO ESCRITÓRIO ADM", subtitulo: "Distribuição do orçamento entre os integrantes do escritório com perfil no sistema.",
    lista: "Lista de Integrantes do Escritório", busca: "Buscar integrante...", grupo: "Configurar por equipe", aplicar: "Aplicar à equipe",
    selecionarTodos: "Selecionar todos da equipe", contagem: "integrantes selecionados",
  },
  socios: {
    titulo: "CADASTRO DE ORÇAMENTO SÓCIOS", subtitulo: "Distribuição do orçamento entre os sócios cadastrados no sistema.",
    lista: "Lista de Sócios", busca: "Buscar sócio...", grupo: "Configurar em grupo", aplicar: "Aplicar aos sócios",
    selecionarTodos: "Selecionar todos os sócios", contagem: "sócios selecionados",
  },
};

export default function OrcamentoAdmSocios() {
  const [aba, setAba] = useState<TipoOrcamento>("administrativo");
  const [anoMes, setAnoMes] = useState(anoMesAtual());
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratosErp = [] } = useContratosERP({ todasEmpresas: true });
  const { data: grupos = [] } = useOrcamentoContratos(anoMes);
  const { data: utilizado = [] } = useUtilizadoOrcamento();
  const { data: classificacoes = [] } = useClassificacoesOrcamentoAdmin();
  const { data: pessoas = [], isLoading: carregandoPessoas, error: erroPessoas } = usePessoasOrcamento();
  const { data: salvos } = useIntegrantesOrcamento();
  const { data: podeAlterar } = useScreenAccess("malote_orcamento_adm_socios", "alterar");
  const salvar = useSalvarIntegrantesOrcamento();

  // aba de cada pessoa e a configuração (rascunho até "Salvar distribuição")
  const [tipos, setTipos] = useState<Map<string, TipoOrcamento>>(new Map());
  const [configs, setConfigs] = useState<Map<string, ConfigPessoa>>(new Map());
  const [sujo, setSujo] = useState(false);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [equipe, setEquipe] = useState("");
  const [busca, setBusca] = useState("");
  const [candidato, setCandidato] = useState("");
  const [bulk, setBulk] = useState<Record<TipoOrcamento, ConfigPessoa>>({ administrativo: CONFIG_VAZIA, socios: CONFIG_VAZIA });
  const [status, setStatus] = useState("");
  // Administrativo abre separado por setor; Sócios (sem coluna de setor) abre por nome. Clicar no título de uma coluna ordena por ela.
  const [ordem, setOrdem] = useState<{ chave: ChaveOrdem; direcao: DirecaoOrdem }>({ chave: "setor", direcao: "asc" });

  useEffect(() => {
    if (!salvos || sujo) return;
    setTipos(new Map(salvos.map((s) => [s.userId, s.tipo])));
    setConfigs(new Map(salvos.map((s) => [s.userId, s.config])));
  }, [salvos, sujo]);

  const tipoDe = (id: string): TipoOrcamento => tipos.get(id) ?? "administrativo";
  const configDe = (id: string): ConfigPessoa => configs.get(id) ?? CONFIG_VAZIA;

  const empresasOpcoes = useMemo(() => empresas.map((e) => ({ id: e.id, nome: e.nome })), [empresas]);
  // centros de custo de onde o orçamento sai: contratos ativos de cliente (os ADMINISTRATIVO … são justamente o destino do que se distribui)
  const contratos = useMemo(
    () => contratosErp.filter((c) => c.status === "ativo" && !ehContratoAdministrativo(c.nome)).map((c) => ({ id: c.id, nome: c.nome, empresaId: c.empresa_id })),
    [contratosErp],
  );
  const opcoesClassificacao = useMemo(
    () => classificacoes.filter((c) => c.ativo).map((c) => ({ value: c.id, label: c.nome })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    [classificacoes],
  );

  const doTipo = useMemo(() => pessoas.filter((p) => tipoDe(p.userId) === aba), [pessoas, tipos, aba]); // eslint-disable-line react-hooks/exhaustive-deps
  const equipes = useMemo(() => equipesDasPessoas(doTipo), [doTipo]);
  useEffect(() => { if (aba === "administrativo" && !equipes.includes(equipe)) setEquipe(equipes[0] ?? ""); }, [aba, equipes, equipe]);
  const filtradas = useMemo(() => filtrarPessoas(doTipo, busca), [doTipo, busca]);
  const alvoEquipe = useMemo(() => (aba === "administrativo" ? doTipo.filter((p) => pessoaDaEquipe(p, equipe)) : doTipo), [aba, doTipo, equipe]);
  const marcadasNaAba = useMemo(() => new Set([...marcadas].filter((id) => doTipo.some((p) => p.userId === id))), [marcadas, doTipo]);

  // saldo: da classificação da pessoa, só nos contratos que ela escolheu (centros de custo de onde sai). Pessoas com a mesma combinação dividem o cálculo.
  const saldos = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const p of doTipo) {
      const c = configDe(p.userId);
      if (!c.classificacaoId) continue;
      const chave = `${c.classificacaoId}|${[...c.contratoIds].sort().join(",")}`;
      if (!m.has(chave)) m.set(chave, saldoDaClassificacao(grupos, utilizado, c.classificacaoId, anoMes, c.contratoIds));
    }
    return m;
  }, [doTipo, configs, grupos, utilizado, anoMes]); // eslint-disable-line react-hooks/exhaustive-deps
  const saldoDe = (c: ConfigPessoa): number | null =>
    c.classificacaoId ? saldos.get(`${c.classificacaoId}|${[...c.contratoIds].sort().join(",")}`) ?? null : null;

  const nomeClassificacao = useMemo(() => new Map(opcoesClassificacao.map((o) => [o.value, o.label])), [opcoesClassificacao]);
  const visiveis = useMemo(
    () => ordenarPessoas(filtradas, ordem.chave, ordem.direcao, {
      origem: (p) => nomeClassificacao.get(configDe(p.userId).classificacaoId ?? "") ?? "",
      saldo: (p) => saldoDe(configDe(p.userId)),
    }),
    [filtradas, ordem, nomeClassificacao, configs, saldos], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // separado por setor só quando a ordem é por setor (no Administrativo); em qualquer outra coluna a lista é corrida
  const blocos = useMemo(() => (aba === "administrativo" && ordem.chave === "setor" ? agruparPorSetor(visiveis) : null), [aba, ordem.chave, visiveis]);
  function ordenarPor(chave: ChaveOrdem) {
    setOrdem((o) => ({ chave, direcao: o.chave === chave && o.direcao === "asc" ? "desc" : "asc" }));
  }
  function CabecalhoOrdenavel({ chave, children, className }: { chave: ChaveOrdem; children: React.ReactNode; className?: string }) {
    const ativo = ordem.chave === chave;
    const Icone = !ativo ? ArrowUpDown : ordem.direcao === "asc" ? ArrowUp : ArrowDown;
    return (
      <TableHead className={className} aria-sort={ativo ? (ordem.direcao === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" onClick={() => ordenarPor(chave)} className="inline-flex items-center gap-1 font-medium hover:text-foreground">
          {children}<Icone className={`h-3.5 w-3.5 ${ativo ? "" : "opacity-40"}`} />
        </button>
      </TableHead>
    );
  }

  function alterarConfig(id: string, mudanca: Partial<ConfigPessoa>) {
    setSujo(true);
    setStatus("Alterações pendentes. Clique em Salvar distribuição.");
    setConfigs((a) => new Map(a).set(id, { ...configDe(id), ...mudanca }));
  }
  const alternarMarca = (id: string, marcar: boolean) => setMarcadas((a) => { const n = new Set(a); if (marcar) n.add(id); else n.delete(id); return n; });
  const marcarLista = (lista: PessoaOrcamento[], marcar: boolean) => setMarcadas((a) => { const n = new Set(a); for (const p of lista) { if (marcar) n.add(p.userId); else n.delete(p.userId); } return n; });
  const todasMarcadas = (lista: PessoaOrcamento[]) => lista.length > 0 && lista.every((p) => marcadas.has(p.userId));

  // trocar a equipe marca só as pessoas dela
  function trocarEquipe(nova: string) {
    setEquipe(nova);
    setMarcadas(new Set(doTipo.filter((p) => pessoaDaEquipe(p, nova)).map((p) => p.userId)));
  }

  function aplicarGrupo() {
    if (marcadasNaAba.size === 0) { setStatus("Selecione pelo menos uma pessoa para aplicar."); return; }
    const b = bulk[aba];
    setSujo(true);
    setConfigs((a) => aplicarEmGrupo(a, marcadasNaAba, b.classificacaoId, b.contratoIds));
    setStatus(`Configuração aplicada a ${marcadasNaAba.size} pessoa(s). Clique em Salvar distribuição para guardar.`);
  }

  // o que vai ao banco: quem é sócio ou tem alguma configuração; some a linha de quem voltou ao Administrativo sem nada configurado
  function montarGravacao(tiposAtuais: Map<string, TipoOrcamento>, configsAtuais: Map<string, ConfigPessoa>) {
    const gravar: { userId: string; tipo: TipoOrcamento; config: ConfigPessoa }[] = [];
    const apagar: string[] = [];
    for (const p of pessoas) {
      const tipo = tiposAtuais.get(p.userId) ?? "administrativo";
      const config = configsAtuais.get(p.userId);
      if (tipo === "socios" || !configVazia(config)) gravar.push({ userId: p.userId, tipo, config: config ?? CONFIG_VAZIA });
      else if (salvos?.some((s) => s.userId === p.userId)) apagar.push(p.userId);
    }
    return { gravar, apagar };
  }

  async function gravarTudo(tiposAtuais: Map<string, TipoOrcamento>, configsAtuais: Map<string, ConfigPessoa>) {
    await salvar.mutateAsync(montarGravacao(tiposAtuais, configsAtuais));
  }

  async function salvarDistribuicao() {
    try {
      await gravarTudo(tipos, configs);
      setSujo(false);
      setStatus("Distribuição salva.");
      toast.success("Distribuição salva.");
    } catch (e: unknown) {
      const msg = (e as { message?: unknown } | null)?.message; // erro do Supabase é objeto simples, não Error
      toast.error(typeof msg === "string" && msg ? msg : "Erro ao salvar.");
    }
  }

  // mudar de aba grava na hora (a configuração da pessoa vai junto)
  async function mover(id: string, para: TipoOrcamento) {
    const nome = pessoas.find((p) => p.userId === id)?.nome ?? "Pessoa";
    const novosTipos = new Map(tipos).set(id, para);
    try {
      await gravarTudo(novosTipos, configs);
      setTipos(novosTipos);
      setMarcadas((a) => { const n = new Set(a); n.delete(id); return n; });
      if (para === "socios") setCandidato("");
      setStatus(`${nome} ${para === "socios" ? "foi movido(a) para Sócios e retirado(a) do Administrativo" : "voltou para o Administrativo"}. Alteração salva.`);
    } catch (e: unknown) {
      const msg = (e as { message?: unknown } | null)?.message;
      toast.error(typeof msg === "string" && msg ? msg : "Erro ao mover a pessoa.");
    }
  }

  const candidatos = useMemo(() => pessoas.filter((p) => tipoDe(p.userId) === "administrativo"), [pessoas, tipos]); // eslint-disable-line react-hooks/exhaustive-deps
  const texto = TEXTO[aba];
  const adm = aba === "administrativo";
  const b = bulk[aba];
  const editavel = !!podeAlterar;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Orçamento ADM e Sócios (novo)"
        subtitle={texto.subtitulo}
        module="Malote"
        breadcrumb={["Malote", "Classificações e Orçamentos", "Orçamento ADM e Sócios (novo)"]}
      />

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-muted-foreground">
          Configure a origem do orçamento e os centros de custo. Cada pessoa permite uma única classificação e vários contratos. Uma pessoa fica em uma aba por vez.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs value={aba} onValueChange={(v) => { setAba(v as TipoOrcamento); setBusca(""); setStatus(""); setOrdem({ chave: v === "administrativo" ? "setor" : "nome", direcao: "asc" }); }}>
          <TabsList>
            <TabsTrigger value="administrativo">Orçamento Administrativo</TabsTrigger>
            <TabsTrigger value="socios">Orçamento Sócios</TabsTrigger>
          </TabsList>
        </Tabs>
        <div>
          <Label className="text-xs">Ano/Mês</Label>
          <Input type="month" className="w-44" value={anoMes} onChange={(e) => setAnoMes(e.target.value || anoMesAtual())} />
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{texto.lista}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{texto.titulo.charAt(0) + texto.titulo.slice(1).toLowerCase()}</p>
          </div>
          <div className="flex items-center gap-2">
            <Input className="w-56" type="search" placeholder={texto.busca} value={busca} onChange={(e) => setBusca(e.target.value)} />
            <Button onClick={() => void salvarDistribuicao()} disabled={!editavel || !sujo || salvar.isPending}>{salvar.isPending ? "Salvando..." : "Salvar distribuição"}</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!!erroPessoas && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">Não foi possível carregar as pessoas: {(erroPessoas as { message?: string }).message ?? "erro desconhecido"}.</p>}

          {!adm && (
            <div className="rounded-md border border-border p-3">
              <p className="text-sm font-semibold">Adicionar pessoa aos sócios</p>
              <p className="my-2 text-xs text-muted-foreground">Selecione uma pessoa do Administrativo. Ela será movida para Sócios, mantendo sua classificação e seus contratos.</p>
              <div className="flex flex-wrap items-center gap-2">
                <SearchableSelect
                  value={candidato || null}
                  onChange={setCandidato}
                  options={candidatos.map((p) => ({ value: p.userId, label: p.nome, hint: setorDaPessoa(p) }))}
                  placeholder={candidatos.length ? "Selecione uma pessoa..." : "Todas as pessoas já foram adicionadas"}
                  searchPlaceholder="Buscar pessoa..."
                  disabled={!editavel || candidatos.length === 0}
                  className="w-[320px]"
                  triggerClassName="h-9 bg-background text-sm"
                />
                <Button disabled={!editavel || !candidato || salvar.isPending} onClick={() => void mover(candidato, "socios")}>Adicionar aos sócios</Button>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/20">
            <h3 className="mb-3 text-sm font-semibold">{texto.grupo}</h3>
            <div className={`grid items-start gap-4 ${adm ? "md:grid-cols-[1fr_1.1fr_1.7fr_auto]" : "md:grid-cols-[1.1fr_1.7fr_auto]"}`}>
              {adm && (
                <div>
                  <Label className="text-xs font-bold">Equipe / Setor</Label>
                  <Select value={equipe} onValueChange={trocarEquipe}>
                    <SelectTrigger className="mt-1.5 h-9 bg-background"><SelectValue placeholder="Selecione a equipe" /></SelectTrigger>
                    <SelectContent>{equipes.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label className="text-xs font-bold">Origem do orçamento</Label>
                <div className="mt-1.5">
                  <SearchableSelect
                    value={b.classificacaoId}
                    onChange={(v) => setBulk((x) => ({ ...x, [aba]: { ...x[aba], classificacaoId: v } }))}
                    options={opcoesClassificacao}
                    placeholder="Selecione a classificação"
                    searchPlaceholder="Buscar classificação..."
                    className="w-full"
                    triggerClassName="h-9 bg-background text-sm"
                  />
                </div>
                <span className="mt-1 block text-[11px] text-muted-foreground">Selecione apenas uma classificação</span>
              </div>
              <div>
                <Label className="text-xs font-bold">Centro de custo de onde sai</Label>
                <div className="mt-1.5">
                  <SeletorContratos empresas={empresasOpcoes} contratos={contratos} value={b.contratoIds} onChange={(ids) => setBulk((x) => ({ ...x, [aba]: { ...x[aba], contratoIds: ids } }))} />
                </div>
                <span className="mt-1 block text-[11px] text-muted-foreground">Selecione contratos ou todos de uma empresa</span>
              </div>
              <Button className="md:mt-[22px]" disabled={!editavel} onClick={aplicarGrupo}>{texto.aplicar}</Button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox checked={todasMarcadas(alvoEquipe)} onCheckedChange={(v) => marcarLista(alvoEquipe, v === true)} />
                {texto.selecionarTodos}
              </label>
              <span className="rounded-full border border-blue-200 bg-blue-100 px-2.5 py-1 text-blue-800">{marcadasNaAba.size} {texto.contagem}</span>
              <span className="text-muted-foreground">A configuração será aplicada a {marcadasNaAba.size} pessoa(s) selecionada(s).</span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">ⓘ Você também pode ajustar cada pessoa individualmente.</p>

          <div className="overflow-x-auto">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"><Checkbox aria-label="Selecionar todos os resultados da busca" checked={todasMarcadas(visiveis)} onCheckedChange={(v) => marcarLista(visiveis, v === true)} /></TableHead>
                  <CabecalhoOrdenavel chave="nome">{adm ? "Integrante" : "Sócio"}</CabecalhoOrdenavel>
                  {adm && <CabecalhoOrdenavel chave="setor">Setor</CabecalhoOrdenavel>}
                  <CabecalhoOrdenavel chave="origem" className="min-w-[220px]">Origem do orçamento</CabecalhoOrdenavel>
                  <TableHead className="min-w-[240px]">Centro de custo de onde sai</TableHead>
                  <CabecalhoOrdenavel chave="saldo" className="text-right">
                    <span className="inline-flex items-center gap-1">
                      Saldo da classificação
                      <Tooltip>
                        <TooltipTrigger asChild><button type="button" aria-label="Informação sobre saldo da classificação" className="inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px]">i</button></TooltipTrigger>
                        <TooltipContent className="max-w-[260px] text-xs">É o saldo que esta classificação possui no mês selecionado, somando apenas os contratos escolhidos para esta pessoa. O saldo pertence à classificação e não é exclusivo dela.</TooltipContent>
                      </Tooltip>
                    </span>
                  </CabecalhoOrdenavel>
                  {!adm && <TableHead>Ação</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {carregandoPessoas && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow>}
                {!carregandoPessoas && visiveis.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhuma pessoa encontrada.</TableCell></TableRow>}
                {(blocos ?? [{ setor: "", pessoas: visiveis }]).map((bloco) => (
                  <Fragment key={bloco.setor || "todos"}>
                    {blocos && (
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableCell className="py-2"><Checkbox aria-label={`Selecionar o setor ${bloco.setor}`} checked={todasMarcadas(bloco.pessoas)} onCheckedChange={(v) => marcarLista(bloco.pessoas, v === true)} /></TableCell>
                        <TableCell colSpan={5} className="py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                          {bloco.setor} <span className="ml-1 font-normal normal-case">· {bloco.pessoas.length} {bloco.pessoas.length === 1 ? "pessoa" : "pessoas"}</span>
                        </TableCell>
                      </TableRow>
                    )}
                    {bloco.pessoas.map((p) => {
                  const c = configDe(p.userId);
                  const saldo = saldoDe(c);
                  return (
                    <TableRow key={p.userId}>
                      <TableCell><Checkbox aria-label={`Selecionar ${p.nome}`} checked={marcadas.has(p.userId)} onCheckedChange={(v) => alternarMarca(p.userId, v === true)} /></TableCell>
                      <TableCell className="font-semibold">{p.nome}</TableCell>
                      {adm && <TableCell><span className="whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs">{setorDaPessoa(p)}</span></TableCell>}
                      <TableCell>
                        <SearchableSelect
                          value={c.classificacaoId}
                          onChange={(v) => alterarConfig(p.userId, { classificacaoId: v })}
                          options={opcoesClassificacao}
                          placeholder="Selecione a classificação"
                          searchPlaceholder="Buscar classificação..."
                          disabled={!editavel}
                          className="w-full"
                          triggerClassName="h-9 bg-background text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <SeletorContratos empresas={empresasOpcoes} contratos={contratos} value={c.contratoIds} onChange={(ids) => alterarConfig(p.userId, { contratoIds: ids })} disabled={!editavel} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{saldo == null ? "—" : fmtMoney(saldo)}</TableCell>
                      {!adm && (
                        <TableCell>
                          <Button size="sm" variant="outline" className="whitespace-nowrap text-xs" disabled={!editavel || salvar.isPending} onClick={() => void mover(p.userId, "administrativo")}>Voltar ao Administrativo</Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                    })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          <p role="status" aria-live="polite" className="min-h-[1.25rem] text-xs text-emerald-800">{status}</p>
          <p className="text-[11px] text-muted-foreground">Saldo da classificação é um valor compartilhado: não representa um saldo exclusivo da pessoa.</p>
        </CardContent>
      </Card>
    </div>
  );
}
