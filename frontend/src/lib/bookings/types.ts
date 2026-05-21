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
