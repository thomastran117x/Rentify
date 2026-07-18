// Form value types and (de)serialization helpers for the organization workspace.

import type {
  OrganizationAnnouncementStatus,
  OrganizationDetailResult,
  OrganizationProfileInput,
} from "@/lib/organizations/api";

export interface ProfileFormValue {
  description: string;
  websiteUrl: string;
  contactEmail: string;
  contactPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  country: string;
  postalCode: string;
  logoUrl: string;
  logoBlobName: string;
  customFields: { key: string; value: string }[];
}

export function emptyProfileForm(): ProfileFormValue {
  return {
    description: "",
    websiteUrl: "",
    contactEmail: "",
    contactPhone: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    region: "",
    country: "",
    postalCode: "",
    logoUrl: "",
    logoBlobName: "",
    customFields: [],
  };
}

export interface AnnouncementFormValue {
  title: string;
  body: string;
  status: OrganizationAnnouncementStatus;
}

export function emptyAnnouncementForm(): AnnouncementFormValue {
  return {
    title: "",
    body: "",
    status: "draft",
  };
}

export function profileFormFromDetail(
  organization: OrganizationDetailResult["organization"],
): ProfileFormValue {
  return {
    description: organization.description ?? "",
    websiteUrl: organization.websiteUrl ?? "",
    contactEmail: organization.contactEmail ?? "",
    contactPhone: organization.contactPhone ?? "",
    addressLine1: organization.addressLine1 ?? "",
    addressLine2: organization.addressLine2 ?? "",
    city: organization.city ?? "",
    region: organization.region ?? "",
    country: organization.country ?? "",
    postalCode: organization.postalCode ?? "",
    logoUrl: organization.logoUrl ?? "",
    logoBlobName: organization.logoBlobName ?? "",
    customFields: Object.entries(organization.customFields ?? {}).map(
      ([key, value]) => ({ key, value }),
    ),
  };
}

export function profileFormToInput(
  value: ProfileFormValue,
): OrganizationProfileInput {
  const toNull = (text: string): string | null => {
    const trimmed = text.trim();
    return trimmed.length === 0 ? null : trimmed;
  };

  const customFields: Record<string, string> = {};
  for (const row of value.customFields) {
    const key = row.key.trim();
    if (key.length > 0) {
      customFields[key] = row.value.trim();
    }
  }

  return {
    description: toNull(value.description),
    websiteUrl: toNull(value.websiteUrl),
    contactEmail: toNull(value.contactEmail),
    contactPhone: toNull(value.contactPhone),
    addressLine1: toNull(value.addressLine1),
    addressLine2: toNull(value.addressLine2),
    city: toNull(value.city),
    region: toNull(value.region),
    country: toNull(value.country),
    postalCode: toNull(value.postalCode),
    logoUrl: toNull(value.logoUrl),
    logoBlobName: toNull(value.logoBlobName),
    customFields: Object.keys(customFields).length > 0 ? customFields : null,
  };
}
