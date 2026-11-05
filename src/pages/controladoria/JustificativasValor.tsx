import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useContratosERP } from "@/hooks/useContratosERP";
import { useJustificativas } from "@/hooks/useJustificativasValor";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useUsuariosAtivos } from "@/hooks/useNfEmissao";
import { rotuloMes } from "./faturamento/useBaseFaturamento";
import { COR_STATUS, PainelJustificativa } from "./justificativas/PainelJustificativa";
import { prazoVencido, ROTULO_STATUS, type StatusJustificativa } from "./justificativas/regras";

// SIS-2026-0807: duas telas com o mesmo miolo.
//   modo "gestao" (/controladoria/justificativas): a Controladoria vê todas as cobranças, acompanha prazo e resposta e encerra, devolve ou cancela.
//   modo "minhas" (/controladoria/minhas-justificativas): cada gerente vê só o que foi cobrado dele e responde, sem precisar de acesso ao Fluxo de Caixa.
// A RLS já separa quem vê o quê; aqui o modo só decide o texto e as ações.

const TODOS = "todos";
const dia = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

export default function JustificativasValor({ modo }: { modo: "gestao" | "minhas" }) {
  const menu = modo === "gestao" ? "justificativas-valor" : "minhas-justificativas";
  const { user } = useAuth();
  const { data: justificativas = [], isLoading, error } = useJustificativas();
  const { data: contratos = [] } = useContratosERP({ todasEmpresas: true });
  const { data: usuarios = [] } = useUsuariosAtivos();
  const { data: podeAlterar = false } = useScreenAccess(menu, "alterar");
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<string>(modo === "minhas" ? "aberta" : TODOS);
  const [busca, setBusca] = useState("");
  const [abertaId, setAbertaId] = useState<string | null>(params.get("id"));

  // Link do sino (?id=…) abre a cobrança direto.
  useEffect(() => { setAbertaId(params.get("id")); }, [params]);

  const nomeContrato = useMemo(() => {
    const mapa = new Map(contratos.map((c) => [c.id, c.nome]));
    return (id: string) => mapa.get(id) ?? "Contrato";
  }, [contratos]);
  const nomeUsuario = useMemo(() => {
    const mapa = new Map(usuarios.map((u) => [u.id, u.display_name]));
    return (id: string | null) => (id ? (mapa.get(id) ?? (id === user?.id ? "Você" : "Usuário")) : "—");
  }, [usuarios, user?.id]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return justificativas.filter((j) => {
      if (status !== TODOS && j.status !== status) return false;
      if (termo && !`${j.numero} ${nomeContrato(j.contrato_id)} ${j.coluna_rotulo} ${j.pergunta}`.toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [justificativas, status, busca, nomeContrato]);

  const contagem = useMemo(() => {
    const c: Record<StatusJustificativa, number> = { aberta: 0, respondida: 0, encerrada: 0, cancelada: 0 };
    for (const j of justificativas) c[j.status] += 1;
    return c;
  }, [justificativas]);
  const vencidas = useMemo(() => justificativas.filter((j) => prazoVencido(j)).length, [justificativas]);
  const aberta = justificativas.find((j) => j.id === abertaId) ?? null;

  function fechar() {
    setAbertaId(null);
    if (params.has("id")) { params.delete("id"); setParams(params, { replace: true }); }
  }

  return (
    <AcessoGate menu={menu} acao="visualizar" fallback={<div className="p-6 text-sm text-muted-foreground">Sem acesso a esta tela.</div>}>
      <div className="space-y-6">
        <PageHeader
          module="Controladoria"
          breadcrumb={[modo === "gestao" ? "Justificativas de Valor" : "Minhas Justificativas"]}
          title={modo === "gestao" ? "Justificativas de Valor" : "Minhas Justificativas"}
          subtitle={modo === "gestao"
            ? "Cobranças que a Controladoria fez sobre valores da Lucratividade de Contratos: acompanhe prazo e resposta, encerre ou devolva. Para cobrar, use a coluna Justificativa na Lucratividade."
            : "Valores que a Controladoria pediu para você explicar. Abra a cobrança, veja os lançamentos em dúvida e responda."}
        />

        <div className="card-elevated flex flex-wrap items-center gap-2 p-3 text-xs">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas ({justificativas.length})</SelectItem>
              {(Object.keys(ROTULO_STATUS) as StatusJustificativa[]).map((s) => <SelectItem key={s} value={s}>{ROTULO_STATUS[s]} ({contagem[s]})</SelectItem>)}
            </SelectContent>
          </Select>
          {vencidas > 0 && <Badge className="bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300">{vencidas} com prazo vencido</Badge>}
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar número, contrato, coluna…" className="ml-auto h-8 w-[260px] text-xs" />
        </div>

        {error ? (
          <p className="py-10 text-center text-sm text-red-600">Não foi possível carregar: {(error as Error).message}</p>
        ) : isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="card-elevated overflow-x-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Mês</TableHead>
                  <TableHead>Coluna</TableHead>
                  <TableHead>{modo === "gestao" ? "Responsável" : "Cobrada por"}</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-center">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((j) => (
                  <TableRow key={j.id} className="cursor-pointer" onClick={() => setAbertaId(j.id)}>
                    <TableCell className="whitespace-nowrap font-mono">{j.numero}</TableCell>
                    <TableCell className="max-w-[220px] truncate" title={nomeContrato(j.contrato_id)}>{nomeContrato(j.contrato_id)}</TableCell>
                    <TableCell className="whitespace-nowrap">{rotuloMes(j.mes.slice(0, 7))}</TableCell>
                    <TableCell>{j.coluna_rotulo}</TableCell>
                    <TableCell>{nomeUsuario(modo === "gestao" ? j.responsavel_id : j.created_by)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {dia(j.prazo)}{prazoVencido(j) && <Badge className="ml-1 bg-red-100 text-[10px] text-red-800 dark:bg-red-950/40 dark:text-red-300">vencido</Badge>}
                    </TableCell>
                    <TableCell><Badge className={COR_STATUS[j.status]}>{ROTULO_STATUS[j.status]}</Badge></TableCell>
                    <TableCell className="text-center">
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={(e) => { e.stopPropagation(); setAbertaId(j.id); }}>
                        {modo === "minhas" && j.status === "aberta" ? "Responder" : "Abrir"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {lista.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    {modo === "minhas" ? "Nenhuma justificativa com este filtro." : "Nenhuma cobrança com este filtro."}
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <PainelJustificativa justificativa={aberta} onClose={fechar} modo={modo} podeAgir={podeAlterar} nomeContrato={nomeContrato} nomeUsuario={nomeUsuario} />
    </AcessoGate>
  );
}
