import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, Building2, Loader2, Search, ShieldCheck, UserCog, X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  useArvoreContratos, useBuscaColaboradores, useDesignacoes, useDesignar,
  type ColaboradorLinha, type Designacao, type NoContrato, type PapelDesignacao,
} from "@/hooks/useEspacoColaborador";

// =====================================================================
// DESIGNAÇÕES DA OPERAÇÃO — quem responde por cada contrato
//
// A tela que faltava. Antes desta, "trocar o supervisor de um contrato" não
// tinha onde ser feito: a árvore DEDUZIA a chefia do "Título do Cargo", que
// responde "quem é supervisor" e não "de qual contrato".
//
// ATRIBUTO ≠ DESIGNAÇÃO
//
//   Ser supervisor é um atributo da pessoa, e está no cadastro do RH.
//   Supervisionar o contrato X é uma decisão da Operação, que muda sem que
//   nada mude no cadastro. São 4 supervisores para 58 contratos — deduzir
//   pelo cargo mostrava os 68 colaboradores com cargo de supervisão
//   espalhados por onde estão LOTADOS, que é outra informação.
//
// O QUE ESTA TELA GARANTE
//
//   • Trocar preserva o histórico (a RPC fecha a vigência anterior e abre a
//     nova — dá para saber quem respondia pelo contrato em março).
//   • Designado que foi demitido NÃO some: aparece em vermelho, no topo,
//     como pendência. Sumir em silêncio deixa o contrato órfão sem ninguém
//     perceber.
//   • Contrato sem ninguém designado também aparece — é a fila de trabalho.
//
// PERMISSÃO
//
//   Reusa o menu do Espaço do Colaborador: ver a lista exige 'visualizar',
//   designar exige 'alterar'. Quem só consulta a árvore não muda quem
//   responde por um contrato.
// =====================================================================

const ROTA_BASE = "/app/central-servicos/espaco-colaborador";

export default function Designacoes() {
  return (
    <AcessoGate
      menu="central_servicos_espaco_colaborador"
      acao="visualizar"
      fallback={
        <div className="p-6">
          <PageHeader title="Responsáveis por contrato" module="Central de Serviços" />
          <Card className="p-6 text-sm text-muted-foreground">
            Você não tem acesso ao Espaço do Colaborador. Peça a liberação em
            Administração → Acesso por Usuário.
          </Card>
        </div>
      }
    >
      <Conteudo />
    </AcessoGate>
  );
}

function Conteudo() {
  const [filtro, setFiltro] = useState("");
  const [alvo, setAlvo] = useState<{ contrato: NoContrato; papel: PapelDesignacao } | null>(null);

  const { data: arvore, isLoading: carregandoArvore } = useArvoreContratos();
  const { data: designacoes = [], isLoading: carregandoDesig } = useDesignacoes();

  const porContrato = useMemo(() => {
    const m = new Map<string, Designacao[]>();
    for (const d of designacoes) {
      if (!m.has(d.contrato_id)) m.set(d.contrato_id, []);
      m.get(d.contrato_id)!.push(d);
    }
    return m;
  }, [designacoes]);

  const contratos = useMemo(() => {
    const termo = filtro.trim().toLowerCase();
    return (arvore?.contratos ?? []).filter(
      (c) => !termo || c.nome.toLowerCase().includes(termo) || (c.cliente ?? "").toLowerCase().includes(termo),
    );
  }, [arvore, filtro]);

  // As duas pendências que a tela existe para tornar visíveis.
  const inativos = designacoes.filter((d) => !d.pessoa_ativa);
  const semSupervisor = (arvore?.contratos ?? []).filter(
    (c) => !c.encerrado && !(porContrato.get(c.id) ?? []).some((d) => d.papel === "supervisor"),
  );

  const carregando = carregandoArvore || carregandoDesig;

  return (
    <div className="p-6">
      <Link
        to={ROTA_BASE}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar para a árvore
      </Link>

      <PageHeader
        title="Responsáveis por contrato"
        subtitle="Quem a Operação designou como supervisor e encarregado. Trocar aqui preserva o histórico."
        module="Central de Serviços"
        breadcrumb={["Espaço do Colaborador", "Responsáveis"]}
      />

      {/* As pendências vêm ANTES da lista: são elas que exigem ação, e
          enterradas no meio de 58 contratos ninguém veria. */}
      {inativos.length > 0 && (
        <Card className="mb-4 border-destructive/40 bg-destructive/5 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {inativos.length} designação(ões) apontando para quem saiu da empresa
          </p>
          <div className="space-y-1 text-xs">
            {inativos.map((d) => (
              <p key={d.id}>
                <strong>{d.contrato_nome}</strong> — {d.papel}: {d.empregado_nome}{" "}
                <span className="text-muted-foreground">({d.situacao ?? "inativo"})</span>
              </p>
            ))}
          </div>
        </Card>
      )}

      {semSupervisor.length > 0 && (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-amber-700">
            <AlertTriangle className="h-4 w-4" />
            {semSupervisor.length} contrato(s) ativo(s) sem supervisor designado
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {semSupervisor.map((c) => c.nome).join(" · ")}
          </p>
        </Card>
      )}

      <div className="relative mb-4 max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Filtrar contrato pelo nome ou cliente…"
          className="pl-9"
        />
      </div>

      {carregando ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </Card>
      ) : (
        <div className="space-y-2">
          {contratos.map((c) => (
            <LinhaContrato
              key={c.id}
              contrato={c}
              designacoes={porContrato.get(c.id) ?? []}
              onDesignar={(papel) => setAlvo({ contrato: c, papel })}
            />
          ))}
        </div>
      )}

      {alvo && (
        <DialogoDesignar
          contrato={alvo.contrato}
          papel={alvo.papel}
          atual={(porContrato.get(alvo.contrato.id) ?? []).filter((d) => d.papel === alvo.papel)}
          onFechar={() => setAlvo(null)}
        />
      )}
    </div>
  );
}

