// Contratos compartilhados entre API (Hono) e app React.
// Manter aqui apenas tipos estaveis do dominio. Regras de transicao vivem no servidor.

export type Role = "consumer" | "merchant";
export type EstablishmentKind = "feira" | "mercearia";
export type OfferKind = "item" | "caixa";
export type OfferState =
  | "rascunho"
  | "publicada"
  | "esgotada"
  | "encerrada"
  | "cancelada"
  | "expirada";
export type ReservationState =
  | "pendente"
  | "confirmada"
  | "recusada"
  | "retirada"
  | "cancelada"
  | "expirada";

export interface HealthResponse {
  ok: boolean;
  service: "xepaja";
  time: string;
}

export interface ApiError {
  ok: false;
  code: string;
  message: string;
}

export interface UserDTO {
  id: number;
  name: string;
  email: string;
  role: Role;
  search_radius_km: number;
  misses_since_unblock: number;
  blocked_until: string | null;
}

export interface EstablishmentDTO {
  id: number;
  owner_id: number;
  name: string;
  kind: EstablishmentKind;
  cnpj: string | null;
  address_text: string;
  reference: string;
  hours: string;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_captured_at: string | null;
}

export interface ItemDTO {
  id: number;
  establishment_id: number;
  name: string;
  unit: string;
}

export interface OfferItemDTO {
  item_id: number;
  name: string;
  unit: string;
  qty_per_unit: number;
}

export interface ReservationDTO {
  id: number;
  offer_id: number;
  offer_title: string;
  state: string;
  has_photo: boolean;
  price_cents: number;
  address_snapshot: string;
  gps_lat: number | null;
  gps_lng: number | null;
  pickup_from: string;
  pickup_until: string;
  pending_expires_at: string | null;
  cancel_before: string;
  created_at: string;
  pickup_code?: string;
}

export interface IncomingReservation {
  id: number;
  offer_id: number;
  state: string;
  created_at: string;
  pending_expires_at: string | null;
  pickup_until: string;
  offer_title: string;
  consumer_name: string;
  consumer_misses: number;
}

export interface NoticeDTO {
  id: number;
  kind: string;
  offer_id: number | null;
  reservation_id: number | null;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface OfferDTO {
  id: number;
  establishment_id: number;
  title: string;
  kind: OfferKind;
  photo_path: string;
  total_units: number;
  price_cents: number;
  is_free: number;
  address_snapshot: string;
  gps_lat: number | null;
  gps_lng: number | null;
  available_from: string;
  pickup_from: string;
  pickup_until: string;
  storage_notes: string;
  state: string;
  cancel_reason: string;
  items: OfferItemDTO[];
  remaining_units: number;
  effective_state: string;
  establishment_name: string;
  merchant_name: string;
  distance_km?: number;
}
