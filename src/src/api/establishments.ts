import { Hono } from "hono";
import { getDb } from "./db";
import { requireMerchant, validateCnpj, type AppEnv } from "./auth";

export const establishmentsApp = new Hono<AppEnv>();

interface EstablishmentRow {
  id: number;
  owner_id: number;
  name: string;
  kind: string;
  cnpj: string | null;
  address_text: string;
  reference: string;
  hours: string;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_captured_at: string | null;
}

const ESTAB_COLUMNS =
  "id, owner_id, name, kind, cnpj, address_text, reference, hours, gps_lat, gps_lng, gps_captured_at";

function getMine(ownerId: number): EstablishmentRow | null {
  return (
    (getDb()
      .query(`SELECT ${ESTAB_COLUMNS} FROM establishments WHERE owner_id = ?`)
      .get(ownerId) as EstablishmentRow | null) ?? null
  );
}

// GPS registrado libera publicar ofertas (Fase 2 exige). Sem GPS, informa o motivo.
export function publishStatus(estab: EstablishmentRow | null): {
  can_publish: boolean;
  publish_block_reason: string | null;
} {
  if (!estab) {
    return {
      can_publish: false,
      publish_block_reason: "Cadastre o estabelecimento antes de publicar ofertas.",
    };
  }
  if (estab.gps_lat === null || estab.gps_lng === null) {
    return {
      can_publish: false,
      publish_block_reason:
        "Registre a posicao GPS no local de retirada antes de publicar ofertas.",
    };
  }
  return { can_publish: true, publish_block_reason: null };
}

function parseGps(body: Record<string, unknown>): {
  lat: number | null;
  lng: number | null;
  error: string | null;
} {
  const rawLat = body.gps_lat;
  const rawLng = body.gps_lng;
  if (rawLat === undefined && rawLng === undefined) return { lat: null, lng: null, error: null };
  const lat = typeof rawLat === "string" ? Number(rawLat) : rawLat;
  const lng = typeof rawLng === "string" ? Number(rawLng) : rawLng;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return { lat: null, lng: null, error: "Informe latitude entre -90 e 90 e longitude entre -180 e 180." };
  }
  return { lat, lng, error: null };
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// RF-04: estabelecimento com nome, tipo, CNPJ se tiver, endereco de retirada,
// referencia e horario. GPS capturado no local; ao trocar o endereco, exige
// recapturar o GPS na mesma requisicao. Vale para ofertas futuras (Fase 2 usa snapshot).
establishmentsApp.get("/establishments/mine", requireMerchant, (c) => {
  const estab = getMine(c.get("user").id);
  return c.json({ ok: true, establishment: estab, ...publishStatus(estab) });
});

establishmentsApp.post("/establishments", requireMerchant, async (c) => {
  const user = c.get("user");
  if (getMine(user.id)) {
    return c.json(
      { ok: false, code: "already_exists", message: "Voce ja tem um estabelecimento. Edite o atual." },
      409,
    );
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return c.json({ ok: false, code: "invalid_body", message: "Informe os dados do estabelecimento." }, 400);
  }
  const name = str(body.name);
  const kind = body.kind === "mercearia" ? "mercearia" : body.kind === "feira" ? "feira" : "";
  const cnpj = validateCnpj(body.cnpj);
  const address = str(body.address_text);
  if (!name) {
    return c.json({ ok: false, code: "invalid_name", message: "Informe o nome do estabelecimento." }, 400);
  }
  if (!kind) {
    return c.json(
      { ok: false, code: "invalid_kind", message: "Tipo precisa ser feira ou mercearia." },
      400,
    );
  }
  if (cnpj === null) {
    return c.json({ ok: false, code: "invalid_cnpj", message: "Informe um CNPJ valido ou deixe em branco." }, 400);
  }
  if (!address) {
    return c.json(
      { ok: false, code: "invalid_address", message: "Informe o endereco de retirada." },
      400,
    );
  }
  const gps = parseGps(body);
  if (gps.error) {
    return c.json({ ok: false, code: "invalid_gps", message: gps.error }, 400);
  }

  const estab = getDb()
    .query(
      `INSERT INTO establishments
       (owner_id, name, kind, cnpj, address_text, reference, hours, gps_lat, gps_lng, gps_captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING ${ESTAB_COLUMNS}`,
    )
    .get(
      user.id,
      name,
      kind,
      cnpj || null,
      address,
      str(body.reference),
      str(body.hours),
      gps.lat,
      gps.lng,
      gps.lat !== null ? new Date().toISOString() : null,
    ) as EstablishmentRow;
  return c.json({ ok: true, establishment: estab, ...publishStatus(estab) }, 201);
});

