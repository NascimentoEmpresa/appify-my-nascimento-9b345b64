import { useEffect, useMemo, useRef, useState } from "react";
import {
  Cable,
  Camera,
  CheckCircle2,
  Clock,
  Cpu,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Network,
  Paperclip,
  Search,
  ShieldAlert,
  Trash2,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { cn } from "@/lib/utils";
import {
  useAnexosAtivoTi,
  useAnotarEventoTi,
  useColaboradoresTi,
  useEnviarAnexoTi,
  useEventosAtivoTi,
  urlAnexoTi,
  type TiAtivo,
  type TiAtivoInput,
  type TiPlanta,
} from "@/hooks/useTiMapa";
import { CRITICIDADES, STATUS_ATIVO, TIPOS_ATIVO, statusAtivo, tipoAtivo } from "./catalogo";

/**
 * Ficha do equipamento — o cadastro "por completo" que o mapa promete.
 *
 * Cinco abas porque são cinco assuntos com donos diferentes: quem é a
 * máquina, do que ela é feita, como ela fala com a rede, de quem ela é (e
 * quanto custou) e o que já aconteceu com ela. Espremer tudo num formulário
 * só transformaria o cadastro de um monitor — que usa quatro campos — num
 * paredão de 60 caixas vazias.
 *
 * O bloco de suporte remoto vive atrás de <AcessoGate menu="ti_ativo_sensivel">.
 * É gate de INTERFACE (a RLS entrega a linha inteira a quem tem `visualizar`)
 * — está documentado assim na migration, e é por isso que senha nenhuma mora
 * nessas colunas.
 */

const VAZIO: TiAtivoInput = { nome: "", tipo: "desktop", status: "em_uso", criticidade: "media" };

interface Props {
  aberto: boolean;
  onFechar: () => void;
  ativo: TiAtivo | null;
  plantas: TiPlanta[];
  ativos: TiAtivo[];
  podeEditar: boolean;
  podeExcluir: boolean;
  salvando: boolean;
  onSalvar: (dados: TiAtivoInput & { id?: string }) => void;
  onExcluir: (id: string) => void;
}

export function AtivoDialog({
  aberto,
  onFechar,
  ativo,
  plantas,
  ativos,
  podeEditar,
  podeExcluir,
  salvando,
  onSalvar,
  onExcluir,
}: Props) {
  const [form, setForm] = useState<TiAtivoInput>(VAZIO);
  const [aba, setAba] = useState("identificacao");

  useEffect(() => {
    if (!aberto) return;
    setAba("identificacao");
    setForm(ativo ? ({ ...ativo } as TiAtivoInput) : { ...VAZIO });
  }, [aberto, ativo]);

  const set = <K extends keyof TiAtivoInput>(campo: K, valor: TiAtivoInput[K]) =>
    setForm((f) => ({ ...f, [campo]: valor }));

  const def = tipoAtivo(form.tipo);
  const Icone = def.icone;
  const st = statusAtivo(form.status ?? "em_uso");
  const ehComputador = ["desktop", "notebook", "servidor"].includes(form.tipo ?? "");

  const submeter = () => {
    if (!form.nome?.trim()) return;
    onSalvar({ ...form, id: ativo?.id });
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-4xl gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-0 border-b p-5">
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white shadow"
              style={{ background: form.cor || def.cor }}
            >
              <Icone className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-lg">
                {ativo ? ativo.nome : "Novo equipamento"}
              </DialogTitle>
              <DialogDescription className="flex items-center gap-2 text-xs">
                {ativo?.codigo && <span className="font-mono font-semibold">{ativo.codigo}</span>}
                <span>{def.label}</span>
                <Badge
                  variant="outline"
                  className="border-0 text-white"
                  style={{ background: st.cor }}
                >
                  {st.label}
                </Badge>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={aba} onValueChange={setAba} className="flex min-h-0 flex-col">
          <TabsList className="mx-5 mt-4 grid w-auto grid-cols-5">
            <TabsTrigger value="identificacao" className="gap-1.5 text-xs">
              <Cpu className="h-3.5 w-3.5" /> Identificação
            </TabsTrigger>
            <TabsTrigger value="config" className="gap-1.5 text-xs">
              <HardDrive className="h-3.5 w-3.5" /> Configuração
            </TabsTrigger>
            <TabsTrigger value="rede" className="gap-1.5 text-xs">
              <Network className="h-3.5 w-3.5" /> Rede
            </TabsTrigger>
            <TabsTrigger value="gestao" className="gap-1.5 text-xs">
              <User className="h-3.5 w-3.5" /> Gestão
            </TabsTrigger>
            <TabsTrigger value="historico" className="gap-1.5 text-xs" disabled={!ativo}>
              <Clock className="h-3.5 w-3.5" /> Histórico
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="max-h-[58vh] flex-1 px-5 py-4">
            {/* ── Identificação ─────────────────────────────────────── */}
            <TabsContent value="identificacao" className="mt-0 space-y-4">
              <Grade>
                <Campo label="Nome / etiqueta" obrigatorio className="sm:col-span-2">
                  <Input
                    value={form.nome ?? ""}
                    onChange={(e) => set("nome", e.target.value)}
                    placeholder="PC-RECEPCAO-01"
                    disabled={!podeEditar}
                  />
                </Campo>
                <Campo label="Tipo">
                  <Select value={form.tipo} onValueChange={(v) => set("tipo", v)} disabled={!podeEditar}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIPOS_ATIVO.map((t) => (
                        <SelectItem key={t.valor} value={t.valor}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
                <Campo label="Status">
                  <Select
                    value={form.status ?? "em_uso"}
                    onValueChange={(v) => set("status", v as TiAtivo["status"])}
                    disabled={!podeEditar}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_ATIVO.map((s) => (
                        <SelectItem key={s.valor} value={s.valor}>
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ background: s.cor }} />
                            {s.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
                <Campo label="Patrimônio">
                  <Input value={form.patrimonio ?? ""} onChange={(e) => set("patrimonio", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Hostname">
                  <Input value={form.hostname ?? ""} onChange={(e) => set("hostname", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Marca">
                  <Input value={form.marca ?? ""} onChange={(e) => set("marca", e.target.value)} placeholder="Dell, Lenovo…" disabled={!podeEditar} />
                </Campo>
                <Campo label="Modelo">
                  <Input value={form.modelo ?? ""} onChange={(e) => set("modelo", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Nº de série">
                  <Input value={form.numero_serie ?? ""} onChange={(e) => set("numero_serie", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Criticidade" ajuda="Alta = parou, parou o setor.">
                  <Select
                    value={form.criticidade ?? "media"}
                    onValueChange={(v) => set("criticidade", v as TiAtivo["criticidade"])}
                    disabled={!podeEditar}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CRITICIDADES.map((c) => (
                        <SelectItem key={c.valor} value={c.valor}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
              </Grade>

              <Separator />

              <Grade>
                <Campo label="Planta" ajuda="Sem planta, o equipamento fica na bandeja lateral.">
                  <Select
                    value={form.planta_id ?? "__nenhuma__"}
                    onValueChange={(v) => set("planta_id", v === "__nenhuma__" ? null : v)}
                    disabled={!podeEditar}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__nenhuma__">Não posicionado</SelectItem>
                      {plantas.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
                <Campo label="Ligado a" ajuda="Monitor/nobreak pendurado no computador que ele serve.">
                  <Select
                    value={form.ativo_pai_id ?? "__nenhum__"}
                    onValueChange={(v) => set("ativo_pai_id", v === "__nenhum__" ? null : v)}
                    disabled={!podeEditar}
                  >
                    <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__nenhum__">Nenhum</SelectItem>
                      {ativos
                        .filter((a) => a.id !== ativo?.id)
                        .slice(0, 300)
                        .map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.codigo ? `${a.codigo} · ` : ""}{a.nome}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Campo>
                <Campo label="Escala no mapa" ajuda="1 = tamanho real do catálogo.">
                  <Input
                    type="number" step="0.1" min="0.4" max="3"
                    value={form.escala ?? 1}
                    onChange={(e) => set("escala", Number(e.target.value))}
                    disabled={!podeEditar}
                  />
                </Campo>
                <Campo label="Rotação (graus)">
                  <Input
                    type="number" step="15"
                    value={form.rotacao ?? 0}
                    onChange={(e) => set("rotacao", Number(e.target.value))}
                    disabled={!podeEditar}
                  />
                </Campo>
              </Grade>
            </TabsContent>

            {/* ── Configuração ──────────────────────────────────────── */}
            <TabsContent value="config" className="mt-0 space-y-4">
              {!ehComputador && (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  Estes campos servem a qualquer equipamento, mas foram pensados para
                  computadores. Preencha só o que fizer sentido para um {def.label.toLowerCase()}.
                </p>
              )}
              <Grade>
                <Campo label="Processador" className="sm:col-span-2">
                  <Input value={form.cpu ?? ""} onChange={(e) => set("cpu", e.target.value)} placeholder="Intel Core i5-12400" disabled={!podeEditar} />
                </Campo>
                <Campo label="Núcleos">
                  <Input type="number" value={form.cpu_nucleos ?? ""} onChange={(e) => set("cpu_nucleos", e.target.value === "" ? null : Number(e.target.value))} disabled={!podeEditar} />
                </Campo>
                <Campo label="Memória (GB)">
                  <Input type="number" step="1" value={form.ram_gb ?? ""} onChange={(e) => set("ram_gb", e.target.value === "" ? null : Number(e.target.value))} disabled={!podeEditar} />
                </Campo>
                <Campo label="Tipo de memória">
                  <Input value={form.ram_tipo ?? ""} onChange={(e) => set("ram_tipo", e.target.value)} placeholder="DDR4 3200" disabled={!podeEditar} />
                </Campo>
                <Campo label="Armazenamento">
                  <Select
                    value={form.armazenamento_tipo ?? "__nenhum__"}
                    onValueChange={(v) => set("armazenamento_tipo", v === "__nenhum__" ? null : v)}
                    disabled={!podeEditar}
                  >
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__nenhum__">—</SelectItem>
                      <SelectItem value="ssd">SSD</SelectItem>
                      <SelectItem value="nvme">NVMe</SelectItem>
                      <SelectItem value="hdd">HD</SelectItem>
                      <SelectItem value="hibrido">Híbrido</SelectItem>
                    </SelectContent>
                  </Select>
                </Campo>
                <Campo label="Capacidade (GB)">
                  <Input type="number" value={form.armazenamento_gb ?? ""} onChange={(e) => set("armazenamento_gb", e.target.value === "" ? null : Number(e.target.value))} disabled={!podeEditar} />
                </Campo>
                <Campo label="Disco secundário" className="sm:col-span-2">
                  <Input value={form.armazenamento_extra ?? ""} onChange={(e) => set("armazenamento_extra", e.target.value)} placeholder="HD 1 TB para backup local" disabled={!podeEditar} />
                </Campo>
                <Campo label="Placa de vídeo">
                  <Input value={form.placa_video ?? ""} onChange={(e) => set("placa_video", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Placa-mãe">
                  <Input value={form.placa_mae ?? ""} onChange={(e) => set("placa_mae", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Fonte (W)">
                  <Input type="number" value={form.fonte_watts ?? ""} onChange={(e) => set("fonte_watts", e.target.value === "" ? null : Number(e.target.value))} disabled={!podeEditar} />
                </Campo>
                <Campo label="Monitores">
                  <Input type="number" value={form.monitores_qtd ?? ""} onChange={(e) => set("monitores_qtd", e.target.value === "" ? null : Number(e.target.value))} disabled={!podeEditar} />
                </Campo>
              </Grade>

              <Separator />

              <Grade>
                <Campo label="Sistema operacional">
                  <Input value={form.sistema_operacional ?? ""} onChange={(e) => set("sistema_operacional", e.target.value)} placeholder="Windows 11 Pro" disabled={!podeEditar} />
                </Campo>
                <Campo label="Versão / build">
                  <Input value={form.so_versao ?? ""} onChange={(e) => set("so_versao", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Licença do SO">
                  <Input value={form.so_licenca ?? ""} onChange={(e) => set("so_licenca", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Office">
                  <Input value={form.office_versao ?? ""} onChange={(e) => set("office_versao", e.target.value)} placeholder="Microsoft 365" disabled={!podeEditar} />
                </Campo>
                <Campo label="Licença do Office">
                  <Input value={form.office_licenca ?? ""} onChange={(e) => set("office_licenca", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Antivírus">
                  <Input value={form.antivirus ?? ""} onChange={(e) => set("antivirus", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Periféricos" className="sm:col-span-3">
                  <Input value={form.perifericos ?? ""} onChange={(e) => set("perifericos", e.target.value)} placeholder="Teclado ABNT2, mouse sem fio, headset" disabled={!podeEditar} />
                </Campo>
              </Grade>
            </TabsContent>

            {/* ── Rede ──────────────────────────────────────────────── */}
            <TabsContent value="rede" className="mt-0 space-y-4">
              <Grade>
                <Campo label="Endereço IP" ajuda="IP fixo repetido é barrado pelo banco.">
                  <Input value={form.ip ?? ""} onChange={(e) => set("ip", e.target.value)} placeholder="192.168.100.42" disabled={!podeEditar} />
                </Campo>
                <Campo label="Atribuição">
                  <Select
                    value={form.ip_tipo ?? "__nenhum__"}
                    onValueChange={(v) => set("ip_tipo", v === "__nenhum__" ? null : v)}
                    disabled={!podeEditar}
                  >
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__nenhum__">—</SelectItem>
                      <SelectItem value="fixo">Fixo</SelectItem>
                      <SelectItem value="dhcp">DHCP</SelectItem>
                    </SelectContent>
                  </Select>
                </Campo>
                <Campo label="Conexão">
                  <Select
                    value={form.rede_tipo ?? "__nenhum__"}
                    onValueChange={(v) => set("rede_tipo", v === "__nenhum__" ? null : v)}
                    disabled={!podeEditar}
                  >
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__nenhum__">—</SelectItem>
                      <SelectItem value="cabo">Cabo</SelectItem>
                      <SelectItem value="wifi">Wi-Fi</SelectItem>
                      <SelectItem value="ambos">Cabo + Wi-Fi</SelectItem>
                    </SelectContent>
                  </Select>
                </Campo>
                <Campo label="MAC">
                  <Input value={form.mac ?? ""} onChange={(e) => set("mac", e.target.value)} placeholder="00:1A:2B:3C:4D:5E" disabled={!podeEditar} />
                </Campo>
                <Campo label="Máscara">
                  <Input value={form.mascara ?? ""} onChange={(e) => set("mascara", e.target.value)} placeholder="255.255.255.0" disabled={!podeEditar} />
                </Campo>
                <Campo label="Gateway">
                  <Input value={form.gateway ?? ""} onChange={(e) => set("gateway", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="DNS">
                  <Input value={form.dns ?? ""} onChange={(e) => set("dns", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="VLAN">
                  <Input value={form.vlan ?? ""} onChange={(e) => set("vlan", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Domínio / grupo">
                  <Input value={form.dominio ?? ""} onChange={(e) => set("dominio", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Switch">
                  <Input value={form.switch_nome ?? ""} onChange={(e) => set("switch_nome", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Porta do switch">
                  <Input value={form.switch_porta ?? ""} onChange={(e) => set("switch_porta", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Ponto de rede">
                  <Input value={form.ponto_rede ?? ""} onChange={(e) => set("ponto_rede", e.target.value)} placeholder="PT-14" disabled={!podeEditar} />
                </Campo>
              </Grade>

              <AcessoGate
                menu="ti_ativo_sensivel"
                acao="visualizar"
                fallback={
                  <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                    <ShieldAlert className="h-4 w-4" />
                    Dados de suporte remoto ficam visíveis para quem tem a permissão
                    “Dados sensíveis” do módulo T.I.
                  </div>
                }
              >
                <div className="rounded-lg border border-amber-300/70 bg-amber-50/60 p-4 dark:border-amber-800/60 dark:bg-amber-950/20">
                  <p className="mb-3 flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                    <ShieldAlert className="h-4 w-4" /> Suporte remoto — não guarde senha aqui
                  </p>
                  <Grade>
                    <Campo label="AnyDesk">
                      <Input value={form.anydesk ?? ""} onChange={(e) => set("anydesk", e.target.value)} disabled={!podeEditar} />
                    </Campo>
                    <Campo label="TeamViewer">
                      <Input value={form.teamviewer ?? ""} onChange={(e) => set("teamviewer", e.target.value)} disabled={!podeEditar} />
                    </Campo>
                    <Campo label="Notas internas" className="sm:col-span-3">
                      <Textarea
                        rows={2}
                        value={form.observacoes_internas ?? ""}
                        onChange={(e) => set("observacoes_internas", e.target.value)}
                        disabled={!podeEditar}
                      />
                    </Campo>
                  </Grade>
                </div>
              </AcessoGate>
            </TabsContent>

            {/* ── Gestão ────────────────────────────────────────────── */}
            <TabsContent value="gestao" className="mt-0 space-y-4">
              <Grade>
                <Campo label="Responsável" className="sm:col-span-2">
                  <SelecionarResponsavel
                    nome={form.responsavel_nome ?? null}
                    disabled={!podeEditar}
                    onEscolher={(c) => {
                      set("responsavel_empregado_id", c?.id ?? null);
                      set("responsavel_nome", c?.nome ?? null);
                      if (c?.setor) set("setor", c.setor);
                    }}
                  />
                </Campo>
                <Campo label="Setor">
                  <Input value={form.setor ?? ""} onChange={(e) => set("setor", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Fornecedor">
                  <Input value={form.fornecedor ?? ""} onChange={(e) => set("fornecedor", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Nota fiscal">
                  <Input value={form.nota_fiscal ?? ""} onChange={(e) => set("nota_fiscal", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Valor de aquisição (R$)">
                  <Input type="number" step="0.01" value={form.valor_aquisicao ?? ""} onChange={(e) => set("valor_aquisicao", e.target.value === "" ? null : Number(e.target.value))} disabled={!podeEditar} />
                </Campo>
                <Campo label="Data de aquisição">
                  <Input type="date" value={form.data_aquisicao ?? ""} onChange={(e) => set("data_aquisicao", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Garantia até">
                  <Input type="date" value={form.garantia_ate ?? ""} onChange={(e) => set("garantia_ate", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Vida útil (meses)">
                  <Input type="number" value={form.vida_util_meses ?? ""} onChange={(e) => set("vida_util_meses", e.target.value === "" ? null : Number(e.target.value))} disabled={!podeEditar} />
                </Campo>
                <Campo label="Última manutenção">
                  <Input type="date" value={form.ultima_manutencao ?? ""} onChange={(e) => set("ultima_manutencao", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Próxima manutenção">
                  <Input type="date" value={form.proxima_manutencao ?? ""} onChange={(e) => set("proxima_manutencao", e.target.value)} disabled={!podeEditar} />
                </Campo>
                <Campo label="Observações" className="sm:col-span-3">
                  <Textarea rows={3} value={form.observacoes ?? ""} onChange={(e) => set("observacoes", e.target.value)} disabled={!podeEditar} />
                </Campo>
              </Grade>

              {ativo && <BlocoAnexos ativoId={ativo.id} podeEditar={podeEditar} />}
            </TabsContent>

            {/* ── Histórico ─────────────────────────────────────────── */}
            <TabsContent value="historico" className="mt-0">
              {ativo && <Historico ativoId={ativo.id} podeAnotar={podeEditar} />}
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t p-4">
          <div>
            {ativo && podeExcluir && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onExcluir(ativo.id)}
              >
                <Trash2 className="mr-1.5 h-4 w-4" /> Excluir
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar}>Fechar</Button>
            {podeEditar && (
              <Button onClick={submeter} disabled={salvando || !form.nome?.trim()}>
                {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                Salvar
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Peças do formulário ───────────────────────────────────────────────

function Grade({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{children}</div>;
}

function Campo({
  label,
  children,
  className,
  obrigatorio,
  ajuda,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  obrigatorio?: boolean;
  ajuda?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
        {obrigatorio && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {ajuda && <p className="text-[11px] leading-tight text-muted-foreground/80">{ajuda}</p>}
    </div>
  );
}

/**
 * Combobox de colaborador com lista cortada em 60 resultados.
 *
 * Não é preguiça de paginar: são 2200+ pessoas em EMPREGADOS, e jogar tudo
 * dentro de um Command faz o Radix montar 2200 nós a cada tecla digitada — o
 * campo trava no meio da digitação. Quem procura alguém digita o nome; 60
 * linhas é mais do que qualquer um lê antes de refinar a busca.
 */
function SelecionarResponsavel({
  nome,
  disabled,
  onEscolher,
}: {
  nome: string | null;
  disabled?: boolean;
  onEscolher: (c: { id: number; nome: string; setor: string | null } | null) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const { data: colaboradores = [], isLoading } = useColaboradoresTi();
  const inputRef = useRef<HTMLInputElement>(null);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const base = termo
      ? colaboradores.filter((c) => c.nome.toLowerCase().includes(termo))
      : colaboradores;
    return base.slice(0, 60);
  }, [colaboradores, busca]);

  useEffect(() => {
    if (aberto) window.setTimeout(() => inputRef.current?.focus(), 40);
  }, [aberto]);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal" disabled={disabled}>
          <span className={cn("truncate", !nome && "text-muted-foreground")}>{nome || "Selecionar colaborador"}</span>
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="border-b p-2">
          <Input
            ref={inputRef}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome..."
            className="h-8"
          />
        </div>
        <ScrollArea className="max-h-64">
          <div className="p-1">
            {isLoading && <p className="p-3 text-xs text-muted-foreground">Carregando colaboradores…</p>}
            {!isLoading && filtrados.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">Ninguém encontrado.</p>
            )}
            <button
              type="button"
              className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
              onClick={() => { onEscolher(null); setAberto(false); }}
            >
              Sem responsável
            </button>
            {filtrados.map((c) => (
              <button
                key={c.id}
                type="button"
                className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => { onEscolher(c); setAberto(false); }}
              >
                <span className="block truncate">{c.nome}</span>
                {c.setor && <span className="block truncate text-[11px] text-muted-foreground">{c.setor}</span>}
              </button>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

// ── Histórico + anexos ────────────────────────────────────────────────

const ICONE_EVENTO: Record<string, typeof Clock> = {
  criacao: CheckCircle2,
  movimentacao: MapPin,
  status: Cable,
  responsavel: User,
  rede: Network,
  manutencao: HardDrive,
  nota: Clock,
};

function Historico({ ativoId, podeAnotar }: { ativoId: string; podeAnotar: boolean }) {
  const { data: eventos = [], isLoading } = useEventosAtivoTi(ativoId);
  const anotar = useAnotarEventoTi();
  const [texto, setTexto] = useState("");

  return (
    <div className="space-y-4">
      {podeAnotar && (
        <div className="flex gap-2">
          <Input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Anotar algo nesta máquina (troca de peça, chamado, empréstimo…)"
            onKeyDown={(e) => {
              if (e.key === "Enter" && texto.trim()) {
                anotar.mutate({ ativo_id: ativoId, texto: texto.trim() });
                setTexto("");
              }
            }}
          />
          <Button
            variant="secondary"
            disabled={!texto.trim() || anotar.isPending}
            onClick={() => { anotar.mutate({ ativo_id: ativoId, texto: texto.trim() }); setTexto(""); }}
          >
            Anotar
          </Button>
        </div>
      )}

      {isLoading && <p className="text-xs text-muted-foreground">Carregando histórico…</p>}
      {!isLoading && eventos.length === 0 && (
        <p className="text-xs text-muted-foreground">Nada registrado ainda.</p>
      )}

      <ol className="relative space-y-3 border-l pl-5">
        {eventos.map((ev) => {
          const Icone = ICONE_EVENTO[ev.tipo] ?? Clock;
          return (
            <li key={ev.id} className="relative">
              <span className="absolute -left-[26px] flex h-5 w-5 items-center justify-center rounded-full border bg-background">
                <Icone className="h-3 w-3 text-muted-foreground" />
              </span>
              <p className="text-sm">{ev.texto || ev.tipo}</p>
              <p className="text-[11px] text-muted-foreground">
                {new Date(ev.created_at).toLocaleString("pt-BR")}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function BlocoAnexos({ ativoId, podeEditar }: { ativoId: string; podeEditar: boolean }) {
  const { data: anexos = [] } = useAnexosAtivoTi(ativoId);
  const enviar = useEnviarAnexoTi();
  const fileRef = useRef<HTMLInputElement>(null);

  const abrir = async (path: string) => {
    const url = await urlAnexoTi(path);
    if (url) window.open(url, "_blank", "noopener");
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5" /> Anexos ({anexos.length})
        </p>
        {podeEditar && (
          <>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const arquivo = e.target.files?.[0];
                if (arquivo) enviar.mutate({ ativo_id: ativoId, arquivo });
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={enviar.isPending}>
              {enviar.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="mr-1.5 h-3.5 w-3.5" />}
              Anexar
            </Button>
          </>
        )}
      </div>
      {anexos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Foto do equipamento, nota fiscal, laudo de manutenção.</p>
      ) : (
        <ul className="space-y-1">
          {anexos.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => abrir(a.storage_path)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted"
              >
                <Camera className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{a.nome_arquivo}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
