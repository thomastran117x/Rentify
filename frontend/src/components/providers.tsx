"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth/auth-context";
import {
  ErrorActionModalProvider,
  ErrorToastProvider,
} from "@/components/errors";
import { ActiveOrganizationRoleProvider } from "@/components/navigation/app-shell/active-organization-role";
import { RecentlyViewedProvider } from "@/components/postings/recently-viewed-context";
import { SavedPostingsProvider } from "@/components/postings/saved-postings-context";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <AuthProvider>
      <ErrorToastProvider>
        <ErrorActionModalProvider>
          <SavedPostingsProvider>
            <RecentlyViewedProvider>
              <ActiveOrganizationRoleProvider>
                {children}
              </ActiveOrganizationRoleProvider>
            </RecentlyViewedProvider>
          </SavedPostingsProvider>
        </ErrorActionModalProvider>
      </ErrorToastProvider>
    </AuthProvider>
  );
}
