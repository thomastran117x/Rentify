import { bookingMessagesApi } from "@/lib/booking-messages/api";
import { openBookingMessageStream } from "@/lib/booking-messages/stream";
import { bookingRequestsApi } from "@/lib/booking-requests/api";
import { rentingsApi } from "@/lib/rentings/api";

export const bookingsApi = {
  getBookingById: bookingRequestsApi.getById,
  listMessages: bookingMessagesApi.list,
  sendMessage: bookingMessagesApi.send,
  markMessagesRead: bookingMessagesApi.markRead,
  openMessageStream: openBookingMessageStream,
  listMine: bookingRequestsApi.listMine,
  listOwned: bookingRequestsApi.listOwned,
  getMyDashboard: bookingRequestsApi.getRenterDashboard,
  getOwnerDashboard: bookingRequestsApi.getOwnerDashboard,
  getCancellationQuote: bookingRequestsApi.getCancellationQuote,
  cancel: bookingRequestsApi.cancel,
  updateRentingInstructions: rentingsApi.updateInstructions,
  markRentingCheckInReady: rentingsApi.markCheckInReady,
  markRentingCheckInComplete: rentingsApi.markCheckInComplete,
  completeRentingReturn: rentingsApi.markReturnComplete,
  createRentingDispute: rentingsApi.createDispute,
};
