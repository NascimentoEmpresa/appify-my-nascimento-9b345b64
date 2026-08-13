import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Info } from "lucide-react";
import { useOrcamentoContratos } from "@/hooks/useOrcamentoContratos";
import { fmtMoney } from "./orcamentoUtils";

// Orçamento de Contratos (SIS-2026-0125, ajustado após feedback): espelho
// direto da Planilha de Custo por contrato — não depende de nenhuma
// ligação pra aparecer (assim como o Orçamento Administrativo não depende
// de nada além do seu próprio cadastro). Agrupado por contrato num
// accordion pra não ficar poluído (cada contrato pode ter dezenas de
// rubricas com valor).
export default function OrcamentoContratos() {
  const { data: grupos, isLoading } = useOrcamentoContratos();
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const base = busca.trim()
      ? grupos.filter((g) => {
          const alvo = busca.toLowerCase();
          return (
            g.contrato.nome.toLowerCase().includes(alvo) ||
            g.contrato.cliente.toLowerCase().includes(alvo) ||
            g.rubricas.some((r) => r.label.toLowerCase().includes(alvo))
          );
        })
      : grupos;
    return [...base].sort((a, b) => a.contrato.nome.localeCompare(b.contrato.nome, "pt-BR"));
  }, [grupos, busca]);

  const valorTotal = useMemo(() => filtrados.reduce((s, g) => s + g.valorTotal, 0), [filtrados]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Orçamento de Contratos"
        subtitle="Valor executado por contrato, direto da Planilha de Custo, agrupado por rubrica."
        module="Malote"
        breadcrumb={["Malote", "Classificações e Orçamentos", "Orçamento de Contratos"]}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Contratos com orçamento</CardDescription>
            <CardTitle className="text-3xl">{filtrados.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Valor total executado</CardDescription>
            <CardTitle className="text-2xl">{fmtMoney(valorTotal)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <p className="text-muted-foreground">
          Os valores são calculados ao vivo a partir da Planilha de Custo, considerando a rubrica vigente de cada
          posto executado. Abra um contrato pra ver o detalhamento por rubrica.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base">Contratos</CardTitle>
          <div className="w-64">
            <Label className="text-xs">Buscar</Label>
            <Input
              placeholder="Contrato, cliente ou rubrica..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-center text-muted-foreground py-8">Carregando...</p>}
          {!isLoading && filtrados.length === 0 && (
            <p className="text-center text-muted-foreground py-8">Nenhum orçamento de contrato encontrado.</p>
          )}
          {!isLoading && filtrados.length > 0 && (
            <Accordion type="multiple" className="w-full">
              {filtrados.map((g) => (
                <AccordionItem key={g.contrato.id} value={g.contrato.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex flex-1 items-center justify-between gap-3 pr-2">
                      <div className="text-left">
                        <p className="font-medium">{g.contrato.nome}</p>
                        <p className="text-xs text-muted-foreground font-normal">{g.contrato.cliente}</p>
                      </div>
                      <span className="text-sm font-semibold whitespace-nowrap">{fmtMoney(g.valorTotal)}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Rubrica</TableHead>
                          <TableHead>Grupo</TableHead>
                          <TableHead className="text-right">Valor Executado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.rubricas.map((r) => (
                          <TableRow key={r.campo}>
                            <TableCell className="font-medium">{r.label}</TableCell>
                            <TableCell className="text-muted-foreground">{r.grupo}</TableCell>
                            <TableCell className="text-right">{fmtMoney(r.valor)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
