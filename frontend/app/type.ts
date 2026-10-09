export type roles = "ADMIN" | "MANAGER" | "STAFF" | "KITCHEN" | "CUSTOMER";

export interface categoryProps {
  id: string;
  name: string;
}

export interface PaginatedResponseProps<T> {
  data: T[];
  totalItems: number;
  itemsPerPage: number;
  currentPage: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface itemsProps {
  id: string;
  name: string;
  description?: any[];
  price: number;
  categoryId: string;
  isAvailable: boolean;
  image?: string;
  category: categoryProps;
  discount: number;
  recipe?: string;
  averageRating?: number;
  totalReviews?: number;
  aiSuggestion?: string;
}

export type User = {
  id: string;
  name: string;
  email: string;
  role?: string;
  banned?: boolean;
  image?: string;
};

export type TableStatus =
  | "AVAILABLE"
  | "OCCUPIED"
  | "RESERVED"
  | "CLEANING";

export type TablesProps = {
  id: string;
  name: string;
  seats: number;
  section: string;
  shape: "square" | "circle" | "rectangle";
  status: TableStatus;
  /** The party currently seated here, if any (open orders only). */
  orders: {
    id: string;
    status: OrderStatus;
    createdAt: string;
    totalAmount: number;
  }[];
  /** Today's live bookings for this table. */
  reservations: {
    id: string;
    customerName: string | null;
    date: string;
    guests: number;
    status: ReservationStatus;
  }[];
};

export type OrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY";
export type OrderStatus =
  | "PENDING"
  | "PREPARING"
  | "READY"
  | "SERVED"
  | "CANCELLED";
export type PaymentStatus = "PENDING" | "PAID" | "FAILED";
export type PaymentMethod = "CASH" | "CARD";
export type ReservationStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "COMPLETED";

export interface OrderItem extends itemsProps {
  quantity: number;
  /**
   * Stable identity for this cart line.
   *
   * Two of the same dish with different notes — "no onions" and a normal
   * portion — are two lines the kitchen has to cook differently. Quantity
   * edits and removals therefore address the line, not the menu item, or
   * changing one would silently change the other.
   */
  lineId: string;
  /** Kitchen instruction for this line, e.g. "No onions". */
  notes?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  createdAt: string;
  totalAmount: number;
  orderType: OrderType;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  user: User;
  items: {
    id: string;
    orderId: string;
    menuItem: OrderItem;
    menuItemId: string;
    quantity: number;
    price: number;
    notes: string | null;
  }[];
}

export interface Reservation {
  id: string;
  customerName: string;
  customerContact: string;
  reservationTime: string;
  numberOfGuests: number;
  tableId: string;
  status: ReservationStatus;
  date: Date;
  guests: number;
  table: TablesProps;
}

export interface ActivitiesLog {
  id: string;
  details?: string;
  activity: string;
  createdAt: string;
}
