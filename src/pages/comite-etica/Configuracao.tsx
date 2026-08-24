import { useCallback, useEffect, useState } from "react";
import { db } from "./db";
import { useToast } from "@/hooks/use-toast";
import { usePermissoes } from "@/context/PermissoesContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Building2, Plus, Trash2, UserCog, Loader2, Timer, Lock } from "lucide-react";
import { GRAVIDADE, rotulo, LABEL_GRAVIDADE } from "./vocabulario";

// =====================================================================
// COMITÊ DE ÉTICA — configuração do canal
//
// Três cadastros que antes eram constante no código ou texto livre:
//
//   · EMPRESAS      — as opções do campo obrigatório "Empresa" no formulário
//     público. Era o pedido explícito de "permitir o cadastramento futuro de
//     outras empresas": incluir uma empresa não pode exigir deploy.
//   · RESPONSÁVEIS  — quem pode conduzir uma apuração. Fecha o texto livre
//     que fazia "Ana", "ana" e "Ana Paula" virarem três responsáveis no
//     relatório — e é para esta lista que o alerta diário é enviado.
//   · PRAZOS        — o SLA por gravidade, incluindo em quantos dias sem
//     movimentação o procedimento é sinalizado como parado.
//
// Quem entra aqui: só a capacidade `comite_etica_sigilo`, que é quem manda no
// módulo. A RLS cobra o mesmo — isto aqui é só a porta.
// =====================================================================

interface EmpresaOpcao {
  id: string; rotulo: string; padrao_empregados: string | null;
  /** Empresa do cadastro fiscal. É o que liga o recorte de acesso ao caso. */
  empresa_id: string | null;
  ordem: number; ativo: boolean;
}
interface EmpresaCadastro { id: string; codigo: string; razao_social: string | null; }
interface Responsavel {
  id: string; user_id: string; nome: string; papel: string | null; ativo: boolean;
}
interface Perfil { id: string; display_name: string | null; email: string | null; }
interface Sla {
  gravidade: string; dias: number;
  dias_primeira_providencia: number; dias_sem_movimentacao: number;
}

