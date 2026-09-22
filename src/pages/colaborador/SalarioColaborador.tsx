import { useState } from "react";
import { Eye, EyeOff, Info } from "lucide-react";
import { fmtData, fmtMoeda, useSalarioColaborador } from "@/hooks/useColaboradorPortal";
import { Carregando, Dado, Erro, GradeDados, Secao } from "./ui";

// =====================================================================
// PORTAL DO COLABORADOR — Salário
// O salário CADASTRADO em EMPREGADOS (o que o RH mantém sincronizado com o
// Senior), mais os campos ao redor e os dados bancários já mascarados pela
// RPC. Não é holerite: a folha é fechada no Senior e não existe no ERP.
// O valor nasce escondido — é a tela mais provável de ser aberta em público.
// =====================================================================

export default function SalarioColaborador() {
  const q = useSalarioColaborador();
  const [mostrar, setMostrar] = useState(false);
  if (q.isLoading) return <Carregando />;
  if (q.isError || !q.data) return <Erro erro={q.error} acao={<button className="text-sm font-semibold underline" onClick={() => q.refetch()}>Tentar de novo</button>} />;
  const s = q.data;
  const oculto = "R$ ••••••";
  const total = (s.valor ?? 0) + (s.complemento ?? 0) + (s.suplementar ?? 0);
  const temAdicional = (s.complemento ?? 0) > 0 || (s.suplementar ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-hero p-5 text-white shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-white/60">Salário atual{s.tipo ? ` · ${s.tipo}` : ""}</p>
            <p className="mt-1 font-display text-3xl font-bold tabular-nums">
              {mostrar ? (s.valor != null ? fmtMoeda(s.valor) : s.valor_texto || "—") : oculto}
            </p>
            {s.data_salario && <p className="mt-1 text-xs text-white/70">Vigente desde {fmtData(s.data_salario)}{s.motivo_alteracao ? ` · ${s.motivo_alteracao}` : ""}</p>}
          </div>
          <button
            type="button"
            onClick={() => setMostrar((v) => !v)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20"
            aria-label={mostrar ? "Ocultar valores" : "Mostrar valores"}
          >
            {mostrar ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        {temAdicional && (
          <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
            <Parcela rotulo="Base" valor={mostrar ? fmtMoeda(s.valor) : oculto} />
            <Parcela rotulo="Adicionais" valor={mostrar ? fmtMoeda((s.complemento ?? 0) + (s.suplementar ?? 0)) : oculto} />
            <Parcela rotulo="Total" valor={mostrar ? fmtMoeda(total) : oculto} />
          </div>
        )}
      </div>

      <Secao titulo="Condições">
        <GradeDados>
          <Dado rotulo="Cargo" valor={s.cargo} sempre />
          <Dado rotulo="No cargo desde" valor={fmtData(s.data_cargo)} />
          <Dado rotulo="Período de pagamento" valor={s.periodo_pagto} />
          <Dado rotulo="Adiantamento" valor={s.adiantamento} />
          <Dado rotulo="Recebe 13º" valor={s.recebe_13} />
          <Dado rotulo="Dependentes (IR)" valor={s.dependentes_ir != null ? String(s.dependentes_ir) : null} />
          <Dado rotulo="Insalubridade" valor={s.insalubridade_pct != null && s.insalubridade_pct > 0 ? `${s.insalubridade_pct}%` : null} />
          <Dado rotulo="Periculosidade" valor={s.periculosidade_pct != null && s.periculosidade_pct > 0 ? `${s.periculosidade_pct}%` : null} />
          <Dado rotulo="Desconta INSS" valor={s.desconta_inss} />
          <Dado rotulo="Complemento" valor={s.complemento ? (mostrar ? fmtMoeda(s.complemento) : oculto) : null} />
          <Dado rotulo="Suplementar" valor={s.suplementar ? (mostrar ? fmtMoeda(s.suplementar) : oculto) : null} />
        </GradeDados>
      </Secao>

      <Secao titulo="Onde você recebe" descricao="Conta e chave PIX aparecem parcialmente, por segurança.">
        <GradeDados>
          <Dado rotulo="Forma" valor={s.modo_pagto} />
          <Dado rotulo="Banco" valor={s.banco} sempre />
          <Dado rotulo="Agência" valor={s.agencia} mono />
          <Dado rotulo="Conta" valor={s.conta} mono />
          <Dado rotulo="Tipo de conta" valor={s.tipo_conta} />
          <Dado rotulo={s.pix_tipo ? `PIX (${s.pix_tipo})` : "PIX"} valor={s.pix} mono />
        </GradeDados>
      </Secao>

      <div className="flex gap-2 rounded-xl bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Este é o salário-base cadastrado pelo RH, não o holerite. Descontos, horas extras e adicionais do mês
          aparecem no contracheque emitido pela folha. Dúvidas sobre valores: fale com o RH.
        </p>
      </div>
    </div>
  );
}

function Parcela({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg bg-white/10 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wider text-white/60">{rotulo}</p>
      <p className="mt-0.5 truncate text-sm font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
