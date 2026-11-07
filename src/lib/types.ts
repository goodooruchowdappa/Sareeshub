export type TagRef = { id: string; slug: string; name: string; category: string; is_default?: boolean; count?: number };

export type ShopCard = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  tagline: string | null;
  locality: string | null;
  city: string;
  state: string | null;
  country: string;
  lat: number;
  lng: number;
  cover: string | null;
  rating_avg: number;
  rating_count: number;
  phone: string;
  whatsapp: string | null;
  hours: string | null;
  featured: boolean;
  priority: number;
  distance_km: number | null;
  tags: string[];
};

export type ProductCard = {
  id: string;
  slug: string;
  title: string;
  price_inr: number | null;
  mrp_inr: number | null;
  image: string | null;
  in_stock: boolean;
  colors: string[];
  updated_at: string;
  distance_km?: number | null;
  tags: string[];
  shop: { id: string; slug: string; name: string; city: string; state: string | null; lat: number; lng: number; rating_avg: number; rating_count: number };
};

export type ShopDetail = {
  shop: Omit<ShopCard, "cover" | "tags" | "distance_km" | "priority"> & {
    description: string | null;
    owner_name: string | null;
    email: string | null;
    website: string | null;
    instagram: string | null;
    established_year: number | null;
    address_line: string | null;
    landmark: string | null;
    district: string | null;
    country_code: string;
    postal_code: string | null;
    photos: string[];
    status: string;
    approved_at: string | null;
    updated_at: string;
    plan_name: string;
    unclaimed?: boolean;
    tags: TagRef[];
  };
  products: ProductCard[];
  reviews: {
    id: string;
    rating: number;
    comment: string | null;
    created_at: string;
    author: string;
    avatar: string | null;
    seller_reply: string | null;
    replied_at: string | null;
  }[];
  rating_breakdown: Record<string, number>;
  nearby: ShopCard[];
};

export type ProductDetail = {
  product: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    price_inr: number | null;
    mrp_inr: number | null;
    colors: string[];
    length_m: number | null;
    blouse_included: boolean;
    in_stock: boolean;
    images: string[];
    active: boolean;
    created_at: string;
    updated_at: string;
    tags: TagRef[];
  };
  shop: ShopCard & { address_line: string | null; landmark: string | null; status: string };
  more_from_shop: ProductCard[];
  similar: ProductCard[];
};

export type Plan = {
  code: string;
  name: string;
  description: string | null;
  price_inr: number;
  duration_days: number;
  max_products: number;
  max_photos: number;
  featured: boolean;
  priority: number;
  features: string[];
  active: boolean;
  sort_order: number;
  audience?: "seller" | "buyer";
  /** Seller plans: custom requests a shop can open per 30 days (null = unlimited, 0 = none). */
  lead_quota?: number | null;
  /** Buyer plans: requests allowed per plan period (null = unlimited). */
  request_quota?: number | null;
};

export type Me = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  is_admin: boolean;
  unread?: number;
  shops: { id: string; slug: string; name: string; status: string }[];
};

export type BuyerStatus = {
  plan_code: string;
  plan_name: string;
  quota: number | null;
  used: number;
  remaining: number | null;
  refunded?: number;
  ends_at: string | null;
};

export type RequestSummary = {
  id: string;
  title: string;
  status: "open" | "closed" | "hidden" | "expired";
  city: string;
  min_price: number | null;
  max_price: number | null;
  image: string | null;
  created_at: string;
  expires_at: string;
  needed_by: string | null;
  responses: number;
  unseen: number;
  tags: TagRef[];
};

export type RequestReply = {
  id: string;
  message: string;
  price_inr: number | null;
  ready_in_days: number | null;
  images: string[];
  status: "sent" | "shortlisted" | "declined";
  hidden: boolean;
  created_at: string;
  updated_at: string;
  shop: ShopCard & { country_code: string };
};

export type RequestDetail = {
  request: {
    id: string;
    title: string;
    description: string | null;
    min_price: number | null;
    max_price: number | null;
    colors: string[];
    images: string[];
    quantity: number;
    needed_by: string | null;
    city: string;
    state: string | null;
    country: string;
    radius_km: number | null;
    status: RequestSummary["status"];
    closed_reason: string | null;
    response_count: number;
    created_at: string;
    expires_at: string;
    tags: TagRef[];
  };
  responses: RequestReply[];
};

export type Notification = { id: string; kind: string; title: string; body: string | null; link: string | null; read: boolean; created_at: string };
