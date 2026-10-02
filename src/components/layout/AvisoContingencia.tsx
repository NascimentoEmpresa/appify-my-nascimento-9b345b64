import { AlertTriangle, RotateCcw } from "lucide-react";
import {
  emContingencia,
  sairDaContingencia,
} from "@/integrations/supabase/contingencia";

/**
 * Faixa fixa no topo enquanto o ERP está falando com a RÉPLICA, e não com a
 * Supabase.
 *
 * POR QUE ELA É IMPRESCINDÍVEL, E NÃO ENFEITE
 * Em contingência o usuário vê dados de algumas horas atrás e não consegue
 * salvar nada. Sem aviso, isso vira a pior experiência possível: ele conclui
 * que o ERP "perdeu" o pedido que acabou de ser aprovado, ou tenta lançar uma
 * hora extra e recebe um erro que não explica nada. Uma faixa que não sai da
 * tela é o que transforma "o sistema está com defeito" em "o sistema está em
 * contingência, e eu sei o que isso significa".
 *
 * Fica FORA das rotas e dos providers, igual ao MonitorDeQueda: tem que
 * aparecer mesmo que perfil e permissões não tenham carregado.
 */
export function AvisoContingencia() {
  if (!emContingencia()) return null;
  return (
    <>
      <style>{`
        .ct-faixa{position:fixed;top:0;left:0;right:0;z-index:9999;display:flex;
          align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;
          padding:9px 16px;background:#7c2d12;color:#fff;
          font:700 13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;
          box-shadow:0 2px 10px rgba(0,0,0,.28)}
        .ct-faixa b{font-weight:900}
        .ct-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;
          border:1.5px solid rgba(255,255,255,.55);border-radius:7px;
          background:rgba(255,255,255,.12);color:#fff;cursor:pointer;
          font:800 12.5px system-ui,-apple-system,Segoe UI,sans-serif}
        .ct-btn:hover{background:rgba(255,255,255,.22)}
        /* O app inteiro desce, senão a faixa cobre o topo e o menu. */
        body{padding-top:38px!important}
        @media (max-width:640px){
          .ct-faixa{font-size:12px;padding:7px 12px}
          body{padding-top:56px!important}
        }
      `}</style>
      <div className="ct-faixa" role="status" aria-live="polite">
        <AlertTriangle size={16} strokeWidth={2.6} aria-hidden />
        <span>
          <b>Modo consulta.</b> O sistema principal está indisponível. Você está
          vendo uma cópia dos dados e <b>não é possível salvar alterações</b>.
        </span>
        <button type="button" className="ct-btn" onClick={() => sairDaContingencia()}>
          <RotateCcw size={14} strokeWidth={2.6} aria-hidden />
          Tentar o sistema principal
        </button>
      </div>
    </>
  );
}
