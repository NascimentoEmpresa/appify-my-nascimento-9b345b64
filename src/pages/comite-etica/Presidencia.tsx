import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "./db";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Archive, CheckCircle2, Gavel, Hourglass, RotateCcw, Search, UserX } from "lucide-react";
import {
  SITUACOES_PRESIDENCIA, LABEL_GRAVIDADE, LABEL_RECOMENDACAO, LABEL_SITUACAO, LABEL_TIPO,
  COR_GRAVIDADE, rotulo,
} from "./vocabulario";
import { type Denuncia, diasParado, tipoEfetivo } from "./metricas";
import { usePermissoes } from "@/context/PermissoesContext";
import FichaPresidencia from "./FichaPresidencia";

// =====================================================================
// COMITÊ DE ÉTICA — Painel da Presidência
//
// A fila da diretoria: as denúncias que já saíram da apuração e dependem
// de decisão ou de acompanhamento (SITUACOES_PRESIDENCIA). Aqui ela lê o
// parecer do Comitê, registra a decisão da Presidência e muda a situação —
// o Comitê vê o resultado no submódulo Denúncias, que é a mesma tabela.
//
// Quem enxerga: quem tem o menu 'comite_etica_presidencia_painel'. O recorte
// por situação e por empresa é do BANCO (v_canal_denuncia, 20260930000201);
// o `.in("status", …)` abaixo só existe para quem também é do Comitê e, por
// isso, recebe a fila inteira da visão.
// =====================================================================

const CARDS: { status: string; icon: typeof Gavel; tone: string }[] = [
  { status: "aguardando_presidencia", icon: Gavel, tone: "text-primary" },
  { status: "aguardando_cumprimento", icon: Hourglass, tone: "text-warning" },
  { status: "concluida", icon: CheckCircle2, tone: "text-success" },
  { status: "arquivada", icon: Archive, tone: "text-muted-foreground" },
  { status: "reaberta", icon: RotateCcw, tone: "text-destructive" },
];

const CLS_SITUACAO: Record<string, string> = {
  aguardando_presidencia: "border-primary/30 bg-primary/10 text-primary",
  aguardando_cumprimento: "border-warning/30 bg-warning/10 text-warning",
  concluida: "border-border bg-muted text-muted-foreground",
  arquivada: "border-border bg-muted text-muted-foreground",
  reaberta: "border-destructive/30 bg-destructive/10 text-destructive",
};

