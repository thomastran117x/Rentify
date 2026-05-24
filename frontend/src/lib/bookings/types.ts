export type BookingRequestStatus =
  | "pending"
  | "approved"
  | "awaiting_payment"
  | "payment_processing"
  | "paid"
  | "payment_failed"
  | "declined"
  | "expired"
  | "cancelled"
  | "refunded";

export type BookingDashboardSort = "urgency" | "start_at";
export type RenterBookingDashboardBucket =
  | "action_needed"
  | "upcoming"
  | "pending"
  | "past"
  | "cancelled";
export type OwnerBookingDashboardActionNeeded =
  | "approval"
  | "payment"
  | "expiring_hold"
  | "payment_failure"
  | "conversion";
export type BookingDashboardUrgencyLevel = "high" | "medium" | "low" | "none";
export type BookingCancellationActor = "renter" | "owner";
export type BookingCancellationRefundType = "full" | "partial" | "none" | "unsupported";

export interface BookingRequestPostingSummary {
  id: string;
  name: string;
  primaryPhotoUrl?: string;
  effectiveMaxBookingDurationDays: number;
}

export interface BookingRequestRecord {
  id: string;
  postingId: string;
  renterId: string;
  ownerId: string;
  status: BookingRequestStatus;
  startAt: string;
  endAt: string;
  durationDays: number;
  guestCount: number;
  contactName: string;
  contactEmail: string;
  contactPhoneNumber?: string;
  note?: string;
  pricingCurrency: string;
  dailyPriceAmount: number;
  estimatedTotal: number;
  decisionNote?: string;
  approvedAt?: string;
  paymentRequiredAt?: string;
  paymentFailedAt?: string;
  cancelledAt?: string;
  cancelledByUserId?: string;
  cancellationActor?: BookingCancellationActor;
  cancellationReason?: string;
  cancellationPolicyCode?: string;
  cancellationRefundAmount?: number;
  refundedAt?: string;
  declinedAt?: string;
  expiredAt?: string;
  convertedAt?: string;
  holdExpiresAt: string;
  holdBlockId?: string;
  paymentReconciliationRequired?: boolean;
  rentingId?: string;
  createdAt: string;
  updatedAt: string;
  posting: BookingRequestPostingSummary;
}

export interface BookingRequestsListResult {
  bookingRequests: BookingRequestRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  status?: BookingRequestStatus;
}

export type BookingDashboardNextActionCode =
  | "review_request"
  | "complete_payment"
  | "retry_payment"
  | "convert_to_renting"
  | "await_owner_response"
  | "monitor_upcoming"
  | "view_renting"
  | "none";

export interface BookingDashboardNextAction {
  code: BookingDashboardNextActionCode;
  label: string;
}

export interface BookingDashboardUrgency {
  level: BookingDashboardUrgencyLevel;
  rank: number;
  isActionable: boolean;
  label: string;
  deadlineAt?: string;
}

export interface BookingDashboardItem {
  id: string;
  kind: "booking_request" | "renting";
  bookingRequestId?: string;
  rentingId?: string;
  postingId: string;
  renterId: string;
  ownerId: string;
  status: BookingRequestStatus | "confirmed";
  sourceStatus: BookingRequestStatus | "confirmed";
  startAt: string;
  endAt: string;
  durationDays: number;
  guestCount: number;
  pricingCurrency: string;
  dailyPriceAmount: number;
  estimatedTotal: number;
  createdAt: string;
  updatedAt: string;
  posting: BookingRequestPostingSummary;
  holdExpiresAt?: string;
  approvedAt?: string;
  paymentRequiredAt?: string;
  paymentFailedAt?: string;
  convertedAt?: string;
  confirmedAt?: string;
  actionNeededCategory?: OwnerBookingDashboardActionNeeded;
  isExpiringHold: boolean;
  nextAction: BookingDashboardNextAction;
  urgency: BookingDashboardUrgency;
}

export interface BookingDashboardPostingOption {
  id: string;
  name: string;
}

export interface RenterBookingDashboardSummary {
  upcoming: number;
  pending: number;
  actionNeeded: number;
  past: number;
  cancelled: number;
}

export interface OwnerBookingDashboardSummary {
  approval: number;
  payment: number;
  expiringHold: number;
  paymentFailure: number;
  conversion: number;
  totalOpen: number;
}

export interface RenterBookingDashboardResult {
  summary: RenterBookingDashboardSummary;
  items: BookingDashboardItem[];
  pagination: BookingRequestsListResult["pagination"];
  filters: {
    page: number;
    pageSize: number;
    sort: BookingDashboardSort;
    bucket?: RenterBookingDashboardBucket;
    status?: BookingRequestStatus;
  };
}

export interface OwnerBookingDashboardResult {
  summary: OwnerBookingDashboardSummary;
  items: BookingDashboardItem[];
  postings: BookingDashboardPostingOption[];
  pagination: BookingRequestsListResult["pagination"];
  filters: {
    page: number;
    pageSize: number;
    sort: BookingDashboardSort;
    status?: BookingRequestStatus;
    actionNeeded?: OwnerBookingDashboardActionNeeded;
    postingId?: string;
  };
}

export interface BookingCancellationFailureReason {
  code:
    | "already_started"
    | "booking_already_converted"
    | "booking_status_ineligible"
    | "payment_processing_in_progress"
    | "payment_missing"
    | "payment_refund_failed";
  message: string;
}

export interface BookingCancellationQuoteResult {
  bookingRequestId: string;
  cancellable: boolean;
  actor: BookingCancellationActor;
  bookingStatus: BookingRequestStatus;
  reasonRequired: boolean;
  policyCode: string;
  refundType: BookingCancellationRefundType;
  refundAmount: number;
  currency: string;
  failureReasons: BookingCancellationFailureReason[];
}
