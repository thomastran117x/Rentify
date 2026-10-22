"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { isAdminRole } from "@/lib/auth/roles";

/**
 * Keeps non-admins out of `/admin/*`: a signed-out visitor goes to sign-in and
 * comes back afterwards, and any other role goes home. This only spares them
 * a page they cannot use. The backend enforces the role on every admin
 * endpoint, and each page still handles its 403.
 */
export function AdminGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, session } = useAuth();
  const isAdmin = isAdminRole(session?.user.role);

  useEffect(() => {
    if (status === "anonymous") {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/admin")}`);
      return;
    }

    if (status === "authenticated" && session && !isAdmin) {
      router.replace("/");
    }
  }, [isAdmin, pathname, router, session, status]);

  if (status === "authenticated" && isAdmin) {
    return <>{children}</>;
  }

  return (
    <div
      role="status"
      className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-600 dark:text-slate-300"
    >
      {status === "loading" || (status === "authenticated" && !session)
        ? "Checking access..."
        : "Redirecting..."}
    </div>
  );
}
