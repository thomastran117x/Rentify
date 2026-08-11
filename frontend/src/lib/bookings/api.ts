import { bookingMessagesApi } from "@/lib/booking-messages/api";
import { openBookingMessageSocket } from "@/lib/booking-messages/socket";
import { bookingRequestsApi } from "@/lib/booking-requests/api";
import { rentingsApi } from "@/lib/rentings/api";

export const bookingsApi = {
  getBookingById: bookingRequestsApi.getById,
  listMessages: bookingMessagesApi.list,
  sendMessage: bookingMessagesApi.send,
  markMessagesRead: bookingMessagesApi.markRead,
  openMessageSocket: openBookingMessageSocket,
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
