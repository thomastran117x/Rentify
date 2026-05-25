import AppError from "./app.error";

class ServiceNotImplementedError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 501, "SERVICE_NOT_IMPLEMENTED", details);
    this.name = "ServiceNotImplementedError";
  }
}

export default ServiceNotImplementedError;
export { ServiceNotImplementedError };
