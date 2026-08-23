import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OrganizationBlogCommentsRepository } from "@/features/organizations/blog/comments/comments.repository";
import { OrganizationBlogCommentsService } from "@/features/organizations/blog/comments/comments.service";
import { OrganizationBlogCommentsController } from "@/features/organizations/blog/comments/comments.controller";
import { OrganizationBlogCommentSocketServer } from "@/features/organizations/blog/comments/comment-socket.server";

export const organizationsBlogCommentsRegistrationModule: ContainerRegistrationModule =
  {
    id: "organizations-blog-comments",
    register(container) {
      container.register({
        token: containerTokens.organizationBlogCommentsRepository,
        lifetime: "singleton",
        dependencies: [],
        resolve: () => new OrganizationBlogCommentsRepository(),
      });
      container.register({
        // Singleton with a dispose hook: it owns the Socket.IO server, its Redis
        // adapter connections and every open socket, so it must outlive any
        // request scope. The service resolves it as its realtime seam, which is
        // not a cycle: this constructor takes no dependencies.
        token: containerTokens.organizationBlogCommentSocketServer,
        lifetime: "singleton",
        dependencies: [],
        resolve: () => new OrganizationBlogCommentSocketServer(),
        dispose: (socketServer) => socketServer.close(),
      });
      container.register({
        token: containerTokens.organizationBlogCommentsService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.organizationBlogCommentsRepository,
          containerTokens.organizationAccessService,
          containerTokens.contentSanitizationService,
          containerTokens.cacheService,
          containerTokens.tokenService,
          containerTokens.organizationBlogCommentSocketServer,
        ],
        resolve: ({ resolve }) =>
          new OrganizationBlogCommentsService(
            resolve(containerTokens.organizationBlogCommentsRepository),
            resolve(containerTokens.organizationAccessService),
            resolve(containerTokens.contentSanitizationService),
            resolve(containerTokens.cacheService),
            resolve(containerTokens.tokenService),
            resolve(containerTokens.organizationBlogCommentSocketServer),
          ),
      });
      container.register({
        token: containerTokens.organizationBlogCommentsController,
        lifetime: "scoped",
        dependencies: [containerTokens.organizationBlogCommentsService],
        resolve: ({ resolve }) =>
          new OrganizationBlogCommentsController(
            resolve(containerTokens.organizationBlogCommentsService),
          ),
      });
    },
  };
