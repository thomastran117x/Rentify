"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth/auth-context";
import {
  ErrorActionModalProvider,
  ErrorToastProvider,
} from "@/components/errors";
import { SavedPostingsProvider } from "@/components/postings/saved-postings-context";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <AuthProvider>
      <ErrorToastProvider>
        <ErrorActionModalProvider>
          <SavedPostingsProvider>{children}</SavedPostingsProvider>
        </ErrorActionModalProvider>
      </ErrorToastProvider>
    </AuthProvider>
  );
}
