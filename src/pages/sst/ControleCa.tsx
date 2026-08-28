import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SituacaoCa } from "@/lib/sst/ca";
import { cn } from "@/lib/utils";
import { AlertTriangle, BadgeCheck, CircleHelp, ShieldAlert } from "lucide-react";
import { PainelCatalogoCa } from "./PainelCatalogoCa";
import { PainelCaBloqueado } from "./PainelCaBloqueado";

// As RPCs são novas e ainda não existem em types.ts (regra R8 do projeto).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

interface CaEstoque {
  sup_item_id: string;
  material: string;
  almoxarifado: string | null;
  codigo: string;
  ca_numero: string | null;
  ca_validade: string | null;
  situacao: SituacaoCa;
  dias_restantes: number | null;
  tem_laudo: boolean;
  validade_minima_meses: number | null;
}

interface CaEntregue {
  colaborador: string;
  matricula: string | null;
  contrato: string | null;
  material: string;
  codigo: string;
  ca_numero: string | null;
  ca_validade: string;
  situacao: SituacaoCa;
  dias_restantes: number;
  entregue_em: string | null;
}

const ROTULOS: Record<SituacaoCa, string> = {
  sem_ca: "Sem CA",
  vencido: "Vencido",
  vencendo: "Vencendo",
  valido: "Válido",
};

function formatarData(valor: string | null) {
  if (!valor) return "—";
  const partes = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : valor;
}