export default function ConfiguracaoComiteEtica() {
  const { toast } = useToast();
  const { can } = usePermissoes();
  const podeMexer = can("visualizar", undefined, "comite_etica_sigilo");

  const [empresas, setEmpresas] = useState<EmpresaOpcao[]>([]);
  const [responsaveis, setResponsaveis] = useState<Responsavel[]>([]);
  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [slas, setSlas] = useState<Sla[]>([]);
  const [cadastro, setCadastro] = useState<EmpresaCadastro[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [novaEmpresa, setNovaEmpresa] = useState({ rotulo: "", padrao: "" });
  const [buscaPerfil, setBuscaPerfil] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const [e, r, s, c] = await Promise.all([
      db.from("CANAL_DENUNCIA_EMPRESA").select("*").order("ordem"),
      db.from("COMITE_ETICA_RESPONSAVEL").select("*").order("nome"),
      db.from("COMITE_ETICA_SLA").select("*").order("dias"),
      db.from("empresas").select("id, codigo, razao_social").eq("ativa", true).order("codigo"),
    ]);
    setEmpresas((e.data ?? []) as EmpresaOpcao[]);
    setResponsaveis((r.data ?? []) as Responsavel[]);
    setSlas((s.data ?? []) as Sla[]);
    setCadastro((c.data ?? []) as EmpresaCadastro[]);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // Perfis só são buscados quando alguém vai de fato adicionar responsável:
  // a base tem milhares de linhas e não há por que trazê-la para ver a tela.
  useEffect(() => {
    const termo = buscaPerfil.trim();
    if (termo.length < 2) { setPerfis([]); return; }
    const t = setTimeout(async () => {
      const { data } = await db.from("profiles")
        .select("id, display_name, email")
        .or(`display_name.ilike.%${termo}%,email.ilike.%${termo}%`)
        .eq("ativo", true).limit(10);
      setPerfis((data ?? []) as Perfil[]);
    }, 300);
    return () => clearTimeout(t);
  }, [buscaPerfil]);

  const erro = (e: { message: string }) =>
    toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" });

  // ---------------------------------------------------------- empresas
  const addEmpresa = async () => {
    const rot = novaEmpresa.rotulo.trim();
    if (!rot) { toast({ title: "Informe o nome da empresa.", variant: "destructive" }); return; }
    setSalvando(true);
    const { error } = await db.from("CANAL_DENUNCIA_EMPRESA").insert({
      rotulo: rot,
      padrao_empregados: novaEmpresa.padrao.trim() || null,
      ordem: (empresas.at(-1)?.ordem ?? 0) + 10,
    });
    setSalvando(false);
    if (error) return erro(error);
    setNovaEmpresa({ rotulo: "", padrao: "" });
    carregar();
  };

  const mudarEmpresa = async (e: EmpresaOpcao, patch: Partial<EmpresaOpcao>) => {
    const { error } = await db.from("CANAL_DENUNCIA_EMPRESA").update(patch).eq("id", e.id);
    if (error) return erro(error);
    carregar();
  };

  const excluirEmpresa = async (e: EmpresaOpcao) => {
    // Denúncia guarda `empresa_nome` como retrato, mas a FK em `empresa_id`
    // recusa apagar uma opção já usada. Desativar é o caminho: some do
    // formulário e continua explicando os casos antigos.
    if (!confirm(`Excluir a empresa "${e.rotulo}"? Se já houver denúncia com ela, prefira desativar.`)) return;
    const { error } = await db.from("CANAL_DENUNCIA_EMPRESA").delete().eq("id", e.id);
    if (error) {
      toast({
        title: "Esta empresa já tem denúncias",
        description: "Desative em vez de excluir — ela some do formulário e o histórico continua legível.",
        variant: "destructive",
      });
      return;
    }
    carregar();
  };

  // ------------------------------------------------------ responsáveis
  const addResponsavel = async (p: Perfil) => {
    const nome = p.display_name || p.email || "";
    const { error } = await db.from("COMITE_ETICA_RESPONSAVEL")
      .insert({ user_id: p.id, nome });
    if (error) return erro(error);
    setBuscaPerfil(""); setPerfis([]);
    carregar();
  };

  const mudarResponsavel = async (r: Responsavel, patch: Partial<Responsavel>) => {
    const { error } = await db.from("COMITE_ETICA_RESPONSAVEL").update(patch).eq("id", r.id);
    if (error) return erro(error);
    carregar();
  };

  const excluirResponsavel = async (r: Responsavel) => {
    if (!confirm(`Remover ${r.nome} do cadastro de responsáveis?`)) return;
    const { error } = await db.from("COMITE_ETICA_RESPONSAVEL").delete().eq("id", r.id);
    if (error) return erro(error);
    carregar();
  };

  // -------------------------------------------------------------- SLA
  const mudarSla = async (s: Sla, patch: Partial<Sla>) => {
    const { error } = await db.from("COMITE_ETICA_SLA").update(patch).eq("gravidade", s.gravidade);
    if (error) return erro(error);
    carregar();
  };

  if (!podeMexer) {
    return (
      <div>
        <PageHeader title="Configuração" module="Comitê de Ética"
                    breadcrumb={["Comitê de Ética", "Configuração"]} />
        <Card className="flex items-center gap-3 p-6">
          <Lock className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Esta tela exige a liberação de “Pode ver identidade e anexos sigilosos” em
            Administração › Acesso por Usuário.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Configuração do canal"
        subtitle="Empresas do formulário, responsáveis pela apuração e prazos."
        module="Comitê de Ética"
        breadcrumb={["Comitê de Ética", "Configuração"]}
      />

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* ------------------------------------------------ empresas */}
          <Card className="p-4">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">
              <Building2 className="h-4 w-4 text-muted-foreground" /> Empresas do formulário
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
              É o campo obrigatório “Empresa” que quem denuncia preenche. O <strong>vínculo</strong> liga a
              opção ao cadastro do ERP — é ele que decide quem enxerga o caso quando a pessoa não tem
              “Vê denúncias de todas as empresas”. O <strong>padrão de empregados</strong> é casado com a coluna
              “Nome da Empresa” para montar a lista de contratos; em branco, oferece todos.
            </p>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Vínculo com o cadastro</TableHead>
                  <TableHead>Padrão de empregados</TableHead>
                  <TableHead className="w-[90px]">Ativa</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {empresas.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Input defaultValue={e.rotulo} className="h-8"
                             onBlur={(ev) => ev.target.value.trim() !== e.rotulo
                               && mudarEmpresa(e, { rotulo: ev.target.value.trim() })} />
                    </TableCell>
                    <TableCell>
                      <select
                        className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                        value={e.empresa_id ?? ""}
                        aria-label={`Empresa do cadastro para ${e.rotulo}`}
                        onChange={(ev) => mudarEmpresa(e, { empresa_id: ev.target.value || null })}
                      >
                        <option value="">Sem vínculo — só quem vê todas enxerga</option>
                        {cadastro.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.codigo}{c.razao_social ? ` — ${c.razao_social}` : ""}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>
                      <Input defaultValue={e.padrao_empregados ?? ""} className="h-8"
                             placeholder="Ex.: %HAGG%"
                             onBlur={(ev) => ev.target.value.trim() !== (e.padrao_empregados ?? "")
                               && mudarEmpresa(e, { padrao_empregados: ev.target.value.trim() || null })} />
                    </TableCell>
                    <TableCell>
                      <Switch checked={e.ativo} onCheckedChange={(v) => mudarEmpresa(e, { ativo: v })} />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-8 w-8"
                              onClick={() => excluirEmpresa(e)} aria-label={`Excluir ${e.rotulo}`}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
              <Input className="max-w-[220px]" placeholder="Nome da empresa"
                     value={novaEmpresa.rotulo}
                     onChange={(e) => setNovaEmpresa((n) => ({ ...n, rotulo: e.target.value }))} />
              <Input className="max-w-[260px]" placeholder="Padrão de empregados (opcional)"
                     value={novaEmpresa.padrao}
                     onChange={(e) => setNovaEmpresa((n) => ({ ...n, padrao: e.target.value }))} />
              <Button onClick={addEmpresa} disabled={salvando} className="gap-1.5">
                {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Incluir empresa
              </Button>
            </div>
          </Card>

          {/* -------------------------------------------- responsáveis */}
          <Card className="p-4">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">
              <UserCog className="h-4 w-4 text-muted-foreground" /> Responsáveis pela apuração
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
              Quem pode ser designado numa ficha. É também para esta lista que o alerta diário de
              prazos é enviado — sem ninguém aqui, nenhum aviso sai.
            </p>

            {responsaveis.length === 0 ? (
              <p className="mb-3 text-sm text-muted-foreground">Nenhum responsável cadastrado.</p>
            ) : (
              <ul className="mb-3 flex flex-col gap-1.5">
                {responsaveis.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
                    <span className="flex-1 text-sm font-medium">{r.nome}</span>
                    <Input defaultValue={r.papel ?? ""} placeholder="Papel (opcional)"
                           className="h-8 max-w-[200px]"
                           onBlur={(ev) => ev.target.value.trim() !== (r.papel ?? "")
                             && mudarResponsavel(r, { papel: ev.target.value.trim() || null })} />
                    <Badge variant={r.ativo ? "default" : "outline"}>{r.ativo ? "ativo" : "inativo"}</Badge>
                    <Switch checked={r.ativo} onCheckedChange={(v) => mudarResponsavel(r, { ativo: v })} />
                    <Button variant="ghost" size="icon" className="h-8 w-8"
                            onClick={() => excluirResponsavel(r)} aria-label={`Remover ${r.nome}`}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t pt-3">
              <Input className="max-w-[320px]" placeholder="Buscar pessoa por nome ou e-mail…"
                     value={buscaPerfil} onChange={(e) => setBuscaPerfil(e.target.value)} />
              {perfis.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {perfis
                    .filter((p) => !responsaveis.some((r) => r.user_id === p.id))
                    .map((p) => (
                      <li key={p.id}>
                        <button type="button" onClick={() => addResponsavel(p)}
                                className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted">
                          {p.display_name || p.email}
                          {p.display_name && p.email && (
                            <span className="ml-2 text-xs text-muted-foreground">{p.email}</span>
                          )}
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </Card>

          {/* ------------------------------------------------------ SLA */}
          <Card className="p-4">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">
              <Timer className="h-4 w-4 text-muted-foreground" /> Prazos por gravidade
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
              “Sem movimentação” é a régua do abandono: conta desde a última vez que alguém encostou
              no procedimento, e não desde a abertura. São perguntas diferentes.
            </p>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gravidade</TableHead>
                  <TableHead className="w-[150px]">Prazo total (dias)</TableHead>
                  <TableHead className="w-[190px]">1ª providência (dias)</TableHead>
                  <TableHead className="w-[190px]">Sem movimentação (dias)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slas.map((s) => (
                  <TableRow key={s.gravidade}>
                    <TableCell className="font-medium">{rotulo(LABEL_GRAVIDADE, s.gravidade)}</TableCell>
                    {([
                      ["dias", s.dias],
                      ["dias_primeira_providencia", s.dias_primeira_providencia],
                      ["dias_sem_movimentacao", s.dias_sem_movimentacao],
                    ] as const).map(([campo, valor]) => (
                      <TableCell key={campo}>
                        <Input type="number" min={1} defaultValue={valor} className="h-8 w-24"
                               onBlur={(ev) => {
                                 const n = Number(ev.target.value);
                                 if (n > 0 && n !== valor) mudarSla(s, { [campo]: n } as Partial<Sla>);
                               }} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {slas.length === 0 && GRAVIDADE.map((g) => (
                  <TableRow key={g.value}>
                    <TableCell className="text-muted-foreground">{g.label}</TableCell>
                    <TableCell colSpan={3} className="text-xs text-muted-foreground">
                      Sem regra cadastrada — o padrão de 30 dias vale.
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}
