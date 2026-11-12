import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, FileDown, Send, ChevronDown } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { NfEmissaoRow } from "@/hooks/useNfEmissao";
import { abrirDocumentoNfse, AmbienteNfse, EstadoNfse, ParametrosNfse, SolicitacaoNfse, useConfiguracaoNfse, useReprocessarNfse, useSolicitacoesNfse, useSolicitarNfse } from "@/hooks/useNfseIntegracao";
import { fmtMoney } from "../nf-emissao/shared";
import { validarParametrosNfse } from "./validarParametrosNfse";

const ESTADOS: Record<EstadoNfse, string> = {
  pendente: "Na fila", processando: "Processando", aguardando: "Aguardando a prefeitura",
  autorizada: "Autorizada em homologação", rejeitada: "Rejeitada", erro: "Revisar configuração ou dados", incerta: "Resultado em consulta",
};
function parametrosIniciais(nf: NfEmissaoRow): ParametrosNfse {
  return {
    serie: "", municipio_emissor: "3542404", inscricao_municipal: "", opcao_simples: "", regime_especial: "", regime_apuracao: "",
    local_prestacao: "", codigo_tributacao: nf.codigo_servico ?? "", codigo_municipal: "", codigo_integracao_municipal: "", codigo_nbs: nf.nbs ?? "", descricao: nf.descricao ?? "",
    iss_retido: "", aliquota_iss: nf.vlr_bruto_total > 0 ? (Number(nf.issqn_total) / Number(nf.vlr_bruto_total) * 100).toFixed(2) : "",
    cst_pis_cofins: "", retencao_pis_cofins: nf.csll_total > 0 ? "3" : "1",
    ibs_cst: "", ibs_classificacao: "", ibs_indicador_operacao: "", consumidor_final: "", tipo_operacao: "", tipo_ente_governamental: "",
    tributos_aproximados_federais: "0.00", tributos_aproximados_estaduais: "0.00", tributos_aproximados_municipais: "0.00", confirmacao_fiscal: false,
    informar_imovel: false, imovel: { cep: "", logradouro: "", numero: "", complemento: "", bairro: "", inscricao: "" },
    tomador: { documento: "", nome: "", municipio: "", cep: "", logradouro: "", numero: "", complemento: "", bairro: "", email: "" },
  };
}
function Campo({ titulo, valor, alterar, obrigatorio = true, tipo = "text", maximo, somenteLeitura = false }: {
  titulo: string; valor: string; alterar: (valor: string) => void; obrigatorio?: boolean; tipo?: string; maximo?: number; somenteLeitura?: boolean;
}) {
  return <Label className="grid gap-2 text-sm font-normal">{titulo}
    <Input value={valor} onChange={e => alterar(e.target.value)} readOnly={somenteLeitura} required={obrigatorio} type={tipo} maxLength={maximo} step={tipo === "number" ? "0.01" : undefined} min={tipo === "number" ? "0" : undefined} />
  </Label>;
}
function Escolha({ titulo, valor, alterar, opcoes }: { titulo: string; valor: string; alterar: (valor: string) => void; opcoes: [string,string][] }) {
  return <Label className="grid gap-2 text-sm font-normal">{titulo}
    <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={valor} onChange={e => alterar(e.target.value)} required>
      <option value="">Selecione</option>{opcoes.map(([codigo,nome]) => <option key={codigo} value={codigo}>{nome}</option>)}
    </select>
  </Label>;
}
function Painel({ nf, alteracoesPendentes }: { nf: NfEmissaoRow; alteracoesPendentes: boolean }) {
  const [ambiente, setAmbiente] = useState<AmbienteNfse>("homologacao");
  const configuracoes = useConfiguracaoNfse(nf.empresa_id);
  const configuracao = configuracoes.data?.find(c => c.ambiente === ambiente);
  const producao = ambiente === "producao";
  const rotuloAmbiente = producao ? "produção" : "homologação";
  const liberado = !producao || Boolean(configuracao?.habilitado && (!configuracao.nf_piloto_id || configuracao.nf_piloto_id === nf.id));
  const consulta = useSolicitacoesNfse(nf.id, ambiente);
  const solicitar = useSolicitarNfse(nf.id, ambiente);
  const reprocessar = useReprocessarNfse(nf.id);
  const [parametros, setParametros] = useState(() => parametrosIniciais(nf));
  const [editando, setEditando] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const exigeCodigoPrefeitura = producao && parametros.municipio_emissor === "4322004" && parametros.codigo_tributacao.replace(/[.\-/\s]/g, "") === "170501";
  const solicitacoes = consulta.data ?? [];
  const atual = solicitacoes[0];
  const existeAtiva = solicitacoes.some(s => s.estado !== "rejeitada");
  const salvarCampo = (campo: keyof ParametrosNfse, valor: string | boolean) => setParametros(p => ({ ...p, [campo]: valor, confirmacao_fiscal: campo === "confirmacao_fiscal" ? Boolean(valor) : false, confirmacao_producao: campo === "confirmacao_producao" ? Boolean(valor) : false }));
  const salvarTomador = (campo: keyof ParametrosNfse["tomador"], valor: string) => setParametros(p => ({ ...p, confirmacao_fiscal: false, confirmacao_producao: false, tomador: { ...p.tomador, [campo]: valor } }));
  const salvarImovel = (campo: keyof NonNullable<ParametrosNfse["imovel"]>, valor: string) => setParametros(p => ({ ...p, confirmacao_fiscal: false, confirmacao_producao: false, imovel: { cep: "", logradouro: "", numero: "", complemento: "", bairro: "", inscricao: "", ...p.imovel, [campo]: valor } }));
  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!parametros.confirmacao_fiscal || (producao && !parametros.confirmacao_producao) || !liberado || alteracoesPendentes) return;
    try { await solicitar.mutateAsync(validarParametrosNfse(parametros, ambiente)); setEditando(false); toast.success(`Solicitação de ${rotuloAmbiente} registrada. Use Atualizar para acompanhar.`); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Não foi possível registrar a solicitação."); }
  }
  async function documento(caminho: string) {
    setBaixando(true);
    try { await abrirDocumentoNfse(caminho); } catch { toast.error("Não foi possível obter o documento. Confira sua permissão de exportação."); }
    finally { setBaixando(false); }
  }
  async function retomar(id: string, descartar = false) {
    try { await reprocessar.mutateAsync({ id, descartar }); toast.success(descartar ? "Solicitação descartada antes do envio." : "Solicitação devolvida à fila."); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Não foi possível atualizar a solicitação."); }
  }
  function preparar(base = atual?.dados.parametros || parametrosIniciais(nf)) {
    setParametros({ ...base, serie: configuracao?.serie ? String(configuracao.serie) : base.serie,
      municipio_emissor: configuracao?.municipio_emissor || (producao ? "" : "3542404"),
      inscricao_municipal: configuracao?.inscricao_municipal || base.inscricao_municipal,
      confirmacao_fiscal: false, confirmacao_producao: false });
    setEditando(true);
  }
  async function corrigir(solicitacao: SolicitacaoNfse) {
    try {
      await reprocessar.mutateAsync({ id: solicitacao.id, descartar: true });
      preparar(solicitacao.dados.parametros);
      toast.success("Corrija os dados e revise antes de solicitar novamente. A tentativa anterior foi encerrada sem envio.");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Não foi possível abrir a correção."); }
  }
  return <section className="rounded-xl border bg-card p-4 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2"><h3 className="font-semibold">Emissão de NFS-e na prefeitura</h3><Badge variant={producao ? "destructive" : "outline"}>{producao ? "Produção — nota real" : "Homologação"}</Badge></div>
      <Button type="button" size="sm" variant="outline" onClick={() => void consulta.refetch()} disabled={consulta.isFetching}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button>
    </div>
    <Escolha titulo="Ambiente fiscal" valor={ambiente} alterar={v => { setAmbiente(v as AmbienteNfse); setEditando(false); setParametros(parametrosIniciais(nf)); }} opcoes={[["homologacao","Homologação — documentos de teste"],["producao","Produção — nota fiscal real"]]} />
    <p className="text-sm text-muted-foreground">{producao ? "A solicitação em produção gera uma nota fiscal real. Confira os dados antes de transmitir. O resultado oficial e os documentos serão exibidos abaixo." : "Homologação gera documentos de teste e não altera o número ou a conclusão interna da preparação."}</p>
    {producao && !liberado && <p role="status" className="text-sm text-muted-foreground">Emissão em produção ainda não liberada para esta empresa ou preparação.</p>}
    {consulta.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar as solicitações. Confira se a integração foi instalada e tente Atualizar.</p>}
    {solicitacoes.map(s => <div key={s.id} className="rounded-lg border p-3 space-y-2">
      <div className="flex flex-wrap justify-between gap-2"><Badge variant={s.estado === "erro" || s.estado === "rejeitada" ? "destructive" : "secondary"}>{s.estado === "autorizada" && producao ? "Autorizada em produção" : ESTADOS[s.estado]}</Badge>
        <span className="text-sm">DPS {s.numero_dps} / série {s.serie}{s.numero_nf ? ` · NFS-e ${s.numero_nf}` : ""}</span></div>
      {s.mensagem && <p className="text-sm whitespace-pre-wrap">{s.mensagem}</p>}
      <p className="text-xs text-muted-foreground">Atualizado em {new Date(s.atualizado_em).toLocaleString("pt-BR")}</p>
      <div className="flex flex-wrap gap-2">
        <AcessoGate menu="financeiro-nfse" acao="exportar">
          {s.xml_retorno_path && <Button type="button" variant="outline" size="sm" disabled={baixando} onClick={() => void documento(s.xml_retorno_path!)}><FileDown className="mr-2 h-4 w-4" />XML oficial</Button>}
          {s.pdf_path && <Button type="button" variant="outline" size="sm" disabled={baixando} onClick={() => void documento(s.pdf_path!)}><FileDown className="mr-2 h-4 w-4" />PDF oficial</Button>}
        </AcessoGate>
        <AcessoGate menu="financeiro-nfse" acao="alterar">
          {(((s.estado !== "erro" || s.envio_iniciado_em) && ["erro","incerta","aguardando","processando"].includes(s.estado)) || (s.estado === "autorizada" && !s.pdf_path)) && <Button type="button" size="sm" variant="outline" disabled={reprocessar.isPending} onClick={() => void retomar(s.id)}>{s.envio_iniciado_em ? "Reconsultar resultado" : "Retomar após correção"}</Button>}
          {!s.envio_iniciado_em && s.estado === "erro" && <AcessoGate menu="financeiro-nfse" acao="incluir"><Button type="button" size="sm" variant="outline" disabled={reprocessar.isPending || consulta.isFetching} onClick={() => void corrigir(s)}>Corrigir dados</Button></AcessoGate>}
          {!s.envio_iniciado_em && ["pendente","erro"].includes(s.estado) && <Button type="button" size="sm" variant="outline" disabled={reprocessar.isPending} onClick={() => void retomar(s.id,true)}>Descartar solicitação</Button>}
        </AcessoGate>
      </div>
    </div>)}
    {!existeAtiva && nf.status === "enviada" && !consulta.isError && !consulta.isLoading && liberado && <AcessoGate menu="financeiro-nfse" acao="incluir">
      <Button type="button" variant="outline" disabled={configuracoes.isLoading} onClick={() => { if (editando) setEditando(false); else preparar(); }}>
        <ChevronDown className="mr-2 h-4 w-4" />{editando ? `Fechar preparação de ${rotuloAmbiente}` : `Preparar emissão em ${rotuloAmbiente}`}
      </Button>
    </AcessoGate>}
    {editando && !existeAtiva && <AcessoGate menu="financeiro-nfse" acao="incluir"><form onSubmit={enviar} className="space-y-5">
      <div className="rounded-md bg-muted p-3 text-sm">Valores salvos: serviços <strong>{fmtMoney(nf.vlr_bruto_total)}</strong> · líquido <strong>{fmtMoney(nf.vlr_liquido_total)}</strong>. A integração utiliza esses valores e as retenções salvas da preparação.</div>
      {alteracoesPendentes && <p role="alert" className="text-sm text-destructive">Há valores alterados nesta conferência. Salve a preparação na tela de Emissão de NF antes de solicitar a integração.</p>}
      <fieldset className="grid gap-3 md:grid-cols-3"><legend className="mb-3 font-medium">Prestador e documento</legend>
        <Campo titulo="Série de DPS liberada para o ERP" valor={parametros.serie} alterar={v => salvarCampo("serie",v)} maximo={5} somenteLeitura={configuracao?.serie != null} />
        <Campo titulo="Inscrição municipal do prestador" valor={parametros.inscricao_municipal} alterar={v => salvarCampo("inscricao_municipal",v)} maximo={15} somenteLeitura={Boolean(configuracao?.inscricao_municipal)} />
        <Campo titulo={producao ? "Município emissor — código IBGE" : "Município emissor de testes — código IBGE"} valor={parametros.municipio_emissor} alterar={v => salvarCampo("municipio_emissor",v)} maximo={7} somenteLeitura={Boolean(configuracao?.municipio_emissor)} />
        <Escolha titulo="Simples Nacional na competência" valor={parametros.opcao_simples} alterar={v => salvarCampo("opcao_simples",v)} opcoes={[["1","Não optante"],["2","Optante — MEI"],["3","Optante — ME/EPP"]]} />
        <Escolha titulo="Regime especial de tributação" valor={parametros.regime_especial} alterar={v => salvarCampo("regime_especial",v)} opcoes={[["0","Nenhum"],["1","Ato cooperado"],["2","Estimativa"],["3","Microempresa municipal"],["4","Notário ou registrador"],["5","Profissional autônomo"],["6","Sociedade de profissionais"]]} />
        {parametros.opcao_simples === "3" && <Escolha titulo="Apuração do Simples Nacional" valor={parametros.regime_apuracao} alterar={v => salvarCampo("regime_apuracao",v)} opcoes={[["1","Federais e municipal pelo SN"],["2","Federais pelo SN, ISS fora do SN"],["3","Federais e municipal fora do SN"]]} />}
      </fieldset>
      <fieldset className="grid gap-3 md:grid-cols-3"><legend className="mb-3 font-medium">Tomador</legend>
        <Campo titulo="CPF/CNPJ" valor={parametros.tomador.documento} alterar={v => salvarTomador("documento",v)} maximo={18} />
        <Campo titulo="Nome / razão social" valor={parametros.tomador.nome} alterar={v => salvarTomador("nome",v)} maximo={150} />
        <Campo titulo="Município — código IBGE" valor={parametros.tomador.municipio} alterar={v => salvarTomador("municipio",v)} maximo={7} />
        <Campo titulo="CEP" valor={parametros.tomador.cep} alterar={v => salvarTomador("cep",v)} maximo={9} />
        <Campo titulo="Logradouro" valor={parametros.tomador.logradouro} alterar={v => salvarTomador("logradouro",v)} maximo={255} />
        <Campo titulo="Número" valor={parametros.tomador.numero} alterar={v => salvarTomador("numero",v)} maximo={60} />
        <Campo titulo="Bairro" valor={parametros.tomador.bairro} alterar={v => salvarTomador("bairro",v)} maximo={60} />
        <Campo titulo="Complemento" valor={parametros.tomador.complemento} alterar={v => salvarTomador("complemento",v)} obrigatorio={false} maximo={156} />
        <Campo titulo="E-mail" valor={parametros.tomador.email} alterar={v => salvarTomador("email",v)} obrigatorio={false} tipo="email" maximo={80} />
      </fieldset>
      <fieldset className="grid gap-3 md:grid-cols-3"><legend className="mb-3 font-medium">Serviço e retenções</legend>
        <Campo titulo="Código nacional do serviço" valor={parametros.codigo_tributacao} alterar={v => salvarCampo("codigo_tributacao",v)} maximo={8} />
        <Campo titulo="NBS" valor={parametros.codigo_nbs} alterar={v => salvarCampo("codigo_nbs",v)} maximo={13} />
        <Campo titulo="Código do serviço na prefeitura" valor={parametros.codigo_integracao_municipal ?? ""} alterar={v => salvarCampo("codigo_integracao_municipal",v)} obrigatorio={exigeCodigoPrefeitura} maximo={20} />
        <p className="text-sm text-muted-foreground md:col-span-3">Informe o código municipal usado no portal para esta prestação, conforme o responsável fiscal. Quando a prefeitura indicar mais de um serviço possível, esse código identifica qual deve ser utilizado.</p>
        <Campo titulo="Desdobramento municipal, se aplicável" valor={parametros.codigo_municipal} alterar={v => salvarCampo("codigo_municipal",v)} obrigatorio={false} maximo={3} />
        <Campo titulo="Local da prestação — código IBGE" valor={parametros.local_prestacao} alterar={v => salvarCampo("local_prestacao",v)} maximo={7} />
        <Campo titulo="Alíquota do ISS (%)" valor={parametros.aliquota_iss} alterar={v => salvarCampo("aliquota_iss",v)} tipo="number" />
        <Escolha titulo="Retenção do ISS" valor={parametros.iss_retido} alterar={v => salvarCampo("iss_retido",v)} opcoes={[["1","Não retido"],["2","Retido pelo tomador"]]} />
        {(Number(nf.pis_total) + Number(nf.cofins_total)) > 0 && <>
          <Campo titulo="CST de PIS/COFINS" valor={parametros.cst_pis_cofins} alterar={v => salvarCampo("cst_pis_cofins",v)} maximo={2} />
          <Escolha titulo="Contribuições retidas" valor={parametros.retencao_pis_cofins} alterar={v => salvarCampo("retencao_pis_cofins",v)} opcoes={[["1","PIS/COFINS retidos"],["3","PIS/COFINS/CSLL retidos"],["4","PIS/COFINS retidos, CSLL não retido"]]} />
        </>}
        <Label className="grid gap-2 md:col-span-3">Descrição do serviço<Textarea required maxLength={2000} rows={4} value={parametros.descricao} onChange={e => salvarCampo("descricao",e.target.value)} /></Label>
      </fieldset>
      <fieldset className="grid gap-3 md:grid-cols-3"><legend className="mb-3 font-medium">IBS/CBS e tributos aproximados — revisar com o responsável fiscal</legend>
        <Campo titulo="CST de IBS/CBS" valor={parametros.ibs_cst} alterar={v => salvarCampo("ibs_cst",v)} maximo={3} />
        <Campo titulo="Classificação tributária de IBS/CBS" valor={parametros.ibs_classificacao} alterar={v => salvarCampo("ibs_classificacao",v)} maximo={6} />
        <Campo titulo="Indicador da operação" valor={parametros.ibs_indicador_operacao} alterar={v => salvarCampo("ibs_indicador_operacao",v)} maximo={6} />
        <Escolha titulo="Consumidor final" valor={parametros.consumidor_final} alterar={v => salvarCampo("consumidor_final",v)} opcoes={[["0","Não"],["1","Sim"]]} />
        <Campo titulo="Tipo de operação, se aplicável" valor={parametros.tipo_operacao} alterar={v => salvarCampo("tipo_operacao",v)} obrigatorio={false} maximo={1} />
        <Campo titulo="Tipo de ente governamental, se aplicável" valor={parametros.tipo_ente_governamental} alterar={v => salvarCampo("tipo_ente_governamental",v)} obrigatorio={false} maximo={1} />
        <Campo titulo="Tributos aproximados federais (R$)" valor={parametros.tributos_aproximados_federais} alterar={v => salvarCampo("tributos_aproximados_federais",v)} tipo="number" />
        <Campo titulo="Tributos aproximados estaduais (R$)" valor={parametros.tributos_aproximados_estaduais} alterar={v => salvarCampo("tributos_aproximados_estaduais",v)} tipo="number" />
        <Campo titulo="Tributos aproximados municipais (R$)" valor={parametros.tributos_aproximados_municipais} alterar={v => salvarCampo("tributos_aproximados_municipais",v)} tipo="number" />
      </fieldset>
      <fieldset className="space-y-3"><legend className="mb-3 font-medium">Imóvel da prestação — IBS/CBS</legend>
        <Label className="flex items-start gap-3 font-normal"><Checkbox checked={parametros.informar_imovel === true} onCheckedChange={v => salvarCampo("informar_imovel",v === true)} /><span>Informar o imóvel onde o serviço foi executado, quando exigido pelo indicador da operação.</span></Label>
        {parametros.informar_imovel && <div className="grid gap-3 md:grid-cols-3">
          <Campo titulo="CEP do imóvel" valor={parametros.imovel?.cep ?? ""} alterar={v => salvarImovel("cep",v)} maximo={9} />
          <Campo titulo="Logradouro do imóvel" valor={parametros.imovel?.logradouro ?? ""} alterar={v => salvarImovel("logradouro",v)} maximo={255} />
          <Campo titulo="Número do imóvel" valor={parametros.imovel?.numero ?? ""} alterar={v => salvarImovel("numero",v)} maximo={60} />
          <Campo titulo="Bairro do imóvel" valor={parametros.imovel?.bairro ?? ""} alterar={v => salvarImovel("bairro",v)} maximo={60} />
          <Campo titulo="Complemento do imóvel" valor={parametros.imovel?.complemento ?? ""} alterar={v => salvarImovel("complemento",v)} obrigatorio={false} maximo={156} />
          <Campo titulo="Inscrição imobiliária, se houver" valor={parametros.imovel?.inscricao ?? ""} alterar={v => salvarImovel("inscricao",v)} obrigatorio={false} maximo={30} />
        </div>}
      </fieldset>
      <Label className="flex items-start gap-3 font-normal"><Checkbox checked={parametros.confirmacao_fiscal} onCheckedChange={v => salvarCampo("confirmacao_fiscal",v === true)} /><span>Revisei os dados fiscais, as retenções e a série liberada.</span></Label>
      {producao && <Label className="flex items-start gap-3 font-normal"><Checkbox checked={parametros.confirmacao_producao === true} onCheckedChange={v => setParametros(p => ({ ...p, confirmacao_producao: v === true }))} /><span>Autorizo a emissão de uma nota fiscal real em produção para esta preparação.</span></Label>}
      <Button type="submit" disabled={solicitar.isPending || !parametros.confirmacao_fiscal || (producao && !parametros.confirmacao_producao) || !liberado || alteracoesPendentes}><Send className="mr-2 h-4 w-4" />{solicitar.isPending ? "Registrando..." : `Solicitar emissão em ${rotuloAmbiente}`}</Button>
    </form></AcessoGate>}
  </section>;
}
export function NfseIntegracaoPainel(props: { nf: NfEmissaoRow; alteracoesPendentes: boolean }) {
  return <AcessoGate menu="financeiro-nfse" acao="visualizar"><Painel key={props.nf.id} {...props} /></AcessoGate>;
}
