import type { ReactNode } from "react";
import { BadgeCheck, Building2, CircleAlert, IdCard, MessageCircle, User as UserIcon } from "lucide-react";

/**
 * Ficha de perfil de uma pessoa do ERP.
 *
 * Existe uma só, usada em dois lugares: Meu Perfil (a própria pessoa) e
 * Administração › Usuários › Detalhes (qualquer um). Duas telas mostrando a
 * mesma pessoa de jeitos diferentes seria trabalho dobrado para divergir na
 * primeira mudança.
 *
 * Três fontes, e a distinção importa para quem lê:
 *   Conta    — o que o ERP sabe do login.
 *   Cadastro — o que veio da Senior. É a fonte oficial; ninguém edita aqui.
 *   Discord  — canal de notificação, não identidade (ver a Edge Function).
 *
 * Bloco sem dado não vira caixa vazia: some. Uma ficha com três campos
 * preenchidos e sete tracinhos passa a impressão errada de cadastro incompleto
 * quando o que houve foi campo que a Senior não usa.
 */

export interface PerfilConta {
  nome: string | null;
  email: string | null;
  avatarUrl: string | null;
  cargo?: string | null;
  telefone?: string | null;
  bio?: string | null;
}

export interface PerfilEmpregado {
  nome?: string | null;
  cpf?: string | null;
  cargo?: string | null;
  setor?: string | null;
  perfil?: string | null;
  lider?: string | null;
  situacao?: string | null;
  admissao?: string | null;
  nascimento?: string | null;
  empresa?: string | null;
  filial?: string | null;
  email?: string | null;
}

export interface PerfilDiscord {
  discord_username: string | null;
  discord_email: string | null;
  discord_avatar: string | null;
  discord_id: string;
  verificado: boolean;
}

const ehDesligado = (s?: string | null) => /DEMITID|RESCIS|DESLIGAD/i.test(s ?? "");

function iniciais(nome: string | null, email: string | null): string {
  const base = (nome ?? email ?? "?").trim();
  const partes = base.split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function Campo({ label, valor, alerta }: { label: string; valor?: string | null; alerta?: boolean }) {
  if (valor == null || String(valor).trim() === "") return null;
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`truncate text-sm font-medium ${alerta ? "text-destructive" : "text-foreground"}`} title={String(valor)}>
        {String(valor)}
      </p>
    </div>
  );
}

/** Some inteira quando nenhum filho renderizou — ver o comentário do topo. */
function Secao({ titulo, icone, children }: { titulo: string; icone: ReactNode; children: ReactNode }) {
  const temAlgo = Array.isArray(children)
    ? children.some((c) => c !== null && c !== undefined && c !== false)
    : !!children;
  if (!temAlgo) return null;
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icone}
        {titulo}
      </h3>
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function CartaoPerfil({
  conta,
  empregado,
  discord,
  acoes,
}: {
  conta: PerfilConta;
  empregado?: PerfilEmpregado | null;
  discord?: PerfilDiscord | null;
  /** Botões do dono da tela (editar descrição, desvincular, usar foto...). */
  acoes?: ReactNode;
}) {
  const desligado = ehDesligado(empregado?.situacao);
  // O cargo da Senior manda: é o oficial. O de `profiles` é digitado à mão.
  const subtitulo = empregado?.cargo || conta.cargo || null;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Faixa de identificação. O gradiente é discreto de propósito — o que
          precisa saltar é a foto e o nome, não a decoração. */}
      <div className="flex items-start gap-4 border-b border-border bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent p-5">
        {conta.avatarUrl ? (
          <img
            src={conta.avatarUrl}
            alt=""
            className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-background"
          />
        ) : (
          <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-semibold text-primary ring-2 ring-background">
            {iniciais(conta.nome, conta.email)}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-foreground">{conta.nome ?? "—"}</h2>
          {subtitulo && <p className="truncate text-sm text-muted-foreground">{subtitulo}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {empregado?.setor && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {empregado.setor}
              </span>
            )}
            {empregado?.situacao && (
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                  desligado
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {empregado.situacao}
              </span>
            )}
            {discord && (
              <span
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
                  discord.verificado
                    ? "border-[#5865F2]/40 bg-[#5865F2]/10 text-[#5865F2]"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                }`}
              >
                {discord.verificado
                  ? <BadgeCheck className="h-3 w-3" />
                  : <CircleAlert className="h-3 w-3" />}
                Discord
              </span>
            )}
          </div>

          {acoes && <div className="mt-3 flex flex-wrap gap-2">{acoes}</div>}
        </div>
      </div>

      <div className="space-y-5 p-5">
        {conta.bio && (
          <p className="whitespace-pre-wrap border-l-2 border-primary/30 pl-3 text-sm italic text-muted-foreground">
            {conta.bio}
          </p>
        )}

        <Secao titulo="Conta" icone={<UserIcon className="h-3.5 w-3.5" />}>
          <Campo label="E-mail" valor={conta.email} />
          <Campo label="Telefone" valor={conta.telefone} />
        </Secao>

        <Secao titulo="Cadastro (Senior)" icone={<IdCard className="h-3.5 w-3.5" />}>
          <Campo label="Nome" valor={empregado?.nome} />
          <Campo label="CPF" valor={empregado?.cpf} />
          <Campo label="Cargo" valor={empregado?.cargo} />
          <Campo label="Setor" valor={empregado?.setor} />
          <Campo label="Perfil" valor={empregado?.perfil} />
          <Campo label="Líder" valor={empregado?.lider} />
          <Campo label="Situação" valor={empregado?.situacao} alerta={desligado} />
          <Campo label="Admissão" valor={empregado?.admissao} />
          <Campo label="Nascimento" valor={empregado?.nascimento} />
          <Campo label="E-mail (Senior)" valor={empregado?.email} />
        </Secao>

        <Secao titulo="Empresa" icone={<Building2 className="h-3.5 w-3.5" />}>
          <Campo label="Empresa" valor={empregado?.empresa} />
          <Campo label="Filial" valor={empregado?.filial} />
        </Secao>

        {discord && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MessageCircle className="h-3.5 w-3.5" />
              Discord
            </h3>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
              {discord.discord_avatar
                ? <img src={discord.discord_avatar} alt="" className="h-9 w-9 rounded-full" />
                : <span className="h-9 w-9 rounded-full bg-[#5865F2]/10" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {discord.discord_username ?? "Conta vinculada"}
                </p>
                {discord.discord_email && (
                  <p className="truncate text-xs text-muted-foreground">{discord.discord_email}</p>
                )}
                <p className="font-mono text-[11px] text-muted-foreground">{discord.discord_id}</p>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