establishmentsApp.patch("/establishments/mine", requireMerchant, async (c) => {
  const user = c.get("user");
  const current = getMine(user.id);
  if (!current) {
    return c.json(
      { ok: false, code: "not_found", message: "Cadastre o estabelecimento antes de editar." },
      404,
    );
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return c.json({ ok: false, code: "invalid_body", message: "Nada para atualizar." }, 400);
  }

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (body.name !== undefined) {
    const name = str(body.name);
    if (!name) {
      return c.json({ ok: false, code: "invalid_name", message: "Informe o nome do estabelecimento." }, 400);
    }
    updates.push("name = ?");
    params.push(name);
  }
  if (body.kind !== undefined) {
    const kind = body.kind === "mercearia" ? "mercearia" : body.kind === "feira" ? "feira" : "";
    if (!kind) {
      return c.json(
        { ok: false, code: "invalid_kind", message: "Tipo precisa ser feira ou mercearia." },
        400,
      );
    }
    updates.push("kind = ?");
    params.push(kind);
  }
  if (body.cnpj !== undefined) {
    const cnpj = validateCnpj(body.cnpj);
    if (cnpj === null) {
      return c.json({ ok: false, code: "invalid_cnpj", message: "Informe um CNPJ valido ou deixe em branco." }, 400);
    }
    updates.push("cnpj = ?");
    params.push(cnpj || null);
  }

  let addressChanged = false;
  if (body.address_text !== undefined) {
    const address = str(body.address_text);
    if (!address) {
      return c.json(
        { ok: false, code: "invalid_address", message: "Informe o endereco de retirada." },
        400,
      );
    }
    if (address !== current.address_text) addressChanged = true;
    updates.push("address_text = ?");
    params.push(address);
  }
  if (body.reference !== undefined) {
    updates.push("reference = ?");
    params.push(str(body.reference));
  }
  if (body.hours !== undefined) {
    updates.push("hours = ?");
    params.push(str(body.hours));
  }

  const gps = parseGps(body);
  if (gps.error) {
    return c.json({ ok: false, code: "invalid_gps", message: gps.error }, 400);
  }
  if (addressChanged && gps.lat === null) {
    return c.json(
      {
        ok: false,
        code: "gps_required",
        message: "Ao trocar o endereco, registre novamente a posicao GPS no local de retirada.",
      },
      422,
    );
  }
  if (gps.lat !== null && gps.lng !== null) {
    updates.push("gps_lat = ?", "gps_lng = ?", "gps_captured_at = ?");
    params.push(gps.lat, gps.lng, new Date().toISOString());
  }

  if (updates.length === 0) {
    return c.json({ ok: false, code: "invalid_body", message: "Nada para atualizar." }, 400);
  }

  params.push(user.id);
  const estab = getDb()
    .query(
      `UPDATE establishments SET ${updates.join(", ")},
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE owner_id = ? RETURNING ${ESTAB_COLUMNS}`,
    )
    .get(...params) as EstablishmentRow;
  return c.json({ ok: true, establishment: estab, ...publishStatus(estab) });
});

