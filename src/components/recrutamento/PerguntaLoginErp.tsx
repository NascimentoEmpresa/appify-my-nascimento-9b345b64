// =====================================================================
// SIS-2026-0598 (mig 20261006000009) — na solicitação de vaga:
// "É encarregado?" → se Sim, "Precisa de login para a ERP?". Com as duas
// em Sim, quando o contratado é enviado à Admissão o pedido de login cai em
// Sistemas › Logins, já com e-mail e senha, e volta pronto para quem pediu
// a vaga em Minhas Solicitações. Usado nas DUAS telas de vaga
// (ModalNovaVaga e o formulário de Minhas Solicitações).
// =====================================================================

export interface RespostaLoginErp { vaga_encarregado: string; precisa_login_erp: string }

/** "Sim"/"Não" da tela → colunas do banco (login só existe para encarregado). */
export function loginErpParaBanco(v: RespostaLoginErp) {
  const enc = v.vaga_encarregado === "Sim";
  return { vaga_encarregado: enc, precisa_login_erp: enc && v.precisa_login_erp === "Sim" };
}

/** Colunas do banco → "Sim"/"Não" da tela (ao editar uma vaga gravada). */
export function loginErpDoBanco(d: Record<string, unknown>): RespostaLoginErp {
  return { vaga_encarregado: d.vaga_encarregado ? "Sim" : "Não", precisa_login_erp: d.precisa_login_erp ? "Sim" : "Não" };
}

export function PerguntaLoginErp({ valor, onChange, classeGrupo, classeCampo }: {
  valor: RespostaLoginErp;
  onChange: (v: RespostaLoginErp) => void;
  classeGrupo: string;
  classeCampo: string;
}) {
  const enc = valor.vaga_encarregado === "Sim";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, gridColumn: "1 / -1" }}>
      <div className={classeGrupo}>
        <label>É encarregado?</label>
        <select className={classeCampo} value={valor.vaga_encarregado}
          onChange={(e) => onChange({ vaga_encarregado: e.target.value, precisa_login_erp: e.target.value === "Sim" ? valor.precisa_login_erp : "Não" })}>
          <option>Não</option><option>Sim</option>
        </select>
      </div>
      {enc && (
        <div className={classeGrupo}>
          <label>Precisa de login para a ERP?</label>
          <select className={classeCampo} value={valor.precisa_login_erp}
            onChange={(e) => onChange({ ...valor, precisa_login_erp: e.target.value })}>
            <option>Não</option><option>Sim</option>
          </select>
        </div>
      )}
      {enc && valor.precisa_login_erp === "Sim" && (
        <p style={{ gridColumn: "1 / -1", fontSize: 12, color: "#0f766e", margin: "-4px 0 0" }}>
          Quando o contratado for admitido, o setor de Sistemas recebe o pedido e o login pronto aparece para você em Minhas Solicitações.
        </p>
      )}
    </div>
  );
}
