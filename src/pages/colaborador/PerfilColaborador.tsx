import { useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useSessaoColaborador } from "./ColaboradorShell";
import { fmtData, useAlterarSenhaColaborador, useAtualizarDadosColaborador, type PerfilColaborador } from "@/hooks/useColaboradorPortal";
import { Chip, Dado, GradeDados, Secao, tomStatus } from "./ui";

// =====================================================================
// PORTAL DO COLABORADOR — Meu perfil
// A ficha de EMPREGADOS que é da própria pessoa (col_perfil devolve só o
// que é dela — nada de dados bancários aqui, esses ficam em Salário) e a
// troca de senha do portal.
// =====================================================================

export default function PerfilColaborador() {
  const { perfil } = useSessaoColaborador();
  const iniciais = perfil.nome.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-hero font-display text-xl font-bold text-white">{iniciais}</div>
        <div className="min-w-0">
          <h1 className="truncate font-display text-lg font-bold leading-tight">{perfil.nome}</h1>
          <p className="truncate text-sm text-muted-foreground">{perfil.cargo ?? "Cargo não informado"}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Chip tom={tomStatus(perfil.situacao)}>{perfil.situacao ?? "—"}</Chip>
            {perfil.matricula && <Chip>Matrícula {perfil.matricula}</Chip>}
          </div>
        </div>
      </div>

      <Secao titulo="Dados pessoais">
        <GradeDados>
          <Dado rotulo="CPF" valor={perfil.cpf} mono sempre />
          <Dado rotulo="Nascimento" valor={fmtData(perfil.nascimento)} sempre />
          <Dado rotulo="Escolaridade" valor={perfil.instrucao} />
          <Dado rotulo="Nacionalidade" valor={perfil.nacionalidade} />
          <Dado rotulo="PIS" valor={perfil.pis} mono />
          <Dado rotulo="CTPS" valor={perfil.ctps} mono />
        </GradeDados>
      </Secao>

      <DadosProprios perfil={perfil} />

      <Secao titulo="Vínculo">
        <GradeDados>
          <Dado rotulo="Empresa" valor={perfil.empresa} sempre />
          <Dado rotulo="Filial / contrato" valor={perfil.filial} sempre />
          <Dado rotulo="Cargo" valor={perfil.cargo} sempre />
          <Dado rotulo="No cargo desde" valor={fmtData(perfil.data_cargo)} />
          <Dado rotulo="Posto" valor={perfil.posto} />
          <Dado rotulo="Local" valor={perfil.local} />
          <Dado rotulo="Setor" valor={perfil.setor} />
          <Dado rotulo="Centro de custo" valor={perfil.centro_custo} />
          <Dado rotulo="Admissão" valor={fmtData(perfil.admissao)} sempre />
          <Dado rotulo="Tipo de contrato" valor={perfil.tipo_contrato} />
          <Dado rotulo="Categoria" valor={perfil.categoria} />
          <Dado rotulo="Escala" valor={perfil.escala} />
          {perfil.data_afastamento && <Dado rotulo="Afastamento" valor={fmtData(perfil.data_afastamento)} />}
        </GradeDados>
      </Secao>

      <Seguranca senhaPropria={perfil.senha_propria} />

      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        Encontrou algum outro dado errado? O restante da ficha vem do cadastro do RH — procure o RH da sua unidade para corrigir.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Sexo, estado civil, celular/WhatsApp (06/10/2026, mig 20261006000007) e
// e-mail (mig 20261006000008 — esse é a própria coluna email da EMPREGADOS).
// Vinham da Senior e estavam errados (ex.: colaboradora viúva aparecendo
// como "Masculino / Solteiro"). Agora são do colaborador: começam vazios,
// ele preenche e corrige quando quiser. Gravam em colunas próprias da
// EMPREGADOS, que a sincronização com a Senior não sobrescreve.
// ---------------------------------------------------------------------

const SEXOS = ["Feminino", "Masculino"];
const ESTADOS_CIVIS = ["Solteiro(a)", "Casado(a)", "União estável", "Divorciado(a)", "Separado(a)", "Viúvo(a)"];

/** "51996287270" → "(51) 99628-7270". */
export function formatarCelular(digitos: string | null | undefined): string {
  const d = (digitos ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

function DadosProprios({ perfil }: { perfil: PerfilColaborador }) {
  const [editando, setEditando] = useState(false);
  const [sexo, setSexo] = useState("");
  const [estadoCivil, setEstadoCivil] = useState("");
  const [celular, setCelular] = useState("");
  const [email, setEmail] = useState("");
  const salvar = useAtualizarDadosColaborador();

  const abrir = () => {
    setSexo(perfil.sexo ?? ""); setEstadoCivil(perfil.estado_civil ?? ""); setCelular(formatarCelular(perfil.celular_whatsapp)); setEmail(perfil.email ?? "");
    setEditando(true);
  };
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const dig = celular.replace(/\D/g, "");
    if (dig && (dig.length < 10 || dig.length > 13)) { toast.error("Celular inválido — informe com DDD, ex.: (51) 99999-9999."); return; }
    const mail = email.trim().toLowerCase();
    if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) { toast.error("E-mail inválido."); return; }
    try {
      await salvar.mutateAsync({ sexo: sexo || null, estado_civil: estadoCivil || null, celular: dig || null, email: mail || null });
      toast.success("Dados atualizados.");
      setEditando(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar.");
    }
  };

  const nada = !perfil.sexo && !perfil.estado_civil && !perfil.celular_whatsapp && !perfil.email;
  return (
    <Secao
      titulo="Seus dados"
      descricao={nada && !editando ? "Ainda não informados. Toque em Editar para preencher." : "Você mesmo mantém estes dados atualizados."}
      acao={!editando ? <button onClick={abrir} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"><Pencil className="h-3.5 w-3.5" /> Editar</button> : undefined}
    >
      {!editando ? (
        <GradeDados>
          <Dado rotulo="Sexo" valor={perfil.sexo} sempre />
          <Dado rotulo="Estado civil" valor={perfil.estado_civil} sempre />
          <Dado rotulo="Celular / WhatsApp" valor={formatarCelular(perfil.celular_whatsapp)} mono sempre />
          <Dado rotulo="E-mail" valor={perfil.email} sempre />
        </GradeDados>
      ) : (
        <form onSubmit={enviar} className="space-y-3">
          <Escolha rotulo="Sexo" valor={sexo} onChange={setSexo} opcoes={SEXOS} />
          <Escolha rotulo="Estado civil" valor={estadoCivil} onChange={setEstadoCivil} opcoes={ESTADOS_CIVIS} />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold">Celular / WhatsApp (com DDD)</span>
            <input type="tel" inputMode="tel" autoComplete="tel" placeholder="(51) 99999-9999" value={celular}
              onChange={(e) => setCelular(e.target.value)} onBlur={() => setCelular(formatarCelular(celular) || celular)}
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold">E-mail</span>
            <input type="email" inputMode="email" autoComplete="email" placeholder="seunome@exemplo.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30" />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={salvar.isPending} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
            </button>
            <button type="button" onClick={() => setEditando(false)} className="h-10 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted">Cancelar</button>
          </div>
        </form>
      )}
    </Secao>
  );
}

function Escolha({ rotulo, valor, onChange, opcoes }: { rotulo: string; valor: string; onChange: (v: string) => void; opcoes: string[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold">{rotulo}</span>
      <select value={valor} onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30">
        <option value="">Não informar</option>
        {opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function Seguranca({ senhaPropria }: { senhaPropria: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const alterar = useAlterarSenhaColaborador();

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nova !== confirma) { toast.error("A confirmação não confere com a nova senha."); return; }
    try {
      const r = await alterar.mutateAsync({ atual, nova });
      if (!r.ok) { toast.error(r.error ?? "Não foi possível trocar a senha."); return; }
      toast.success("Senha alterada. A partir de agora, use a nova senha para entrar.");
      setAberto(false); setAtual(""); setNova(""); setConfirma("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível trocar a senha.");
    }
  };

  return (
    <Secao
      titulo="Segurança"
      descricao={senhaPropria ? "Você já usa uma senha própria." : "Sua senha ainda é o seu CPF. Recomendamos trocar."}
      acao={!aberto ? <button onClick={() => setAberto(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"><KeyRound className="h-3.5 w-3.5" /> Trocar senha</button> : undefined}
    >
      {senhaPropria && !aberto && (
        <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Senha personalizada ativa</p>
      )}
      {aberto && (
        <form onSubmit={salvar} className="space-y-3">
          <Campo rotulo={senhaPropria ? "Senha atual" : "Senha atual (seu CPF)"} valor={atual} onChange={setAtual} autoComplete="current-password" />
          <Campo rotulo="Nova senha (mínimo 6 caracteres)" valor={nova} onChange={setNova} autoComplete="new-password" minLength={6} />
          <Campo rotulo="Confirme a nova senha" valor={confirma} onChange={setConfirma} autoComplete="new-password" minLength={6} />
          <div className="flex gap-2">
            <button type="submit" disabled={alterar.isPending} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {alterar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar nova senha
            </button>
            <button type="button" onClick={() => setAberto(false)} className="h-10 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted">Cancelar</button>
          </div>
        </form>
      )}
    </Secao>
  );
}

function Campo({ rotulo, valor, onChange, autoComplete, minLength }: { rotulo: string; valor: string; onChange: (v: string) => void; autoComplete: string; minLength?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold">{rotulo}</span>
      <input
        type="password"
        required
        minLength={minLength}
        autoComplete={autoComplete}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
      />
    </label>
  );
}
