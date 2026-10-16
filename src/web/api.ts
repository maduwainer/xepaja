import type { EstablishmentDTO, IncomingReservation, ItemDTO, NoticeDTO, OfferDTO, ReservationDTO, Role, UserDTO } from "../shared/types";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      (data as { message?: string })?.message ?? "Falha na requisicao. Tente de novo.",
      res.status,
      (data as { code?: string })?.code ?? "unknown",
    );
  }
  return data as T;
}

export interface SignupInput {
  name: string;
  cpf: string;
  email: string;
  password: string;
  role: Role;
  search_radius_km?: number;
}

export const AuthApi = {
  me(): Promise<{ ok: true; user: UserDTO }> {
    return request("/api/auth/me");
  },
  signup(input: SignupInput): Promise<{ ok: true; user: UserDTO }> {
    return request("/api/auth/signup", { method: "POST", body: input });
  },
  login(email: string, password: string): Promise<{ ok: true; user: UserDTO }> {
    return request("/api/auth/login", { method: "POST", body: { email, password } });
  },
  logout(): Promise<{ ok: true }> {
    return request("/api/auth/logout", { method: "POST" });
  },
  updateMe(body: { name?: string; search_radius_km?: number }): Promise<{ ok: true; user: UserDTO }> {
    return request("/api/users/me", { method: "PATCH", body });
  },
};

export interface EstablishmentMine {
  ok: true;
  establishment: EstablishmentDTO | null;
  can_publish: boolean;
  publish_block_reason: string | null;
}

export const EstablishmentApi = {
  mine(): Promise<EstablishmentMine> {
    return request("/api/establishments/mine");
  },
  create(body: Record<string, unknown>): Promise<EstablishmentMine> {
    return request("/api/establishments", { method: "POST", body });
  },
  update(body: Record<string, unknown>): Promise<EstablishmentMine> {
    return request("/api/establishments/mine", { method: "PATCH", body });
  },
};

export const ItemsApi = {
  list(): Promise<{ ok: true; items: ItemDTO[] }> {
    return request("/api/items");
  },
  create(body: { name: string; unit: string }): Promise<{ ok: true; item: ItemDTO }> {
    return request("/api/items", { method: "POST", body });
  },
  update(id: number, body: { name?: string; unit?: string }): Promise<{ ok: true; item: ItemDTO }> {
    return request(`/api/items/${id}`, { method: "PATCH", body });
  },
  remove(id: number): Promise<{ ok: true }> {
    return request(`/api/items/${id}`, { method: "DELETE" });
  },
};

export const ReservationsApi = {
  create(offerId: number): Promise<{ ok: true; reservation: ReservationDTO; repeated?: boolean }> {
    const idempotency_key = crypto.randomUUID();
    return request("/api/reservations", { method: "POST", body: { offer_id: offerId, idempotency_key } });
  },
  active(): Promise<{ ok: true; reservation: ReservationDTO | null; misses_since_unblock: number; blocked_until: string | null }> {
    return request("/api/reservations/active");
  },
  history(): Promise<{ ok: true; reservations: ReservationDTO[] }> {
    return request("/api/reservations/history");
  },
  cancel(id: number): Promise<{ ok: true }> {
    return request(`/api/reservations/${id}/cancel`, { method: "POST" });
  },
  incoming(): Promise<{ ok: true; reservations: IncomingReservation[] }> {
    return request("/api/reservations/incoming");
  },
  accept(id: number): Promise<{ ok: true; reservation: ReservationDTO; pickup_code: string }> {
    return request(`/api/reservations/${id}/accept`, { method: "POST" });
  },
  refuse(id: number, reason: string): Promise<{ ok: true }> {
    return request(`/api/reservations/${id}/refuse`, { method: "POST", body: { reason } });
  },
  merchantCancel(id: number, reason: string): Promise<{ ok: true }> {
    return request(`/api/reservations/${id}/merchant-cancel`, { method: "POST", body: { reason } });
  },
};

export const NoticesApi = {
  list(): Promise<{ ok: true; notices: NoticeDTO[]; unread: number }> {
    return request("/api/notices");
  },
  markRead(id: number): Promise<{ ok: true }> {
    return request(`/api/notices/${id}/read`, { method: "POST" });
  },
};

export const PickupApi = {
  confirm(code: string): Promise<{
    ok: true;
    pickup: {
      reservation_id: number;
      offer_title: string;
      consumer_name: string;
      price_cents: number;
      confirmed_at: string;
    };
  }> {
    return request("/api/reservations/pickup/confirm", { method: "POST", body: { code } });
  },
};

export const PushApi = {
  vapidKey(): Promise<{ ok: true; publicKey: string }> {
    return request("/api/push/vapid-key");
  },
  subscribe(sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<{ ok: true }> {
    return request("/api/push/subscribe", { method: "POST", body: sub });
  },
  unsubscribe(endpoint: string): Promise<{ ok: true }> {
    return request("/api/push/unsubscribe", { method: "POST", body: { endpoint } });
  },
};

export const PasswordApi = {
  forgot(email: string): Promise<{ ok: true; message: string }> {
    return request("/api/auth/password/forgot", { method: "POST", body: { email } });
  },
  reset(token: string, newPassword: string): Promise<{ ok: true }> {
    return request("/api/auth/password/reset", {
      method: "POST",
      body: { token, new_password: newPassword },
    });
  },
};

export const SearchApi = {
  nearby(lat: number, lng: number, radiusKm?: number): Promise<{ ok: true; offers: OfferDTO[] }> {
    const q = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    if (radiusKm !== undefined) q.set("radius_km", String(radiusKm));
    return request(`/api/offers/nearby?${q.toString()}`);
  },
  detail(id: number): Promise<{ ok: true; offer: OfferDTO }> {
    return request(`/api/offers/${id}`);
  },
};

export const OffersApi = {
  mine(): Promise<{ ok: true; offers: OfferDTO[] }> {
    return request("/api/offers/mine");
  },
  create(body: Record<string, unknown>): Promise<{ ok: true; offer: OfferDTO }> {
    return request("/api/offers", { method: "POST", body });
  },
  publish(id: number): Promise<{ ok: true; offer: OfferDTO }> {
    return request(`/api/offers/${id}/publish`, { method: "POST" });
  },
  update(id: number, body: Record<string, unknown>): Promise<{ ok: true; offer: OfferDTO }> {
    return request(`/api/offers/${id}`, { method: "PATCH", body });
  },
  encerrar(id: number): Promise<{ ok: true; offer: OfferDTO }> {
    return request(`/api/offers/${id}/encerrar`, { method: "POST" });
  },
  cancel(id: number, reason: string): Promise<{ ok: true; offer: OfferDTO; cancelled_reservations: number }> {
    return request(`/api/offers/${id}/cancel`, { method: "POST", body: { reason } });
  },
  async uploadPhoto(id: number, file: File): Promise<{ ok: true; offer: OfferDTO }> {
    const form = new FormData();
    form.set("photo", file);
    const res = await fetch(`/api/offers/${id}/photo`, { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(
        (data as { message?: string })?.message ?? "Falha no envio da foto.",
        res.status,
        (data as { code?: string })?.code ?? "unknown",
      );
    }
    return data as { ok: true; offer: OfferDTO };
  },
};
