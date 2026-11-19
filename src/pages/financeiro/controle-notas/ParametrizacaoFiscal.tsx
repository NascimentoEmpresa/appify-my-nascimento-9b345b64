import { FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DadosContratoNfse, ParametroServicoEntrada, ParametroServicoNfse, useContratosParaNfse, useDadosContratosNfse,
  useNomesUsuariosNfse, useParametrosServicoNfse, useSalvarDadosContratoNfse, useSalvarParametroServicoNfse,
} from "@/hooks/useNfseParametrizacao";
import { formatarDocumento } from "@/lib/juridico/tipoProcesso";
import { NavegacaoControleNotas } from "../nf-emissao/NavegacaoControleNotas";
import { MunicipioNfseCampo } from "./MunicipioNfseCampo";
import {
  erroDadosContrato, erroParametroServico, FormularioDadosContrato, formularioDosDados, limparParametroServico,
} from "./parametrosFiscaisNfse";

// SIS-2026-0941: o Faturamento consulta e mantém os códigos fiscais por item de
// serviço e os dados da NFS-e por contrato, sem depender de mudança no código.
// O painel de emissão (NfseIntegracaoPainel) lê os dois cadastros.
const MENU = "financeiro-nfse-parametros";
const ISS: [string, string][] = [["1", "Não retido"], ["2", "Retido pelo tomador"]];
const PIS_COFINS: [string, string][] = [["1", "PIS/COFINS retidos"], ["3", "PIS/COFINS/CSLL retidos"], ["4", "PIS/COFINS retidos, CSLL não retido"]];
const ENTE: [string, string][] = [["1", "1 — União"], ["2", "2 — Estado"], ["3", "3 — Distrito Federal"], ["4", "4 — Município"]];
const rotulo = (opcoes: [string, string][], valor: string) => opcoes.find(([c]) => c === valor)?.[1] ?? "—";

function Campo({ titulo, valor, alterar, obrigatorio = true, maximo, somenteLeitura = false, tipo = "text" }: {
  titulo: string; valor: string; alterar: (v: string) => void; obrigatorio?: boolean; maximo?: number; somenteLeitura?: boolean; tipo?: string;
}) {
  return <Label className="grid gap-2 text-sm font-normal">{titulo}
    <Input value={valor} onChange={e => alterar(e.target.value)} required={obrigatorio} maxLength={maximo} readOnly={somenteLeitura} type={tipo} />
  </Label>;
}
function Escolha({ titulo, valor, alterar, opcoes, obrigatorio = false }: { titulo: string; valor: string; alterar: (v: string) => void; opcoes: [string, string][]; obrigatorio?: boolean }) {
  return <Label className="grid gap-2 text-sm font-normal">{titulo}
    <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={valor} onChange={e => alterar(e.target.value)} required={obrigatorio}>
      <option value="">{obrigatorio ? "Selecione" : "Não informar"}</option>{valor && !opcoes.some(([c]) => c === valor) && <option value={valor} disabled>Valor inválido: {valor} — revise</option>}
      {opcoes.map(([c, nome]) => <option key={c} value={c}>{nome}</option>)}
    </select>
  </Label>;
}
function Atualizacao({ em, por, nomes, origem }: { em: string; por: string | null; nomes: Record<string, string> | undefined; origem?: string }) {
  return <span className="text-xs text-muted-foreground">{new Date(em).toLocaleDateString("pt-BR")}{por && nomes?.[por] ? ` · ${nomes[por]}` : ""}{origem ? ` · ${origem}` : ""}</span>;
}

const entradaDe = ({ id, municipio_emissor, item_lc116, descricao, codigo_tributacao, codigo_nbs, codigo_integracao_municipal, ibs_cst, ibs_classificacao, ibs_indicador_operacao, ativo }: ParametroServicoNfse): ParametroServicoEntrada =>
  ({ id, municipio_emissor, item_lc116, descricao, codigo_tributacao, codigo_nbs, codigo_integracao_municipal, ibs_cst, ibs_classificacao, ibs_indicador_operacao, ativo });

