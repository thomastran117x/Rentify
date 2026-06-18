"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth/auth-context";
import {
  ErrorActionModalProvider,
  ErrorToastProvider,
} from "@/components/errors";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <AuthProvider>
      <ErrorToastProvider>
        <ErrorActionModalProvider>{children}</ErrorActionModalProvider>
      </ErrorToastProvider>
    </AuthProvider>
  );
}
