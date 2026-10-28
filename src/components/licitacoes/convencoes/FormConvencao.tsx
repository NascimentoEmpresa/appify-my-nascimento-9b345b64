import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarDays, FileText, Loader2, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { useContratosERP } from "@/hooks/useContratosERP";
import {
  BUCKET_CONVENCOES, abrirAnexoConvencao, enviarAnexoConvencao, useSalvarConvencao,
  usePostosDoContrato, useSincronizarPostosConvencao, useVinculosPosto,
  type Convencao, type ConvencaoInput,
} from "@/hooks/useConvencoes";
import { supabase } from "@/integrations/supabase/client";
import {
  BENEFICIOS, identificacaoCct, pendenciasConvencao, periodoEfetivo,
  type DefBeneficio, type MapaBeneficios, type Periodo, type ValorBeneficio,
} from "@/lib/licitacoes/convencoes";
import { IconeBeneficio } from "./IconeBeneficio";

// Cadastrar / Editar Convenção Coletiva (layout de referência do chamado):
// 1. Informações do Contrato · 2. Decreto Municipal (se aplicável) ·
// 3. Benefícios do Contrato. Salvar com pendência é permitido — o cadastro
// fica "Pendente" e a lista avisa; o que não pode é vazio virar "Não contém".

interface Anexo { path: string | null; nome: string | null; tamanho: number | null; novo?: File | null }

