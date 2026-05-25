export interface ContentSanitizationInput {
  path: string;
  value: string;
}

export type ContentSanitizationViolationCode =
  | "UNSAFE_MARKUP"
  | "INJECTION_PATTERN"
  | "PROFANITY"
  | "CONTROL_CHARACTER";

export interface ContentSanitizationViolation {
  path: string;
  message: string;
  code: ContentSanitizationViolationCode;
}

type ContentSanitizationProfile = "content" | "request";

const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const HTML_TAG_PATTERN = /<\s*\/?\s*[a-z!][^>]*>/i;
const INLINE_EVENT_HANDLER_PATTERN = /\bon[a-z]+\s*=/i;
const JAVASCRIPT_URL_PATTERN = /\bjavascript\s*:/i;
const PROFANITY_PATTERN =
  /\b(?:asshole|bitch|bullshit|cunt|fuck|fucker|fucking|motherfucker|shit|shitty)\b/i;
const INJECTION_PATTERNS: Array<{
  pattern: RegExp;
  code: Extract<
    ContentSanitizationViolationCode,
    "INJECTION_PATTERN" | "UNSAFE_MARKUP"
  >;
}> = [
  {
    pattern: /<\s*script\b/i,
    code: "UNSAFE_MARKUP",
  },
  {
    pattern: /<\/\s*script\s*>/i,
    code: "UNSAFE_MARKUP",
  },
  {
    pattern: /\bunion\s+select\b/i,
    code: "INJECTION_PATTERN",
  },
  {
    pattern: /\bdrop\s+table\b/i,
    code: "INJECTION_PATTERN",
  },
  {
    pattern: /\binsert\s+into\b/i,
    code: "INJECTION_PATTERN",
  },
  {
    pattern: /\bdelete\s+from\b/i,
    code: "INJECTION_PATTERN",
  },
  {
    pattern: /\bupdate\s+[a-z_][a-z0-9_]*\s+set\b/i,
    code: "INJECTION_PATTERN",
  },
  {
    pattern: /'\s*or\s*'?\d+'?\s*=\s*'?\d+'?/i,
    code: "INJECTION_PATTERN",
  },
  {
    pattern: /'\s*or\s+1\s*=\s*1/i,
    code: "INJECTION_PATTERN",
  },
  {
    pattern: /\bexec\s+xp_/i,
    code: "INJECTION_PATTERN",
  },
];

export class ContentSanitizationService {
  inspect(inputs: ContentSanitizationInput[]): ContentSanitizationViolation[] {
    return this.inspectWithProfile(inputs, "content");
  }

  inspectRequest(
    inputs: ContentSanitizationInput[],
  ): ContentSanitizationViolation[] {
    return this.inspectWithProfile(inputs, "request");
  }

  private inspectWithProfile(
    inputs: ContentSanitizationInput[],
    profile: ContentSanitizationProfile,
  ): ContentSanitizationViolation[] {
    const violations: ContentSanitizationViolation[] = [];

    for (const input of inputs) {
      const value = input.value.trim();

      if (!value) {
        continue;
      }

      const violation = this.inspectValue(input.path, value, profile);

      if (violation) {
        violations.push(violation);
      }
    }

    return violations;
  }

  private inspectValue(
    path: string,
    value: string,
    profile: ContentSanitizationProfile,
  ): ContentSanitizationViolation | null {
    if (CONTROL_CHARACTER_PATTERN.test(value)) {
      return {
        path,
        code: "CONTROL_CHARACTER",
        message: "Contains invalid control characters.",
      };
    }

    if (
      HTML_TAG_PATTERN.test(value) ||
      INLINE_EVENT_HANDLER_PATTERN.test(value) ||
      JAVASCRIPT_URL_PATTERN.test(value)
    ) {
      return {
        path,
        code: "UNSAFE_MARKUP",
        message: "Contains disallowed content.",
      };
    }

    if (profile === "request") {
      return null;
    }

    for (const { pattern, code } of INJECTION_PATTERNS) {
      if (pattern.test(value)) {
        return {
          path,
          code,
          message: "Contains disallowed content.",
        };
      }
    }

    if (PROFANITY_PATTERN.test(value)) {
      return {
        path,
        code: "PROFANITY",
        message: "Contains disallowed content.",
      };
    }

    return null;
  }
}
