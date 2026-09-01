import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, Search } from "lucide-react";
import { useTodasJustificativasPendentes } from "@/hooks/useMaloteJustificativaAnalista";
import { useContratosAtivos } from "@/hooks/useMaloteDespesa";
import { fmtMoney } from "@/pages/malote/orcamentoUtils";
import { abreviarNome } from "@/pages/malote/JustificativaPendenteBadge";

// SIS-2026-0283 (Iury): "Criar um Submódulo em Malote e Licitações chamado
// 'Justificativa Analistas' onde só apareça os itens do malote que os
// analistas precisam justificar, para facilitar o serviço deles e tbm
// evitar deles verem todos os itens sem necessidade." Pedido explícito do
// usuário: "espelho simplificado das aprovações, visando somente os
// analistas" — por isso não tem tiles de status nem o painel grande de
// filtros de Aprovações.tsx, só busca + a lista.
//
// Escopo (achado do próprio usuário testando com a DM-2026-0163): "por ora
// todos poderíamos ver, para o gerente e colegas se alertarem que ali tem
// uma justificativa" — a lista é ABERTA (todas as pendências, não só as do
// usuário logado), por isso mostra a coluna "Responsável" com o(s)
// analista(s) do contrato — sem isso, quem não é o dono da pendência não
// saberia de quem cobrar.
//
// O clique na linha leva pra dentro da própria despesa (aba Rateio, onde
// RateioGrid.tsx já permite o analista preencher a justificativa — isso já
// funciona hoje, essa tela só resolve o "como descobrir que precisa").
export default function JustificativaAnalistas() {
  const navigate = useNavigate();
  const { itens, isLoading } = useTodasJustificativasPendentes();
  const { data: contratos = [] } = useContratosAtivos();
  const [busca, setBusca] = useState("");

  const contratosMap = useMemo(() => new Map(contratos.map((c) => [c.id, c.nome])), [contratos]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return itens;
    return itens.filter(
      (i) =>
        i.numero.toLowerCase().includes(q) ||
        i.nome.toLowerCase().includes(q) ||
        (contratosMap.get(i.contratoId) ?? "").toLowerCase().includes(q) ||
        i.analistas.some((a) => a.toLowerCase().includes(q))
    );
  }, [itens, busca, contratosMap]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Justificativa Analistas"
        subtitle="Itens de Classificações que estouraram o limite configurado e ainda precisam de justificativa do analista responsável."
        module="Licitações"
        breadcrumb={["Licitações", "Justificativa Analistas"]}
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-xs"
              placeholder="Buscar por nº, nome, contrato ou analista..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº</TableHead>
                  <TableHead>Nome / Motivo</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead className="text-right">Valor da linha (R$)</TableHead>
                  <TableHead>Data de Pagamento</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                      Carregando...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filtrados.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                      <div className="flex flex-col items-center gap-2">
                        <CheckCircle2 className="h-8 w-8 text-muted-foreground/50" />
                        Nenhuma justificativa pendente no momento.
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {filtrados.map((item) => (
                  <TableRow
                    key={item.linhaId}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/app/malote/despesa/${item.despesaId}`)}
                  >
                    <TableCell className="font-mono text-xs">{item.numero}</TableCell>
                    <TableCell className="text-sm">
                      <p>{item.nome}</p>
                      {item.motivo && <p className="text-xs text-muted-foreground">{item.motivo}</p>}
                    </TableCell>
                    <TableCell className="text-sm">{contratosMap.get(item.contratoId) ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {item.analistas.length > 0 ? item.analistas.map(abreviarNome).join(" · ") : "Analista não definido"}
                    </TableCell>
                    <TableCell className="text-right text-sm">{fmtMoney(item.valorLinha)}</TableCell>
                    <TableCell className="text-sm">
                      {item.dataPagamento ? new Date(item.dataPagamento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}
                    </TableCell>
                    <TableCell>
                      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
