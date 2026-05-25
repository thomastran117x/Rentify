"use client";

import { useEffect, useRef } from "react";
import {
  buildSearchFormQuery,
  toDateTimeLocalValue,
} from "@/lib/postings/search-form";

interface PostingSearchFormProps {
  children: React.ReactNode;
  className?: string;
  initialStartAt?: string;
  initialEndAt?: string;
}

export function PostingSearchForm({
  children,
  className,
  initialStartAt,
  initialEndAt,
}: PostingSearchFormProps) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = formRef.current;

    if (!form) {
      return;
    }

    setDateInputValue(form, "startAt", initialStartAt);
    setDateInputValue(form, "endAt", initialEndAt);
  }, [initialEndAt, initialStartAt]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const query = buildSearchFormQuery(new FormData(form).entries()).toString();
    const target = query
      ? `${window.location.pathname}?${query}`
      : window.location.pathname;

    window.location.assign(target);
  }

  return (
    <form ref={formRef} className={className} onSubmit={handleSubmit}>
      {children}
    </form>
  );
}

function setDateInputValue(
  form: HTMLFormElement,
  name: "startAt" | "endAt",
  value?: string,
): void {
  const input = form.elements.namedItem(name);

  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  input.value = toDateTimeLocalValue(value);
}
