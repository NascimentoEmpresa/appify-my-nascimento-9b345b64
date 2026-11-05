/**
 * Saídas por Contrato (SIS-2026-0769) — tela própria.
 *
 * Conferência das saídas de estoque importadas do ERP antigo: quanto e o quê
 * saiu para cada contrato, mês a mês. Pedido pela diretoria para a análise de
 * lucratividade — o fluxo de caixa não serve como fonte, porque material
 * comprado para um contrato é muitas vezes entregue a outro, e o destino real
 * só aparece na saída do estoque.
 *
 * Aqui mora apenas o recorte (período e contrato) e o portão de acesso. O
 * corpo do relatório é o mesmo componente que o Dashboard de Compras usa na
 * aba "Saídas por Contrato" — ver components/suprimentos/dashboard. Duas
 * entradas, uma implementação.
 *
 * Esta tela é sempre o consolidado do grupo: não tem seletor de empresa, e
 * passa `empresaId={null}` de propósito. Quem precisa do recorte por empresa
 * usa a aba do Dashboard, que já tem o seletor.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { SaidasPorContrato as PainelSaidasPorContrato } from "@/components/suprimentos/dashboard/SaidasPorContrato";
// `useContratos` (useContratos.ts) lê a tabela `contrato`, que é OUTRA — tem 56
// linhas e ids próprios. Quem `sup_pedido.contrato_id` referencia é `contratos`
// (103 linhas), e é dela que o relatório resolve o contrato. Usar a errada
// devolveria filtro vazio sem erro nenhum.
import { useContratosCatalogo } from "@/hooks/useSupCatalogo";

const TODOS = "__todos__";

export default function SaidasPorContrato() {
  const hoje = new Date();
  const [inicio, setInicio] = useState(`${hoje.getFullYear()}-01-01`);
  const [fim, setFim] = useState(hoje.toISOString().slice(0, 10));
  const [contratoId, setContratoId] = useState<string>(TODOS);

  const { data: contratos } = useContratosCatalogo();

  return (
    <AcessoGate menu="sup_rel_saidas_contrato" acao="visualizar">
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Saídas por Contrato</h1>
          <p className="text-muted-foreground">
            Material e uniforme que saíram do estoque, por contrato e por mês.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filtros</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="inicio">De</Label>
              <Input
                id="inicio"
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fim">Até</Label>
              <Input id="fim" type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
            </div>
            <div className="min-w-64 space-y-1">
              <Label>Contrato</Label>
              <Select value={contratoId} onValueChange={setContratoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos os contratos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos os contratos</SelectItem>
                  {(contratos ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <PainelSaidasPorContrato
          empresaId={null}
          inicio={inicio}
          fim={fim}
          contratoId={contratoId === TODOS ? null : contratoId}
        />
      </div>
    </AcessoGate>
  );
}