function LinhaContrato({
  contrato, designacoes, onDesignar,
}: {
  contrato: NoContrato;
  designacoes: Designacao[];
  onDesignar: (papel: PapelDesignacao) => void;
}) {
  const sup = designacoes.filter((d) => d.papel === "supervisor");
  const enc = designacoes.filter((d) => d.papel === "encarregado");

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Building2 className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 font-semibold leading-tight">{contrato.nome}</span>
        {contrato.encerrado && (
          <Badge variant="outline" className="border-amber-500/40 text-amber-600">encerrado</Badge>
        )}
        <Badge variant="secondary" className="shrink-0">{contrato.colaboradores} pessoas</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Papel titulo="Supervisor" icone={ShieldCheck} itens={sup} onDesignar={() => onDesignar("supervisor")} />
        <Papel titulo="Encarregado" icone={UserCog} itens={enc} onDesignar={() => onDesignar("encarregado")} />
      </div>
    </Card>
  );
}

function Papel({
  titulo, icone: Icone, itens, onDesignar,
}: {
  titulo: string; icone: typeof ShieldCheck; itens: Designacao[]; onDesignar: () => void;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icone className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {titulo}
        </span>
        <AcessoGate menu="central_servicos_espaco_colaborador" acao="alterar">
          <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={onDesignar}>
            {itens.length ? "Trocar" : "Designar"}
          </Button>
        </AcessoGate>
      </div>

      {itens.length === 0 ? (
        <p className="text-xs text-amber-600">Ninguém designado.</p>
      ) : (
        <div className="space-y-1">
          {itens.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Link to={`${ROTA_BASE}/${d.empregado_id}`} className="font-medium hover:underline">
                {d.empregado_nome}
              </Link>
              {d.posto && (
                <Badge variant="outline" className="h-4 px-1.5 text-[10px]">{d.posto}</Badge>
              )}
              {!d.pessoa_ativa && (
                <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                  {d.situacao ?? "inativo"}
                </Badge>
              )}
              <span className="w-full text-[11px] text-muted-foreground">
                desde {new Date(`${d.vigente_de}T12:00:00`).toLocaleDateString("pt-BR")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Escolher a pessoa.
 *
 * A busca é a mesma da árvore (`esp_col_colaboradores`), no servidor: são
 * 2.4 mil ativos, e mandar todos para o navegador para filtrar aqui é o que
 * trava a tela.
 */
function DialogoDesignar({
  contrato, papel, atual, onFechar,
}: {
  contrato: NoContrato; papel: PapelDesignacao; atual: Designacao[]; onFechar: () => void;
}) {
  const [termo, setTermo] = useState("");
  const [posto, setPosto] = useState("");
  const { data: achados = [], isFetching } = useBuscaColaboradores(termo);
  const designar = useDesignar();

  const salvar = async (p: ColaboradorLinha | null) => {
    try {
      await designar.mutateAsync({
        contratoId: contrato.id,
        papel,
        empregadoId: p?.empregado_id ?? null,
        // Posto só faz sentido para encarregado — supervisor responde pelo
        // contrato inteiro.
        posto: papel === "encarregado" ? posto.trim() || null : null,
      });
      toast.success(p ? `${p.nome} designado como ${papel}.` : "Designação encerrada.");
      onFechar();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent className="max-w-lg">
        <DialogTitle>
          {atual.length ? "Trocar" : "Designar"} {papel}
        </DialogTitle>
        <DialogDescription>
          {contrato.nome}
          {atual.length > 0 && (
            <> · hoje: <strong>{atual.map((d) => d.empregado_nome).join(", ")}</strong></>
          )}
        </DialogDescription>

        {papel === "encarregado" && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Posto (opcional — vazio designa para o contrato inteiro)
            </label>
            <Input
              value={posto}
              onChange={(e) => setPosto(e.target.value)}
              placeholder="Ex.: RECEPÇÃO ÁREA SUL"
              className="mt-1"
            />
          </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar pelo nome (2 letras ou mais)…"
            className="pl-9"
          />
          {isFetching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        <div className="max-h-64 divide-y overflow-y-auto rounded border">
          {achados.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              {termo.trim().length < 2 ? "Digite ao menos 2 letras." : "Ninguém encontrado."}
            </p>
          ) : (
            achados.map((p) => (
              <button
                key={p.empregado_id}
                type="button"
                disabled={designar.isPending}
                onClick={() => salvar(p)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60 disabled:opacity-50"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{p.nome}</span>
                <span className="hidden truncate text-xs text-muted-foreground sm:block">{p.cargo}</span>
                {p.matricula && (
                  <Badge variant="outline" className="shrink-0 text-[10px]">#{p.matricula}</Badge>
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-2">
          {atual.length > 0 && (
            // Encerrar sem substituir é um caso legítimo — o contrato acabou,
            // ou a Operação ainda não decidiu quem entra. Melhor registrar
            // "ninguém" que deixar um nome errado de pé.
            <Button
              variant="outline"
              size="sm"
              className={cn("gap-1.5 text-destructive", designar.isPending && "opacity-50")}
              disabled={designar.isPending}
              onClick={() => salvar(null)}
            >
              <X className="h-4 w-4" /> Encerrar sem substituir
            </Button>
          )}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onFechar}>
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
