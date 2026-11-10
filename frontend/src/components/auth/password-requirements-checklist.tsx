"use client";

import { Check, Circle, X } from "lucide-react";
import {
  type PasswordPersonalContext,
  getApplicablePasswordRequirements,
} from "@/lib/auth/password";
import { theme } from "@/styles/theme";

interface PasswordRequirementsChecklistProps {
  id: string;
  password: string;
  /**
   * What the form knows about the user, so the "doesn't contain your name"
   * row can appear. Without it the row is left out rather than shown as met.
   */
  context?: PasswordPersonalContext;
  /**
   * Set once a submit has rejected the password, so the rows still missing
   * turn red instead of staying neutral.
   */
  invalid?: boolean;
}

/**
 * The strength rules as a live checklist under a new-password field.
 *
 * No `aria-live`: announcing a row on every keystroke is noise. The input
 * points at this list through `aria-describedby` instead, and each row carries
 * its own "met"/"not met" text for screen readers.
 */
export function PasswordRequirementsChecklist({
  id,
  password,
  context = {},
  invalid = false,
}: PasswordRequirementsChecklistProps) {
  return (
    <ul
      id={id}
      aria-label="Password requirements"
      className={theme.auth.requirementList}
    >
      {getApplicablePasswordRequirements(context).map((requirement) => {
        const met = requirement.test(password, context);
        const tone = met
          ? theme.auth.requirementMet
          : invalid
            ? theme.auth.requirementUnmet
            : theme.auth.requirementPending;
        const Icon = met ? Check : invalid ? X : Circle;

        return (
          <li
            key={requirement.id}
            data-state={met ? "met" : invalid ? "unmet" : "pending"}
            className={`${theme.auth.requirementItem} ${tone}`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{requirement.label}</span>
            <span className="sr-only">{met ? " (met)" : " (not met)"}</span>
          </li>
        );
      })}
    </ul>
  );
}
