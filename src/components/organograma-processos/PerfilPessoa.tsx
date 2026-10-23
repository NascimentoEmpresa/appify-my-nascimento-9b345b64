import { useEffect, useState } from "react";
import { Briefcase, FileText, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CartaoPerfil } from "@/components/perfil/CartaoPerfil";
import { usePerfilPessoa, useSalvarBio } from "@/hooks/useEstruturaProcessos";
import { BIO_LIMITE, listaAtividades, rotuloNivel, type Estrutura } from "@/lib/organograma/estruturaProcessos";

// =====================================================================
// Perfil de uma pessoa do Organograma › Estrutura e Processos
// (mig 20261022000300). Clique no setor → clique na pessoa → aqui.
//
// A ficha é a mesma de Meu Perfil (CartaoPerfil); os dados vêm na hora pela
// RPC org_proc_perfil_pessoa — sem CPF nem nascimento. "O que faz na
// empresa" é profiles.bio: a mesma descrição de Meu Perfil, escrita pela
// própria pessoa ou por quem tem 'alterar' no Cadastro da Estrutura. Quem
// não tem login no ERP não tem profiles e, portanto, fica sem descrição.
// As funções e os processos vêm da estrutura que a tela está mostrando.
// =====================================================================

export interface PessoaAberta { membroId: string; empregadoId: number | null }

export function PerfilPessoa({ e, pessoa, onFechar, onProcesso }: {
  e: Estrutura; pessoa: PessoaAberta | null; onFechar: () => void; onProcesso: (id: string) => void;
}) {
  const q = usePerfilPessoa(pessoa?.membroId ?? null, pessoa?.empregadoId ?? null);
  const salvarBio = useSalvarBio();
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  useEffect(() => { setEditando(false); }, [pessoa?.membroId]);

  const p = q.data ?? null;
  const m = pessoa ? e.membros.find((x) => x.id === pessoa.membroId) ?? (p ? e.membros.find((x) => x.id === p.membro_id) : undefined) : undefined;
  const setor = e.setores.find((s) => s.id === (m?.setor_id ?? p?.setor_id));
  const funcoes = listaAtividades(m?.atividades ?? null);
  const processos = m ? e.processos.filter((x) => x.responsavel_membro_id === m.id).sort((a, b) => a.ordem - b.ordem) : [];
  const bio = p?.conta?.bio ?? "";

  return (
    <Sheet open={!!pessoa} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{p?.nome ?? m?.nome ?? "Perfil"}</SheetTitle>
          <SheetDescription>
            {[p?.cargo_organograma ?? m?.cargo, m ? rotuloNivel(m.nivel) : null, setor?.nome].filter(Boolean).join(" · ")}
          </SheetDescription>
        </SheetHeader>

        {q.isLoading && <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando perfil…</div>}
        {q.error && <p className="py-6 text-sm text-destructive">{(q.error as Error).message}</p>}
        {!q.isLoading && !q.error && !p && <p className="py-6 text-sm text-muted-foreground">Essa pessoa não está mais na estrutura.</p>}

        {p && (
          <div className="mt-4 space-y-4">
            {p.pendente && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                Ainda não vinculada ao cadastro de colaboradores — quem edita a estrutura escolhe a pessoa no Cadastro da Estrutura.
              </p>
            )}

            {!p.pendente && (
              <CartaoPerfil
                conta={{
                  nome: p.nome,
                  email: p.conta?.email ?? null,
                  avatarUrl: p.conta?.avatar_url ?? m?.avatar_url ?? null,
                  cargo: p.conta?.cargo ?? null,
                  telefone: p.conta?.telefone ?? null,
                }}
                empregado={p.empregado}
              />
            )}

            <section className="rounded-xl border bg-card p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Briefcase className="h-3.5 w-3.5" /> O que faz na empresa
                </h3>
                {p.pode_editar_bio && !editando && (
                  <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => { setRascunho(bio); setEditando(true); }}>
                    <Pencil className="h-3.5 w-3.5" /> {bio ? "Editar" : "Escrever"}
                  </Button>
                )}
              </div>
              {editando ? (
                <div className="space-y-2">
                  <Textarea rows={5} maxLength={BIO_LIMITE} value={rascunho} onChange={(x) => setRascunho(x.target.value)}
                    placeholder="No que trabalha, pelo que responde, quando procurar essa pessoa…" autoFocus />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {rascunho.length}/{BIO_LIMITE} · {p.eu ? "é a mesma descrição de Meu Perfil" : "aparece também no Meu Perfil da pessoa"}
                    </span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditando(false)}>Cancelar</Button>
                      <Button size="sm" disabled={salvarBio.isPending} onClick={async () => {
                        try {
                          await salvarBio.mutateAsync({ membroId: p.membro_id, bio: rascunho });
                          toast.success("Descrição salva.");
                          setEditando(false);
                        } catch (err) { toast.error((err as Error).message); }
                      }}>{salvarBio.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Salvar</Button>
                    </div>
                  </div>
                </div>
              ) : bio ? (
                <p className="whitespace-pre-wrap text-sm text-foreground/90">{bio}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {!p.tem_login
                    ? "Sem login no ERP — a descrição fica disponível quando a pessoa tiver acesso."
                    : p.eu ? "Você ainda não escreveu o que faz. Conte aqui ou em Meu Perfil." : "Ainda sem descrição."}
                </p>
              )}
            </section>

            {(funcoes.length > 0 || processos.length > 0) && (
              <section className="rounded-xl border bg-card p-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Funções e processos no organograma</h3>
                {funcoes.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-sm text-foreground/85">{funcoes.map((f, i) => <li key={i}>{f}</li>)}</ul>}
                {processos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {processos.map((x) => (
                      <button key={x.id} onClick={() => onProcesso(x.id)} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs font-medium hover:border-primary">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" /> {x.nome} <span className="text-[10px] text-muted-foreground">{x.codigo}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