// Cadastro de itens do estabelecimento (nome e unidade). Compoem ofertas e
// caixas surpresa na Fase 2.
establishmentsApp.get("/items", requireMerchant, (c) => {
  const estab = getMine(c.get("user").id);
  if (!estab) {
    return c.json(
      { ok: false, code: "no_establishment", message: "Cadastre o estabelecimento antes dos itens." },
      404,
    );
  }
  const items = getDb()
    .query("SELECT id, establishment_id, name, unit FROM items WHERE establishment_id = ? ORDER BY name")
    .all(estab.id);
  return c.json({ ok: true, items });
});

establishmentsApp.post("/items", requireMerchant, async (c) => {
  const estab = getMine(c.get("user").id);
  if (!estab) {
    return c.json(
      { ok: false, code: "no_establishment", message: "Cadastre o estabelecimento antes dos itens." },
      404,
    );
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = body ? str(body.name) : "";
  const unit = body ? str(body.unit) : "";
  if (!name) {
    return c.json({ ok: false, code: "invalid_name", message: "Informe o nome do item." }, 400);
  }
  if (!unit) {
    return c.json({ ok: false, code: "invalid_unit", message: "Informe a unidade do item." }, 400);
  }
  const item = getDb()
    .query(
      `INSERT INTO items (establishment_id, name, unit) VALUES (?, ?, ?)
       RETURNING id, establishment_id, name, unit`,
    )
    .get(estab.id, name, unit);
  return c.json({ ok: true, item }, 201);
});

function getOwnItem(estabId: number, itemId: number) {
  return getDb()
    .query("SELECT id, establishment_id, name, unit FROM items WHERE id = ? AND establishment_id = ?")
    .get(itemId, estabId) as { id: number } | null;
}

establishmentsApp.patch("/items/:id", requireMerchant, async (c) => {
  const estab = getMine(c.get("user").id);
  if (!estab) {
    return c.json(
      { ok: false, code: "no_establishment", message: "Cadastre o estabelecimento antes dos itens." },
      404,
    );
  }
  const itemId = Number(c.req.param("id"));
  if (!Number.isInteger(itemId)) {
    return c.json({ ok: false, code: "not_found", message: "Item nao encontrado." }, 404);
  }
  if (!getOwnItem(estab.id, itemId)) {
    return c.json({ ok: false, code: "not_found", message: "Item nao encontrado." }, 404);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  if (body?.name !== undefined) {
    const name = str(body.name);
    if (!name) {
      return c.json({ ok: false, code: "invalid_name", message: "Informe o nome do item." }, 400);
    }
    updates.push("name = ?");
    params.push(name);
  }
  if (body?.unit !== undefined) {
    const unit = str(body.unit);
    if (!unit) {
      return c.json({ ok: false, code: "invalid_unit", message: "Informe a unidade do item." }, 400);
    }
    updates.push("unit = ?");
    params.push(unit);
  }
  if (updates.length === 0) {
    return c.json({ ok: false, code: "invalid_body", message: "Nada para atualizar." }, 400);
  }
  params.push(itemId);
  const item = getDb()
    .query(
      `UPDATE items SET ${updates.join(", ")} WHERE id = ?
       RETURNING id, establishment_id, name, unit`,
    )
    .get(...params);
  return c.json({ ok: true, item });
});

establishmentsApp.delete("/items/:id", requireMerchant, (c) => {
  const estab = getMine(c.get("user").id);
  if (!estab) {
    return c.json(
      { ok: false, code: "no_establishment", message: "Cadastre o estabelecimento antes dos itens." },
      404,
    );
  }
  const itemId = Number(c.req.param("id"));
  if (!Number.isInteger(itemId)) {
    return c.json({ ok: false, code: "not_found", message: "Item nao encontrado." }, 404);
  }
  if (!getOwnItem(estab.id, itemId)) {
    return c.json({ ok: false, code: "not_found", message: "Item nao encontrado." }, 404);
  }
  getDb().query("DELETE FROM items WHERE id = ?").run(itemId);
  return c.json({ ok: true });
});
