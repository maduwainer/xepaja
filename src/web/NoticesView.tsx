import { useEffect, useState } from "react";
import type { NoticeDTO } from "../shared/types";
import { ApiError, NoticesApi, PushApi } from "./api";

type PushState = "unsupported" | "off" | "on" | "denied" | "busy";

function base64ToBytes(base64: string): Uint8Array {
  const padded = base64.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function NoticesView() {
  const [notices, setNotices] = useState<NoticeDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>("off");
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  useEffect(() => {
    NoticesApi.list()
      .then((res) => setNotices(res.notices))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Falha ao carregar avisos."),
      );
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPush("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setPush("denied");
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setPush(sub ? "on" : "off"))
      .catch(() => setPush("off"));
  }, []);

  async function enablePush() {
    setPushMsg(null);
    setPush("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPush(permission === "denied" ? "denied" : "off");
        setPushMsg("Sem permissao, os avisos seguem listados aqui.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await PushApi.vapidKey();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToBytes(publicKey).buffer as ArrayBuffer,
      });
      const json = sub.toJSON();
      await PushApi.subscribe({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
      });
      setPush("on");
      setPushMsg("Notificacoes ativadas neste aparelho.");
    } catch {
      setPush("off");
      setPushMsg("Nao deu para ativar aqui; os avisos seguem listados abaixo.");
    }
  }

  async function disablePush() {
    setPushMsg(null);
    setPush("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await PushApi.unsubscribe(sub.endpoint).catch(() => undefined);
        await sub.unsubscribe();
      }
      setPush("off");
    } catch {
      setPush("on");
      setPushMsg("Nao deu para desativar agora.");
    }
  }

  async function markRead(id: number) {
    try {
      await NoticesApi.markRead(id);
      setNotices(notices.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao marcar como lido.");
    }
  }

  return (
    <section aria-labelledby="avisos-titulo" className="card">
      <h1 id="avisos-titulo">Avisos</h1>
      <div className="note" aria-live="polite">
        <p>
          Todo evento importante gera um aviso aqui dentro do app. A notificacao
          no aparelho e um complemento: se falhar, nada se perde.
        </p>
        {push === "unsupported" && (
          <p className="muted">Este navegador nao suporta notificacoes; a lista abaixo cobre tudo.</p>
        )}
        {push === "denied" && (
          <p className="muted">Notificacoes bloqueadas no navegador; a lista abaixo cobre tudo.</p>
        )}
        {(push === "off" || push === "busy") && (
          <button type="button" className="btn small" disabled={push === "busy"} onClick={enablePush}>
            {push === "busy" ? "Ativando..." : "Ativar notificacoes neste aparelho"}
          </button>
        )}
        {push === "on" && (
          <button type="button" className="btn small" onClick={disablePush}>
            Desativar notificacoes
          </button>
        )}
        {pushMsg && <p>{pushMsg}</p>}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notices.length === 0 && <p className="muted">Nenhum aviso.</p>}
      <ul className="list">
        {notices.map((n) => (
          <li key={n.id} className={n.read_at ? "list-row is-read" : "list-row"}>
            <span>
              {n.read_at ? "" : "Novo: "}{n.body}
            </span>
            {!n.read_at && (
              <button type="button" className="btn small" onClick={() => markRead(n.id)}>
                Marcar lido
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
