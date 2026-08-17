import { USERNAME_CHANGE_COOLDOWN_DAYS } from "@/features/profile/username-change-policy";
import AppError from "./app.error";

class UsernameChangeCooldownError extends AppError {
  constructor(
    message = `You can only change your username once every ${USERNAME_CHANGE_COOLDOWN_DAYS} days.`,
    details?: unknown,
  ) {
    super(message, 429, "USERNAME_CHANGE_COOLDOWN", details);
    this.name = "UsernameChangeCooldownError";
  }
}

export default UsernameChangeCooldownError;
export { UsernameChangeCooldownError };
