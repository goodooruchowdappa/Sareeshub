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
};

export type Me = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  is_admin: boolean;
  shops: { id: string; slug: string; name: string; status: string }[];
};