function formatarDataHora(valor: string | null) {
  if (!valor) return "—";
  const data = new Date(valor);
  return Number.isNaN(data.getTime())
    ? "—"
    : data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function textoDias(dias: number | null) {
  if (dias === null) return "—";
  if (dias < 0) return `${Math.abs(dias)} dia${dias === -1 ? "" : "s"} vencido`;
  if (dias === 0) return "Vence hoje";
  return `${dias} dia${dias === 1 ? "" : "s"}`;
}

export default function ControleCa() {
  const [diasAlerta, setDiasAlerta] = useState(60);
  const [aba, setAba] = useState("estoque");

  const estoque = useQuery({
    queryKey: ["sst_ca_estoque", diasAlerta],
    queryFn: async (): Promise<CaEstoque[]> => {
      const { data, error } = await sb.rpc("sst_ca_estoque", { p_dias_alerta: diasAlerta });
      if (error) throw error;
      return data ?? [];
    },
  });

  const entregues = useQuery({
    queryKey: ["sst_ca_entregue", diasAlerta],
    queryFn: async (): Promise<CaEntregue[]> => {
      const { data, error } = await sb.rpc("sst_ca_entregue", { p_dias_alerta: diasAlerta });
      if (error) throw error;
      return data ?? [];
    },
  });

  const kpis = useMemo(() => ({
    vencido: (aba === "estoque" ? estoque.data ?? [] : entregues.data ?? [])
      .filter((linha) => linha.situacao === "vencido").length,
    vencendo: (aba === "estoque" ? estoque.data ?? [] : entregues.data ?? [])
      .filter((linha) => linha.situacao === "vencendo").length,
    sem_ca: (aba === "estoque" ? estoque.data ?? [] : entregues.data ?? [])
      .filter((linha) => linha.situacao === "sem_ca").length,
    valido: (aba === "estoque" ? estoque.data ?? [] : entregues.data ?? [])
      .filter((linha) => linha.situacao === "valido").length,
  }), [aba, estoque.data, entregues.data]);

  const erro = estoque.error ?? entregues.error;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Controle de CA"
        subtitle="Priorize EPIs vencidos ou próximos do vencimento no estoque e com colaboradores."
        module="SST"
        breadcrumb={["Controle de CA"]}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Antecedência</span>
            <Select value={String(diasAlerta)} onValueChange={(valor) => setDiasAlerta(Number(valor))}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 dias</SelectItem>
                <SelectItem value="60">60 dias</SelectItem>
                <SelectItem value="90">90 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi situacao="vencido" valor={kpis.vencido} icone={ShieldAlert} />
        <Kpi situacao="vencendo" valor={kpis.vencendo} icone={AlertTriangle} />
        <Kpi situacao="sem_ca" valor={kpis.sem_ca} icone={CircleHelp} />
        <Kpi situacao="valido" valor={kpis.valido} icone={BadgeCheck} />
      </div>

      {erro && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          Não foi possível carregar o controle de CA: {(erro as Error).message}
        </div>
      )}

      {/* Fica acima das listas de propósito: os números abaixo só valem o que
          vale a lista oficial que os alimenta. Ver o site do Ministério recusa
          download automático em PainelCatalogoCa. */}
      <PainelCatalogoCa />

      {/* Logo abaixo do catalogo de proposito: o bloqueio depende da lista
          oficial estar carregada, entao a ordem na tela conta a dependencia. */}
      <PainelCaBloqueado />

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          <TabsTrigger value="estoque">No estoque</TabsTrigger>
          <TabsTrigger value="colaboradores">Com colaboradores</TabsTrigger>
        </TabsList>

        <TabsContent value="estoque" className="mt-4">
          <Card><CardContent className="p-0">
            {estoque.isLoading ? <Carregando /> : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Situação</TableHead><TableHead>Material</TableHead>
                  <TableHead>Almoxarifado</TableHead><TableHead>Etiqueta</TableHead>
                  <TableHead>CA</TableHead><TableHead>Validade</TableHead>
                  <TableHead>Dias restantes</TableHead><TableHead>Laudo SST</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(estoque.data ?? []).map((linha) => (
                    <TableRow key={linha.codigo}>
                      <TableCell><Situacao situacao={linha.situacao} /></TableCell>
                      <TableCell className="font-medium">{linha.material}</TableCell>
                      <TableCell>{linha.almoxarifado || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{linha.codigo}</TableCell>
                      <TableCell>{linha.ca_numero || "—"}</TableCell>
                      <TableCell>{formatarData(linha.ca_validade)}</TableCell>
                      <TableCell>{textoDias(linha.dias_restantes)}</TableCell>
                      <TableCell>
                        {linha.tem_laudo
                          ? <span>{linha.validade_minima_meses} mês{linha.validade_minima_meses === 1 ? "" : "es"} mínimos</span>
                          : <span className="text-muted-foreground">Sem laudo</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!estoque.isLoading && (estoque.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={8} className="h-28 text-center text-muted-foreground">
                      Nenhum EPI disponível no estoque.
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="colaboradores" className="mt-4">
          <Card><CardContent className="p-0">
            {entregues.isLoading ? <Carregando /> : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Situação</TableHead><TableHead>Colaborador</TableHead>
                  <TableHead>Matrícula</TableHead><TableHead>Contrato</TableHead>
                  <TableHead>Material</TableHead><TableHead>Etiqueta</TableHead>
                  <TableHead>CA</TableHead><TableHead>Validade</TableHead>
                  <TableHead>Dias restantes</TableHead><TableHead>Entregue em</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {(entregues.data ?? []).map((linha) => (
                    <TableRow key={linha.codigo}>
                      <TableCell><Situacao situacao={linha.situacao} /></TableCell>
                      <TableCell className="font-medium">{linha.colaborador}</TableCell>
                      <TableCell>{linha.matricula || "—"}</TableCell>
                      <TableCell>{linha.contrato || "—"}</TableCell>
                      <TableCell>{linha.material}</TableCell>
                      <TableCell className="font-mono text-xs">{linha.codigo}</TableCell>
                      <TableCell>{linha.ca_numero || "—"}</TableCell>
                      <TableCell>{formatarData(linha.ca_validade)}</TableCell>
                      <TableCell>{textoDias(linha.dias_restantes)}</TableCell>
                      <TableCell>{formatarDataHora(linha.entregue_em)}</TableCell>
                    </TableRow>
                  ))}
                  {!entregues.isLoading && (entregues.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={10} className="h-28 text-center text-muted-foreground">
                      Nenhum CA entregue vence dentro da antecedência selecionada.
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Situacao({ situacao }: { situacao: SituacaoCa }) {
  return (
    <Badge
      variant={situacao === "vencido" ? "destructive" : "outline"}
      className={cn(
        situacao === "vencendo" && "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
        situacao === "sem_ca" && "border-slate-300 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
        situacao === "valido" && "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
      )}
    >
      {ROTULOS[situacao]}
    </Badge>
  );
}

function Kpi({ situacao, valor, icone: Icone }: { situacao: SituacaoCa; valor: number; icone: typeof AlertTriangle }) {
  return (
    <div className={cn(
      "flex items-center gap-3 rounded-lg border p-4",
      situacao === "vencido" && valor > 0 && "border-destructive/40 bg-destructive/5",
      situacao === "vencendo" && valor > 0 && "border-amber-400/60 bg-amber-50 dark:bg-amber-950/20",
    )}>
      <Icone className={cn(
        "h-5 w-5 text-muted-foreground",
        situacao === "vencido" && valor > 0 && "text-destructive",
        situacao === "vencendo" && valor > 0 && "text-amber-600",
      )} />
      <div><p className="text-2xl font-bold leading-none">{valor}</p><p className="text-xs text-muted-foreground">{ROTULOS[situacao]}</p></div>
    </div>
  );
}

function Carregando() {
  return <p className="py-16 text-center text-sm text-muted-foreground">Carregando…</p>;
}