export default function PresidenciaComiteEtica() {
  const qc = useQueryClient();
  const { can } = usePermissoes();
  const podeDecidir = can("visualizar", undefined, "comite_etica_presidencia");
  const podeVerSigiloso = can("visualizar", undefined, "comite_etica_sigilo");
  // O que pede ação vem aberto; concluída e arquivada são consulta.
  const [fStatus, setFStatus] = useState("aguardando_presidencia");
  const [busca, setBusca] = useState("");
  // Guarda o id, não a linha: depois de salvar, a ficha relê a versão nova
  // da lista — e fecha sozinha se o caso foi devolvido ao Comitê.
  const [alvoId, setAlvoId] = useState<string | null>(null);

  const { data: denuncias = [], isLoading } = useQuery({
    queryKey: ["comite-etica-presidencia"],
    queryFn: async () => {
      const { data, error } = await db
        .from("v_canal_denuncia").select("*")
        .in("status", SITUACOES_PRESIDENCIA)
        .order("ultima_movimentacao_em", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Denuncia[];
    },
  });

  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of denuncias) c[d.status] = (c[d.status] ?? 0) + 1;
    return c;
  }, [denuncias]);

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return denuncias.filter((d) => {
      if (fStatus !== "todas" && d.status !== fStatus) return false;
      if (!t) return true;
      return [d.protocolo, d.titulo, d.resumo, d.empresa_nome, d.contrato, d.setor,
              d.denunciado_nome, d.apuracao_responsavel]
        .some((c) => (c ?? "").toString().toLowerCase().includes(t));
    });
  }, [denuncias, fStatus, busca]);

  const alvo = alvoId ? denuncias.find((d) => d.id === alvoId) ?? null : null;

  const recarregar = () => {
    qc.invalidateQueries({ queryKey: ["comite-etica-presidencia"] });
    // A fila do Comitê lê a mesma visão com outra chave.
    qc.invalidateQueries({ queryKey: ["canal-denuncias"] });
  };

  return (
    <div>
      <PageHeader
        title="Presidência"
        subtitle="Denúncias apuradas pelo Comitê que aguardam decisão ou acompanhamento da Presidência. Conteúdo confidencial."
        module="Comitê de Ética"
        breadcrumb={["Comitê de Ética", "Presidência"]}
      />

      {!podeDecidir && (
        <Card className="mb-4 border-warning/30 bg-warning/5 p-3">
          <p className="text-xs text-warning">
            Você consegue ver e dar seguimento às denúncias, mas registrar a decisão exige a liberação
            de “Pode registrar a decisão da Presidência”.
          </p>
        </Card>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {CARDS.map((s) => {
          const on = fStatus === s.status;
          return (
            <button
              key={s.status} type="button"
              onClick={() => setFStatus(on ? "todas" : s.status)}
              className="text-left"
            >
              <Card className={`flex items-center gap-3 p-4 transition-colors ${
                on ? "border-primary ring-1 ring-primary" : "hover:border-primary/40"}`}>
                <s.icon className={`h-5 w-5 shrink-0 ${s.tone}`} />
                <div>
                  <p className="text-2xl font-bold leading-none">{contagem[s.status] ?? 0}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{LABEL_SITUACAO[s.status]}</p>
                </div>
              </Card>
            </button>
          );
        })}
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9" placeholder="Buscar por protocolo, assunto, empresa, contrato ou pessoa…"
              value={busca} onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          {fStatus !== "todas" && (
            <Badge variant="outline" className="cursor-pointer gap-1" onClick={() => setFStatus("todas")}>
              {LABEL_SITUACAO[fStatus]} · mostrar todas
            </Badge>
          )}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Protocolo</TableHead>
                <TableHead>Assunto</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Grav.</TableHead>
                <TableHead>Empresa / Contrato</TableHead>
                <TableHead>Recomendação do Comitê</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Parado há</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  Carregando…
                </TableCell></TableRow>
              )}
              {!isLoading && filtradas.length === 0 && (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  {denuncias.length === 0
                    ? "Nenhuma denúncia aguardando a Presidência."
                    : "Nenhuma denúncia com esse filtro."}
                </TableCell></TableRow>
              )}
              {filtradas.map((d) => {
                const parado = diasParado(d);
                return (
                  <TableRow key={d.id} className="cursor-pointer" onClick={() => setAlvoId(d.id)}>
                    <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">
                      <span className="flex items-center gap-1.5">
                        {d.protocolo}
                        {!d.identificado && <UserX className="h-3.5 w-3.5 text-muted-foreground" />}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[220px] text-xs">
                      <span className="block truncate font-medium">{d.titulo || d.resumo || d.descricao}</span>
                    </TableCell>
                    <TableCell className="text-xs">{rotulo(LABEL_TIPO, tipoEfetivo(d))}</TableCell>
                    <TableCell>
                      {d.gravidade
                        ? <Badge variant="outline" className="text-[10px] font-semibold"
                                 style={{ color: COR_GRAVIDADE[d.gravidade], borderColor: COR_GRAVIDADE[d.gravidade] }}>
                            {rotulo(LABEL_GRAVIDADE, d.gravidade)}
                          </Badge>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="max-w-[180px] text-xs">
                      <span className="block truncate">{d.empresa_nome || "—"}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {d.contrato || d.contrato_informado || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{rotulo(LABEL_RECOMENDACAO, d.recomendacao)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] font-semibold ${CLS_SITUACAO[d.status] ?? ""}`}>
                        {rotulo(LABEL_SITUACAO, d.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {parado === null ? "—" : `${parado} d`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Mostrando {filtradas.length} de {denuncias.length}. Clique numa linha para ler o parecer e decidir.
        </p>
      </Card>

      <FichaPresidencia
        denuncia={alvo}
        podeDecidir={podeDecidir}
        podeVerSigiloso={podeVerSigiloso}
        onFechar={() => setAlvoId(null)}
        onSalvo={recarregar}
      />
    </div>
  );
}
