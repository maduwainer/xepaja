import { useEffect, useState } from "react";
import type { ItemDTO } from "../shared/types";
import { ApiError, ItemsApi } from "./api";

export function ItemsView() {
  const [items, setItems] = useState<ItemDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ItemDTO | null>(null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    ItemsApi.list()
      .then((res) => setItems(res.items))
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Falha ao carregar itens.",
        ),
      );
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const form = new FormData(e.currentTarget);
      const body = {
        name: String(form.get("name") ?? ""),
        unit: String(form.get("unit") ?? ""),
      };
      if (editing) {
        const res = await ItemsApi.update(editing.id, body);
        setItems(items.map((it) => (it.id === editing.id ? res.item : it)));
        setNotice("Item atualizado.");
      } else {
        const res = await ItemsApi.create(body);
        setItems([...items, res.item].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
        setNotice("Item cadastrado.");
      }
      setEditing(null);
      setFormKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha na requisicao. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(item: ItemDTO) {
    setError(null);
    setNotice(null);
    try {
      await ItemsApi.remove(item.id);
      setItems(items.filter((it) => it.id !== item.id));
      if (editing?.id === item.id) {
        setEditing(null);
        setFormKey((k) => k + 1);
      }
      setNotice("Item removido.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha na requisicao. Tente de novo.");
    }
  }

  return (
    <section aria-labelledby="itens-titulo" className="card">
      <h1 id="itens-titulo">Itens do estabelecimento</h1>
      <p className="muted">Nome e unidade de cada item. Eles compoem ofertas e caixas surpresa.</p>
      {error && error !== "Cadastre o estabelecimento antes dos itens." && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {error === "Cadastre o estabelecimento antes dos itens." && (
        <p className="note" aria-live="polite">
          Cadastre o estabelecimento antes dos itens.
        </p>
      )}
      {items.length > 0 && (
        <ul className="list">
          {items.map((item) => (
            <li key={item.id} className="list-row">
              <span>
                {item.name} <span className="muted">({item.unit})</span>
              </span>
              <span className="row">
                <button type="button" className="btn small" onClick={() => { setEditing(item); setFormKey((k) => k + 1); }}>
                  Editar
                </button>
                <button type="button" className="btn small danger" onClick={() => handleRemove(item)}>
                  Remover
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form key={formKey} onSubmit={handleSubmit} className="stack">
        <h2 className="sub">{editing ? "Editar item" : "Novo item"}</h2>
        <div className="field">
          <label htmlFor="item-nome">Nome</label>
          <input id="item-nome" name="name" required defaultValue={editing?.name ?? ""} maxLength={80} placeholder="ex. banana" />
        </div>
        <div className="field">
          <label htmlFor="item-unidade">Unidade</label>
          <input id="item-unidade" name="unit" required defaultValue={editing?.unit ?? ""} maxLength={20} placeholder="ex. kg, un, maca" />
        </div>
        <div className="row">
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Salvando..." : editing ? "Salvar" : "Adicionar"}
          </button>
          {editing && (
            <button
              type="button"
              className="btn"
              onClick={() => { setEditing(null); setFormKey((k) => k + 1); }}
            >
              Cancelar edicao
            </button>
          )}
        </div>
      </form>
      {notice && (
        <p className="note" aria-live="polite">
          {notice}
        </p>
      )}
    </section>
  );
}
