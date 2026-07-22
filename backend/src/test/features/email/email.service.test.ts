import { EmailService } from "@/features/email/email.service";

describe("EmailService", () => {
  it("queues verification email jobs instead of delivering inline", async () => {
    const enqueueEmailJob = jest.fn(async () => undefined);
    const service = new EmailService({
      enqueueEmailJob,
    } as any);

    await service.sendVerificationEmail({
      to: "user@example.com",
      verificationCode: "123456",
      firstName: "Test",
    });

    expect(enqueueEmailJob).toHaveBeenCalledWith("verification", {
      to: "user@example.com",
      verificationCode: "123456",
      firstName: "Test",
    });
  });

  it("queues new-device alert jobs", async () => {
    const enqueueEmailJob = jest.fn(async () => undefined);
    const service = new EmailService({
      enqueueEmailJob,
    } as any);

    await service.sendNewDeviceEmail({
      to: "user@example.com",
      firstName: "Test",
      deviceLabel: "Chrome on macOS",
      ipAddress: "127.0.0.1",
    });

    expect(enqueueEmailJob).toHaveBeenCalledWith("new_device", {
      to: "user@example.com",
      firstName: "Test",
      deviceLabel: "Chrome on macOS",
      ipAddress: "127.0.0.1",
    });
  });

  it("queues username reminder jobs", async () => {
    const enqueueEmailJob = jest.fn(async () => undefined);
    const service = new EmailService({
      enqueueEmailJob,
    } as any);

    await service.sendUsernameReminderEmail({
      to: "user@example.com",
      username: "owner-one",
      firstName: "Test",
    });

    expect(enqueueEmailJob).toHaveBeenCalledWith("username_reminder", {
      to: "user@example.com",
      username: "owner-one",
      firstName: "Test",
    });
  });

  it("queues organization invite jobs", async () => {
    const enqueueEmailJob = jest.fn(async () => undefined);
    const service = new EmailService({
      enqueueEmailJob,
    } as any);

    await service.sendOrganizationInviteEmail({
      to: "invitee@example.com",
      organizationName: "Northwind",
      inviterName: "Owner One",
      role: "operator",
      token: "invite-token-1",
    });

    expect(enqueueEmailJob).toHaveBeenCalledWith("organization_invite", {
      to: "invitee@example.com",
      organizationName: "Northwind",
      inviterName: "Owner One",
      role: "operator",
      token: "invite-token-1",
    });
  });
});