function AbaServicos() {
  const consulta = useParametrosServicoNfse();
  const salvar = useSalvarParametroServicoNfse();
  const linhas = consulta.data ?? [];
  const nomes = useNomesUsuariosNfse(linhas.map(l => l.atualizado_por ?? ""));
  const [editando, setEditando] = useState<ParametroServicoEntrada | null>(null);
  const alterar = (campo: keyof ParametroServicoEntrada, valor: string) => setEditando(e => e && { ...e, [campo]: valor });
  async function gravar(entrada: ParametroServicoEntrada, mensagem: string) {
    const linha = limparParametroServico(entrada);
    const erro = erroParametroServico(linha);
    if (erro) { toast.error(erro); return false; }
    try { await salvar.mutateAsync(linha); toast.success(mensagem); return true; }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Não foi possível salvar."); return false; }
  }
  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (editando && await gravar(editando, "Código de serviço salvo. As próximas preparações já usam estes valores.")) setEditando(null);
  }
  const novo = (): ParametroServicoEntrada => ({ municipio_emissor: linhas[0]?.municipio_emissor ?? "", item_lc116: "", descricao: "", codigo_tributacao: "",
    codigo_nbs: "", codigo_integracao_municipal: "", ibs_cst: "", ibs_classificacao: "", ibs_indicador_operacao: "", ativo: true });
  return <section className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-2">
      <p className="max-w-3xl text-sm text-muted-foreground">Ao escolher o item de serviço na emissão da NFS-e, o painel preenche estes códigos. Confira com o responsável fiscal antes de alterar: a mudança vale para as próximas preparações, não para notas já solicitadas.</p>
      <AcessoGate menu={MENU} acao="incluir"><Button type="button" onClick={() => setEditando(novo())}><Plus className="mr-2 h-4 w-4" />Novo código de serviço</Button></AcessoGate>
    </div>
    {consulta.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar a parametrização. Confira seu acesso e tente recarregar a página.</p>}
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Item (LC 116)</TableHead><TableHead>Código nacional</TableHead><TableHead>NBS</TableHead><TableHead>Serviço na prefeitura</TableHead>
          <TableHead>IBS/CBS (CST · classificação · indicador)</TableHead><TableHead>Município emissor</TableHead><TableHead>Atualizado</TableHead><TableHead />
        </TableRow></TableHeader>
        <TableBody>
          {consulta.isLoading && <TableRow><TableCell colSpan={8} className="text-sm text-muted-foreground">Carregando...</TableCell></TableRow>}
          {!consulta.isLoading && !linhas.length && !consulta.isError && <TableRow><TableCell colSpan={8} className="text-sm text-muted-foreground">Nenhum código de serviço cadastrado.</TableCell></TableRow>}
          {linhas.map(l => <TableRow key={l.id} className={l.ativo ? undefined : "opacity-60"}>
            <TableCell><div className="font-medium">{l.item_lc116}{!l.ativo && <Badge variant="outline" className="ml-2">Inativo</Badge>}</div><div className="text-xs text-muted-foreground">{l.descricao}</div></TableCell>
            <TableCell>{l.codigo_tributacao}</TableCell><TableCell>{l.codigo_nbs}</TableCell><TableCell>{l.codigo_integracao_municipal || "—"}</TableCell>
            <TableCell>{l.ibs_cst} · {l.ibs_classificacao} · {l.ibs_indicador_operacao}</TableCell><TableCell>{l.municipio_emissor}</TableCell>
            <TableCell><Atualizacao em={l.atualizado_em} por={l.atualizado_por} nomes={nomes.data} /></TableCell>
            <TableCell className="whitespace-nowrap text-right"><AcessoGate menu={MENU} acao="alterar">
              <Button type="button" size="sm" variant="ghost" aria-label={`Editar ${l.item_lc116}`} onClick={() => setEditando(entradaDe(l))}><Pencil className="h-4 w-4" /></Button>
              <Button type="button" size="sm" variant="outline" disabled={salvar.isPending} onClick={() => void gravar({ ...entradaDe(l), ativo: !l.ativo }, l.ativo ? "Código inativado: deixa de aparecer na emissão." : "Código reativado.")}>{l.ativo ? "Inativar" : "Reativar"}</Button>
            </AcessoGate></TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </div>
    <Dialog open={editando !== null} onOpenChange={aberto => { if (!aberto) setEditando(null); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{editando?.id ? `Editar ${editando.item_lc116}` : "Novo código de serviço"}</DialogTitle>
          <DialogDescription>Use os mesmos códigos do portal da prefeitura. Pontos e traços são removidos ao salvar.</DialogDescription></DialogHeader>
        {editando && <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-2">
          <Campo titulo="Item de serviço (LC 116)" valor={editando.item_lc116} alterar={v => alterar("item_lc116", v)} maximo={5} somenteLeitura={Boolean(editando.id)} />
          <Campo titulo="Município emissor — código IBGE" valor={editando.municipio_emissor} alterar={v => alterar("municipio_emissor", v)} maximo={7} somenteLeitura={Boolean(editando.id)} />
          <div className="sm:col-span-2"><Campo titulo="Descrição" valor={editando.descricao} alterar={v => alterar("descricao", v)} obrigatorio={false} maximo={200} /></div>
          <Campo titulo="Código nacional do serviço" valor={editando.codigo_tributacao} alterar={v => alterar("codigo_tributacao", v)} maximo={8} />
          <Campo titulo="NBS" valor={editando.codigo_nbs} alterar={v => alterar("codigo_nbs", v)} maximo={13} />
          <Campo titulo="Código do serviço na prefeitura" valor={editando.codigo_integracao_municipal} alterar={v => alterar("codigo_integracao_municipal", v)} obrigatorio={false} maximo={20} />
          <Campo titulo="CST de IBS/CBS" valor={editando.ibs_cst} alterar={v => alterar("ibs_cst", v)} maximo={3} />
          <Campo titulo="Classificação tributária de IBS/CBS" valor={editando.ibs_classificacao} alterar={v => alterar("ibs_classificacao", v)} maximo={6} />
          <Campo titulo="Indicador da operação" valor={editando.ibs_indicador_operacao} alterar={v => alterar("ibs_indicador_operacao", v)} maximo={6} />
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={() => setEditando(null)}>Cancelar</Button><Button type="submit" disabled={salvar.isPending}>{salvar.isPending ? "Salvando..." : "Salvar"}</Button></DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  </section>;
}

const somenteNumeros = (v: string) => v.replace(/\D/g, "");
function AbaContratos() {
  const consulta = useDadosContratosNfse();
  const servicos = useParametrosServicoNfse();
  const salvar = useSalvarDadosContratoNfse();
  const linhas = useMemo(() => consulta.data ?? [], [consulta.data]);
  const nomes = useNomesUsuariosNfse(linhas.map(l => l.atualizado_por ?? ""));
  const [busca, setBusca] = useState("");
  const [escolhendo, setEscolhendo] = useState(false);
  const [editando, setEditando] = useState<{ contratoId: string; nome: string; form: FormularioDadosContrato } | null>(null);
  const contratos = useContratosParaNfse(escolhendo);
  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase(); const numeros = somenteNumeros(busca);
    if (!termo) return linhas;
    return linhas.filter(l => `${l.contrato?.nome ?? ""} ${l.contrato?.cliente ?? ""} ${l.tomador_nome}`.toLowerCase().includes(termo) || (numeros.length >= 3 && l.tomador_documento.includes(numeros)));
  }, [linhas, busca]);
  const semCadastro = (contratos.data ?? []).filter(c => !linhas.some(l => l.contrato_id === c.id));
  const itens: [string, string][] = [...new Map((servicos.data ?? []).filter(s => s.ativo).map(s => [s.item_lc116, s.descricao ? `${s.item_lc116} — ${s.descricao}` : s.item_lc116])).entries()];
  const alterar = (mudanca: Partial<FormularioDadosContrato>) => setEditando(e => e && { ...e, form: { ...e.form, ...mudanca } });
  const alterarTomador = (campo: keyof FormularioDadosContrato["tomador"], valor: string) => setEditando(e => e && { ...e, form: { ...e.form, tomador: { ...e.form.tomador, [campo]: valor } } });
  function editar(l: DadosContratoNfse) { setEditando({ contratoId: l.contrato_id, nome: l.contrato?.nome ?? "Contrato", form: formularioDosDados(l) }); }
  function escolher(id: string) {
    const c = semCadastro.find(x => x.id === id); if (!c) return;
    setEscolhendo(false);
    setEditando({ contratoId: c.id, nome: c.nome, form: formularioDosDados(null, { nome: c.cliente, documento: c.cnpj_cliente }) });
  }
  async function enviar(evento: FormEvent) {
    evento.preventDefault(); if (!editando) return;
    const erro = erroDadosContrato(editando.form);
    if (erro) { toast.error(erro); return; }
    try { await salvar.mutateAsync({ contratoId: editando.contratoId, dados: editando.form }); setEditando(null); toast.success("Dados do contrato salvos. A próxima preparação deste contrato já vem preenchida."); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Não foi possível salvar."); }
  }
  return <section className="space-y-3">
    <p className="max-w-3xl text-sm text-muted-foreground">Na emissão da NFS-e, a preparação nova de um contrato chega com estes dados. Eles também se atualizam sozinhos quando a prefeitura autoriza uma nota do contrato, salvo quando a caixa de atualizar o cadastro foi desmarcada.</p>
    <div className="flex flex-wrap items-end justify-between gap-2">
      <Label className="grid w-full max-w-sm gap-2 text-sm font-normal">Buscar por contrato, tomador ou CNPJ
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={busca} onChange={e => setBusca(e.target.value)} /></div>
      </Label>
      <AcessoGate menu={MENU} acao="alterar"><Button type="button" onClick={() => setEscolhendo(true)}><Plus className="mr-2 h-4 w-4" />Cadastrar contrato</Button></AcessoGate>
    </div>
    {consulta.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar os contratos. Confira seu acesso e tente recarregar a página.</p>}
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Contrato</TableHead><TableHead>Tomador</TableHead><TableHead>Item</TableHead><TableHead>ISS</TableHead><TableHead>PIS/COFINS</TableHead><TableHead>Atualizado</TableHead><TableHead />
        </TableRow></TableHeader>
        <TableBody>
          {consulta.isLoading && <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">Carregando...</TableCell></TableRow>}
          {!consulta.isLoading && !filtradas.length && !consulta.isError && <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">{busca ? "Nenhum contrato encontrado." : "Nenhum contrato cadastrado ainda."}</TableCell></TableRow>}
          {filtradas.map(l => <TableRow key={l.contrato_id}>
            <TableCell><div className="font-medium">{l.contrato?.nome ?? "—"}</div><div className="text-xs text-muted-foreground">{l.contrato?.cliente}</div></TableCell>
            <TableCell><div>{l.tomador_nome}</div><div className="text-xs text-muted-foreground">{formatarDocumento(l.tomador_documento)}{l.tomador_inscricao_municipal ? ` · IM ${l.tomador_inscricao_municipal}` : ""}</div></TableCell>
            <TableCell>{l.item_lc116 || "—"}</TableCell><TableCell>{rotulo(ISS, l.iss_retido)}</TableCell><TableCell>{rotulo(PIS_COFINS, l.retencao_pis_cofins)}</TableCell>
            <TableCell><Atualizacao em={l.atualizado_em} por={l.atualizado_por} nomes={nomes.data} origem={l.origem_solicitacao_id ? "pela nota autorizada" : "editado na tela"} /></TableCell>
            <TableCell className="text-right"><AcessoGate menu={MENU} acao="alterar"><Button type="button" size="sm" variant="ghost" aria-label={`Editar ${l.contrato?.nome ?? "contrato"}`} onClick={() => editar(l)}><Pencil className="h-4 w-4" /></Button></AcessoGate></TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </div>
    <Dialog open={escolhendo} onOpenChange={setEscolhendo}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Cadastrar contrato</DialogTitle><DialogDescription>Escolha o contrato. Nome e CNPJ do cliente do contrato entram como sugestão do tomador.</DialogDescription></DialogHeader>
        {contratos.isLoading ? <p role="status" className="text-sm text-muted-foreground">Carregando contratos...</p>
          : <Escolha titulo="Contrato" valor="" alterar={escolher} obrigatorio opcoes={semCadastro.map(c => [c.id, c.cliente ? `${c.nome} — ${c.cliente}` : c.nome])} />}
        {contratos.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar os contratos.</p>}
      </DialogContent>
    </Dialog>
    <Dialog open={editando !== null} onOpenChange={aberto => { if (!aberto) setEditando(null); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{editando?.nome}</DialogTitle><DialogDescription>Dados que a próxima preparação de NFS-e deste contrato vai trazer preenchidos. Tudo continua editável na nota.</DialogDescription></DialogHeader>
        {editando && <form onSubmit={enviar} className="space-y-5">
          <fieldset className="grid gap-3 md:grid-cols-3"><legend className="mb-3 font-medium">Tomador</legend>
            <Campo titulo="CPF/CNPJ" valor={editando.form.tomador.documento} alterar={v => alterarTomador("documento", v)} maximo={18} />
            <Campo titulo="Nome / razão social" valor={editando.form.tomador.nome} alterar={v => alterarTomador("nome", v)} maximo={150} />
            <Campo titulo="Inscrição municipal do tomador" valor={editando.form.tomador.inscricao_municipal ?? ""} alterar={v => alterarTomador("inscricao_municipal", v)} obrigatorio={false} maximo={15} />
            <MunicipioNfseCampo titulo="Município" codigo={editando.form.tomador.municipio} alterar={v => alterarTomador("municipio", v)} />
            <Campo titulo="CEP" valor={editando.form.tomador.cep} alterar={v => alterarTomador("cep", v)} maximo={9} />
            <Campo titulo="Logradouro" valor={editando.form.tomador.logradouro} alterar={v => alterarTomador("logradouro", v)} maximo={255} />
            <Campo titulo="Número" valor={editando.form.tomador.numero} alterar={v => alterarTomador("numero", v)} maximo={60} />
            <Campo titulo="Bairro" valor={editando.form.tomador.bairro} alterar={v => alterarTomador("bairro", v)} maximo={60} />
            <Campo titulo="Complemento" valor={editando.form.tomador.complemento} alterar={v => alterarTomador("complemento", v)} obrigatorio={false} maximo={156} />
            <Campo titulo="E-mail" valor={editando.form.tomador.email} alterar={v => alterarTomador("email", v)} obrigatorio={false} maximo={80} tipo="email" />
          </fieldset>
          <fieldset className="grid gap-3 md:grid-cols-3"><legend className="mb-3 font-medium">Prestação e retenções</legend>
            <MunicipioNfseCampo titulo="Local da prestação" codigo={editando.form.local_prestacao} alterar={v => alterar({ local_prestacao: v })} />
            <Escolha titulo="Item de serviço (LC 116)" valor={editando.form.item_lc116} alterar={v => alterar({ item_lc116: v })} opcoes={itens} />
            <Escolha titulo="Consumidor final" valor={editando.form.consumidor_final} alterar={v => alterar({ consumidor_final: v })} opcoes={[["0", "Não"], ["1", "Sim"]]} />
            <Escolha titulo="Tipo de ente governamental" valor={editando.form.tipo_ente_governamental} alterar={v => alterar({ tipo_ente_governamental: v })} opcoes={ENTE} />
            <Escolha titulo="Retenção do ISS" valor={editando.form.iss_retido} alterar={v => alterar({ iss_retido: v })} opcoes={ISS} />
            <Escolha titulo="Contribuições retidas" valor={editando.form.retencao_pis_cofins} alterar={v => alterar({ retencao_pis_cofins: v })} opcoes={PIS_COFINS} />
            <p className="text-sm text-muted-foreground md:col-span-3">As retenções só entram na nota quando combinam com os valores salvos da preparação — por exemplo, "Retido pelo tomador" só é usado quando a preparação desconta ISS.</p>
          </fieldset>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setEditando(null)}>Cancelar</Button><Button type="submit" disabled={salvar.isPending}>{salvar.isPending ? "Salvando..." : "Salvar"}</Button></DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  </section>;
}

export default function ParametrizacaoFiscal() {
  return <div className="space-y-6 p-6">
    <NavegacaoControleNotas />
    <PageHeader title="Parametrização Fiscal (NFS-e)" module="Financeiro" breadcrumb={["Controle de Notas", "Parametrização Fiscal"]}
      subtitle="Códigos fiscais por item de serviço e dados do tomador por contrato, usados para preencher a emissão da NFS-e." />
    <Tabs defaultValue="servicos" className="space-y-4">
      <TabsList className="flex h-auto w-full flex-wrap justify-start sm:w-fit"><TabsTrigger value="servicos">Códigos de serviço</TabsTrigger><TabsTrigger value="contratos">Tomadores por contrato</TabsTrigger></TabsList>
      <TabsContent value="servicos"><AbaServicos /></TabsContent>
      <TabsContent value="contratos"><AbaContratos /></TabsContent>
    </Tabs>
  </div>;
}