const ANEXO_VAZIO: Anexo = { path: null, nome: null, tamanho: null, novo: null };
const MB = (n: number | null | undefined) => (n ? `${(n / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : "");

function Secao({ n, titulo, children }: { n: number; titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2.5 text-[15px] font-bold text-[#0f3171] dark:text-blue-300">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white">{n}</span>
        {titulo}
      </h3>
      {children}
    </section>
  );
}

function Campo({ label, obrigatorio, children, className }: { label: string; obrigatorio?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <label className="text-xs font-medium text-foreground">{label}{obrigatorio && <span className="text-red-600"> *</span>}</label>
      {children}
    </div>
  );
}

function CampoAnexo({ anexo, onEscolher, onRemover, somenteLeitura, rotulo }: {
  anexo: Anexo; onEscolher: (f: File) => void; onRemover: () => void; somenteLeitura?: boolean; rotulo: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const nome = anexo.novo?.name ?? anexo.nome;
  const tamanho = anexo.novo?.size ?? anexo.tamanho;
  if (!nome) {
    return somenteLeitura
      ? <p className="flex h-[52px] items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">Sem anexo</p>
      : (
        <>
          <button type="button" onClick={() => input.current?.click()}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-md border border-dashed text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary">
            <Upload className="h-4 w-4" /> Anexar {rotulo} (PDF)
          </button>
          <input ref={input} type="file" accept=".pdf,image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onEscolher(f); e.target.value = ""; }} />
        </>
      );
  }
  return (
    <div className="flex h-[52px] items-center gap-2.5 rounded-md border px-3">
      <span className="flex h-8 w-8 items-center justify-center rounded bg-red-50 text-red-600 dark:bg-red-950/40"><FileText className="h-4 w-4" /></span>
      <button type="button" disabled={!anexo.path} onClick={() => anexo.path && abrirAnexoConvencao(anexo.path).then((e) => e && toast.error(e))}
        className="min-w-0 flex-1 text-left disabled:cursor-default" title={anexo.path ? "Abrir o arquivo" : "Será enviado ao salvar"}>
        <p className="truncate text-xs font-medium text-foreground">{nome}</p>
        <p className="text-[11px] text-muted-foreground">{MB(tamanho)}{anexo.novo ? " · envia ao salvar" : ""}</p>
      </button>
      {!somenteLeitura && (
        <button type="button" onClick={onRemover} title="Remover anexo" className="rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

const PERIODO_LABEL: Record<Periodo, string> = { dia: "Por dia", mes: "Por mês" };

/** Uma linha da tabela de benefícios (Benefício | Valor | Tipo | Não contém). */
function LinhaBeneficio({ def, v, onChange, somenteLeitura }: {
  def: DefBeneficio; v: ValorBeneficio; onChange: (v: ValorBeneficio) => void; somenteLeitura?: boolean;
}) {
  const off = somenteLeitura || !!v.nao_contem;
  const set = (p: Partial<ValorBeneficio>) => onChange({ ...v, ...p });
  const periodo = (
    def.periodos && def.periodos.length > 1 ? (
      <Select value={v.periodo ?? ""} onValueChange={(p) => set({ periodo: p as Periodo })} disabled={off}>
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
        <SelectContent>{def.periodos.map((p) => <SelectItem key={p} value={p}>{PERIODO_LABEL[p]}</SelectItem>)}</SelectContent>
      </Select>
    ) : (
      <div className="flex h-8 items-center rounded-md border bg-muted/40 px-3 text-xs text-muted-foreground">{PERIODO_LABEL[periodoEfetivo(def, v) ?? "mes"]}</div>
    )
  );
  const percentual = (opcoes: number[]) => (
    <Select value={v.percentual ? String(v.percentual) : ""} onValueChange={(p) => set({ percentual: Number(p) })} disabled={off}>
      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
      <SelectContent>{opcoes.map((p) => <SelectItem key={p} value={String(p)}>{p}%</SelectItem>)}</SelectContent>
    </Select>
  );
  const valor = (
    <CurrencyInput value={v.valor ? String(v.valor) : ""} onChange={(s) => set({ valor: s ? Number(s) : null })}
      disabled={off} className="h-8 text-xs" />
  );

  let colunas: ReactNode;
  if (def.tipo === "percentual") {
    colunas = <div className="col-span-2">{percentual(def.percentuais ?? [])}</div>;
  } else if (def.tipo === "lider") {
    colunas = (
      <>
        <div className="flex gap-1.5">
          <Select value={v.modo ?? ""} onValueChange={(m) => set({ modo: m as ValorBeneficio["modo"], valor: null, percentual: null })} disabled={off}>
            <SelectTrigger className="h-8 w-[96px] shrink-0 text-xs"><SelectValue placeholder="Modo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="valor">Valor</SelectItem>
              <SelectItem value="porcentagem">Porcentagem</SelectItem>
            </SelectContent>
          </Select>
          <div className="min-w-0 flex-1">
            {v.modo === "porcentagem" ? percentual(def.percentuais ?? []) : v.modo === "valor" ? valor
              : <div className="flex h-8 items-center rounded-md border bg-muted/40 px-2 text-[11px] text-muted-foreground">Escolha o modo</div>}
          </div>
        </div>
        {periodo}
      </>
    );
  } else {
    colunas = <>{valor}{periodo}</>;
  }

  return (
    <div className={cn("grid grid-cols-[minmax(150px,1.2fr)_minmax(150px,1fr)_minmax(120px,0.8fr)_64px] items-center gap-2 py-1", v.nao_contem && "opacity-70")}>
      <div className="flex items-center gap-2 text-xs font-medium text-foreground">
        <IconeBeneficio chave={def.chave} tamanho="sm" />{def.nome}
      </div>
      {colunas}
      <div className="flex justify-center">
        <Checkbox checked={!!v.nao_contem} disabled={somenteLeitura} aria-label={`${def.nome}: não contém`}
          onCheckedChange={(c) => onChange(c ? { nao_contem: true } : { nao_contem: false })} />
      </div>
    </div>
  );
}

export function FormConvencao({ aberto, onFechar, convencao, somenteLeitura, existentes }: {
  aberto: boolean;
  onFechar: () => void;
  /** null = nova. */
  convencao: Convencao | null;
  somenteLeitura?: boolean;
  /** Para sugerir categoria e sindicato já usados. */
  existentes: Convencao[];
}) {
  const salvar = useSalvarConvencao();
  const sincronizarPostos = useSincronizarPostosConvencao();
  const { data: vinculos } = useVinculosPosto();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosERP({ todasEmpresas: true });

  const [empresaId, setEmpresaId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [categoria, setCategoria] = useState("");
  const [sindicato, setSindicato] = useState("");
  const [vigIni, setVigIni] = useState("");
  const [vigFim, setVigFim] = useState("");
  const [cct, setCct] = useState<Anexo>(ANEXO_VAZIO);
  const [decretoNum, setDecretoNum] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [decreto, setDecreto] = useState<Anexo>(ANEXO_VAZIO);
  const [beneficios, setBeneficios] = useState<MapaBeneficios>({});
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  // Postos do contrato que seguem esta convenção (vínculo da Planilha de Custo,
  // gravado pelos dois lados — mig 20261028000910).
  const postosQ = usePostosDoContrato(contratoId || null);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [buscaPosto, setBuscaPosto] = useState("");
  const marcadosDe = useRef<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    const c = convencao;
    setEmpresaId(c?.empresa_id ?? "");
    setContratoId(c?.contrato_id ?? "");
    setCategoria(c?.categoria_profissional ?? "");
    setSindicato(c?.sindicato ?? "");
    setVigIni(c?.vigencia_inicio ?? "");
    setVigFim(c?.vigencia_fim ?? "");
    setCct(c ? { path: c.cct_arquivo_path, nome: c.cct_arquivo_nome, tamanho: c.cct_arquivo_tamanho } : ANEXO_VAZIO);
    setDecretoNum(c?.decreto_numero ?? "");
    setMunicipio(c?.municipio ?? "");
    setDecreto(c ? { path: c.decreto_arquivo_path, nome: c.decreto_arquivo_nome, tamanho: c.decreto_arquivo_tamanho } : ANEXO_VAZIO);
    setBeneficios(c?.beneficios ?? {});
    setObs(c?.observacoes ?? "");
    setMarcados([]);
    setBuscaPosto("");
    marcadosDe.current = null;
  }, [aberto, convencao]);

  // Marca uma vez por contrato aberto o que já segue esta convenção — sem
  // atropelar o que a pessoa marcou quando a lista recarrega.
  useEffect(() => {
    if (!aberto || !contratoId || !postosQ.data || marcadosDe.current === contratoId) return;
    marcadosDe.current = contratoId;
    setMarcados(convencao ? postosQ.data.filter((p) => p.convencao_id === convencao.id).map((p) => p.posto) : []);
  }, [aberto, contratoId, postosQ.data, convencao]);

  const convencoesPorId = useMemo(() => new Map(existentes.map((e) => [e.id, e])), [existentes]);
  const postosVisiveis = useMemo(() => {
    const q = buscaPosto.trim().toLowerCase();
    return (postosQ.data ?? []).filter((p) => !q || p.posto.toLowerCase().includes(q));
  }, [postosQ.data, buscaPosto]);
  const alternarPosto = (posto: string, marcar: boolean) =>
    setMarcados((m) => (marcar ? [...m.filter((x) => x !== posto), posto] : m.filter((x) => x !== posto)));

  const opcoesContrato = useMemo(() => contratos
    .filter((c) => !empresaId || c.empresa_id === empresaId)
    .map((c) => ({ value: c.id, label: c.nome, hint: c.cliente, muted: c.status !== "ativo" })), [contratos, empresaId]);
  const sugestoes = (campo: "categoria_profissional" | "sindicato") =>
    Array.from(new Set(existentes.map((e) => e[campo]).filter(Boolean) as string[])).sort();

  // Pendências do que está na tela (anexo novo conta como anexado).
  const pendencias = pendenciasConvencao({
    empresa_id: empresaId, contrato_id: contratoId, categoria_profissional: categoria, sindicato,
    vigencia_inicio: vigIni, vigencia_fim: vigFim,
    cct_arquivo_path: cct.path || (cct.novo ? "novo" : null),
    decreto_numero: decretoNum, decreto_arquivo_path: decreto.path || (decreto.novo ? "novo" : null),
    beneficios,
  });

  const removerDoStorage = async (paths: (string | null | undefined)[]) => {
    const p = paths.filter(Boolean) as string[];
    if (p.length) await supabase.storage.from(BUCKET_CONVENCOES).remove(p);
  };

  const confirmar = async () => {
    if (!empresaId || !contratoId) { toast.error("Escolha a empresa e o contrato."); return; }
    if (vigIni && vigFim && vigFim < vigIni) { toast.error("A vigência termina antes de começar."); return; }
    setEnviando(true);
    try {
      const subir = async (a: Anexo, tipo: "cct" | "decreto"): Promise<Anexo> =>
        a.novo ? { ...(await enviarAnexoConvencao(contratoId, tipo, a.novo)), novo: null } : a;
      const cctFinal = await subir(cct, "cct");
      const decFinal = await subir(decreto, "decreto");
      const input: ConvencaoInput & { id?: string } = {
        id: convencao?.id,
        empresa_id: empresaId, contrato_id: contratoId,
        identificacao: convencao?.identificacao ?? null,
        categoria_profissional: categoria.trim() || null, sindicato: sindicato.trim() || null,
        municipio: municipio.trim() || null,
        vigencia_inicio: vigIni || null, vigencia_fim: vigFim || null,
        cct_arquivo_path: cctFinal.path, cct_arquivo_nome: cctFinal.nome, cct_arquivo_tamanho: cctFinal.tamanho,
        decreto_numero: decretoNum.trim() || null,
        decreto_arquivo_path: decFinal.path, decreto_arquivo_nome: decFinal.nome, decreto_arquivo_tamanho: decFinal.tamanho,
        beneficios, observacoes: obs.trim() || null,
      };
      const id = await salvar.mutateAsync(input);
      // Arquivo trocado ou removido: o antigo sai do storage depois do save
      // (a versão anterior da convenção guarda só o caminho).
      if (convencao) {
        await removerDoStorage([
          convencao.cct_arquivo_path !== cctFinal.path ? convencao.cct_arquivo_path : null,
          convencao.decreto_arquivo_path !== decFinal.path ? convencao.decreto_arquivo_path : null,
        ]).catch(() => undefined);
      }
      // Só sincroniza com a lista de postos carregada: lista que falhou não
      // pode virar "desmarcou tudo" e apagar vínculos.
      if (postosQ.data) {
        try {
          await sincronizarPostos.mutateAsync({ convencaoId: id, contratoId, listados: postosQ.data.map((p) => p.posto), marcados, vinculos });
        } catch (e) {
          toast.error("Convenção salva, mas o vínculo dos postos não: " + (e instanceof Error ? e.message : String(e)));
          onFechar();
          return;
        }
      }
      toast.success(pendencias.length ? "Salvo — o cadastro segue Pendente até completar o que falta." : "Convenção salva.");
      onFechar();
    } catch (e) {
      toast.error("Não foi possível salvar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Sheet open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[600px]">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4" />
            {somenteLeitura ? "Convenção Coletiva" : convencao ? "Editar Convenção Coletiva" : "Cadastrar Convenção Coletiva"}
            {convencao && <span className="text-xs font-normal text-muted-foreground">· versão {convencao.versao}</span>}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <Secao n={1} titulo="Informações do Contrato">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Empresa" obrigatorio>
                <Select value={empresaId} onValueChange={(v) => { setEmpresaId(v); setContratoId(""); }} disabled={somenteLeitura}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}</SelectContent>
                </Select>
              </Campo>
              <Campo label="Contrato" obrigatorio>
                <SearchableSelect value={contratoId} onChange={(v) => {
                  setContratoId(v);
                  const c = contratos.find((x) => x.id === v);
                  if (c && !empresaId) setEmpresaId(c.empresa_id);
                }} options={opcoesContrato} placeholder="Selecione" searchPlaceholder="Buscar contrato…" disabled={somenteLeitura} triggerClassName="h-9" />
              </Campo>
              <Campo label="Categoria Profissional" obrigatorio>
                <Input list="conv-categorias" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ex.: Limpeza e Conservação" disabled={somenteLeitura} className="h-9" />
                <datalist id="conv-categorias">{sugestoes("categoria_profissional").map((s) => <option key={s} value={s} />)}</datalist>
              </Campo>
              <Campo label="Sindicato" obrigatorio>
                <Input list="conv-sindicatos" value={sindicato} onChange={(e) => setSindicato(e.target.value)} placeholder="Ex.: Sindilimp RS" disabled={somenteLeitura} className="h-9" />
                <datalist id="conv-sindicatos">{sugestoes("sindicato").map((s) => <option key={s} value={s} />)}</datalist>
              </Campo>
              {/* Vigência e anexo em linha inteira (28/10/2026): duas datas
                  numa meia coluna de 600px não cabem — o input de data tem
                  largura mínima própria (~126px com o ícone) e a segunda
                  passava por cima do campo de anexo ao lado. */}
              <Campo label="Vigência da CCT" obrigatorio className="min-w-0 sm:col-span-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Input type="date" value={vigIni} onChange={(e) => setVigIni(e.target.value)} disabled={somenteLeitura} className="h-9 min-w-0 flex-1" />
                  <span className="shrink-0 text-xs text-muted-foreground">a</span>
                  <Input type="date" value={vigFim} onChange={(e) => setVigFim(e.target.value)} disabled={somenteLeitura} className="h-9 min-w-0 flex-1" />
                </div>
              </Campo>
              <Campo label="Anexo da Convenção Coletiva" obrigatorio className="min-w-0 sm:col-span-2">
                <CampoAnexo anexo={cct} rotulo="a convenção" somenteLeitura={somenteLeitura}
                  onEscolher={(f) => setCct((a) => ({ ...a, novo: f }))}
                  onRemover={() => setCct(ANEXO_VAZIO)} />
              </Campo>
            </div>
          </Secao>

          <Secao n={2} titulo="Decreto Municipal (se aplicável)">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Decreto Municipal">
                <Input value={decretoNum} onChange={(e) => setDecretoNum(e.target.value)} placeholder="Ex.: Decreto 12.345/2024" disabled={somenteLeitura} className="h-9" />
              </Campo>
              <Campo label="Anexo do Decreto">
                <CampoAnexo anexo={decreto} rotulo="o decreto" somenteLeitura={somenteLeitura}
                  onEscolher={(f) => setDecreto((a) => ({ ...a, novo: f }))}
                  onRemover={() => setDecreto(ANEXO_VAZIO)} />
              </Campo>
              <Campo label="Município">
                <Input value={municipio} onChange={(e) => setMunicipio(e.target.value)} placeholder="Quando aplicável" disabled={somenteLeitura} className="h-9" />
              </Campo>
            </div>
          </Secao>

          <Secao n={3} titulo="Benefícios do Contrato">
            <div className="overflow-x-auto">
              <div className="min-w-[520px]">
                <div className="grid grid-cols-[minmax(150px,1.2fr)_minmax(150px,1fr)_minmax(120px,0.8fr)_64px] gap-2 pb-1 text-xs font-medium text-muted-foreground">
                  <span>Benefício</span><span>Valor</span><span>Tipo</span><span className="text-center">Não contém</span>
                </div>
                {BENEFICIOS.map((def) => (
                  <LinhaBeneficio key={def.chave} def={def} v={beneficios[def.chave] ?? {}} somenteLeitura={somenteLeitura}
                    onChange={(v) => setBeneficios((b) => ({ ...b, [def.chave]: v }))} />
                ))}
              </div>
            </div>
            <Campo label="Observações">
              <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} placeholder="Digite observações, se necessário…" disabled={somenteLeitura} />
            </Campo>
            {pendencias.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />Pendências ({pendencias.length}) — o cadastro fica como Pendente</p>
                <ul className="list-disc space-y-0.5 pl-5">{pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
              </div>
            )}
          </Secao>

          <Secao n={4} titulo="Postos que seguem esta convenção">
            {!contratoId ? (
              <p className="text-xs text-muted-foreground">Escolha o contrato para listar os postos dele na Planilha de Custo.</p>
            ) : postosQ.isLoading ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Carregando os postos do contrato…</p>
            ) : postosQ.isError ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                Não foi possível listar os postos agora. O vínculo também pode ser feito na Planilha de Custo, na coluna CCT do posto.
              </p>
            ) : !postosQ.data?.length ? (
              <p className="text-xs text-muted-foreground">Este contrato ainda não tem postos na Planilha de Custo.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Os postos marcados puxam os benefícios desta convenção (Planilha de Custo e Abertura de Vagas).
                  {" "}{marcados.length} de {postosQ.data.length} marcado(s).
                </p>
                <div className="flex items-center gap-2">
                  {postosQ.data.length > 8 && (
                    <Input value={buscaPosto} onChange={(e) => setBuscaPosto(e.target.value)} placeholder="Buscar posto…" className="h-8 text-xs" />
                  )}
                  {!somenteLeitura && (
                    <div className="flex shrink-0 gap-2 text-xs">
                      <button type="button" className="font-medium text-blue-700 hover:underline dark:text-blue-300"
                        onClick={() => setMarcados((m) => Array.from(new Set([...m, ...postosVisiveis.map((p) => p.posto)])))}>Marcar todos</button>
                      <button type="button" className="font-medium text-muted-foreground hover:underline"
                        onClick={() => setMarcados((m) => m.filter((x) => !postosVisiveis.some((p) => p.posto === x)))}>Desmarcar</button>
                    </div>
                  )}
                </div>
                <div className="max-h-64 divide-y overflow-y-auto rounded-md border">
                  {postosVisiveis.map((p) => {
                    const marcado = marcados.includes(p.posto);
                    const outra = p.convencao_id && p.convencao_id !== convencao?.id ? convencoesPorId.get(p.convencao_id) : null;
                    return (
                      <label key={p.posto} className={cn("flex items-center gap-2.5 px-3 py-2 text-xs", !somenteLeitura && "cursor-pointer hover:bg-muted/40")}>
                        <Checkbox checked={marcado} disabled={somenteLeitura} onCheckedChange={(c) => alternarPosto(p.posto, !!c)} />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-foreground">{p.posto}</span>
                          <span className="text-muted-foreground"> · {p.pessoas} pessoa(s)</span>
                          {p.convencao_id && p.convencao_id !== convencao?.id && (
                            <span className={cn("block text-[11px]", marcado ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                              {marcado ? "Vai trocar de convenção — hoje segue " : "Segue "}
                              {(outra && (identificacaoCct(outra) || outra.decreto_numero || outra.sindicato)) || "outra convenção"}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </Secao>
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" onClick={onFechar} disabled={enviando}>
            {somenteLeitura ? <><X className="mr-1 h-4 w-4" />Fechar</> : "Cancelar"}
          </Button>
          {!somenteLeitura && (
            <Button onClick={confirmar} disabled={enviando} className="min-w-[96px] bg-[#0f3171] hover:bg-[#0c2860]">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
