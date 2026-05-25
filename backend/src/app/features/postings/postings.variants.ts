export const POSTING_FAMILY_VALUES = ["place", "equipment", "vehicle"] as const;

export const PLACE_POSTING_SUBTYPE_VALUES = [
  "entire_place",
  "private_room",
  "shared_room",
  "workspace",
  "storage_space",
] as const;

export const EQUIPMENT_POSTING_SUBTYPE_VALUES = [
  "tool",
  "camera",
  "audio",
  "event_equipment",
  "sports_outdoor",
  "general_equipment",
] as const;

export const VEHICLE_POSTING_SUBTYPE_VALUES = [
  "car",
  "truck_van",
  "bike",
  "motorcycle",
  "trailer",
  "general_vehicle",
] as const;

export const POSTING_SUBTYPE_VALUES = [
  ...PLACE_POSTING_SUBTYPE_VALUES,
  ...EQUIPMENT_POSTING_SUBTYPE_VALUES,
  ...VEHICLE_POSTING_SUBTYPE_VALUES,
] as const;

export type PostingFamilyValue = (typeof POSTING_FAMILY_VALUES)[number];
export type PostingSubtypeValue = (typeof POSTING_SUBTYPE_VALUES)[number];
export type PostingAttributeValue = string | number | boolean | string[];
export type SearchablePostingAttributeKind =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "stringArray";

export interface SearchablePostingAttributeDefinition {
  kind: SearchablePostingAttributeKind;
  min?: number;
  max?: number;
}

export interface PostingSubtypeDefinition {
  label: string;
}

export interface PostingFamilyDefinition {
  label: string;
  subtypes:
    | Record<PostingSubtypeValue, PostingSubtypeDefinition>
    | Partial<Record<PostingSubtypeValue, PostingSubtypeDefinition>>;
  searchableAttributes: Record<string, SearchablePostingAttributeDefinition>;
}

export const postingVariantCatalog = {
  place: {
    label: "Place",
    subtypes: {
      entire_place: { label: "Entire place" },
      private_room: { label: "Private room" },
      shared_room: { label: "Shared room" },
      workspace: { label: "Workspace" },
      storage_space: { label: "Storage space" },
    },
    searchableAttributes: {
      guest_capacity: { kind: "integer", min: 1, max: 1000 },
      bedrooms: { kind: "integer", min: 0, max: 1000 },
      bathrooms: { kind: "number", min: 0, max: 1000 },
      property_type: { kind: "string" },
      amenities: { kind: "stringArray" },
      pet_friendly: { kind: "boolean" },
      parking: { kind: "boolean" },
    },
  },
  equipment: {
    label: "Equipment",
    subtypes: {
      tool: { label: "Tool" },
      camera: { label: "Camera" },
      audio: { label: "Audio" },
      event_equipment: { label: "Event equipment" },
      sports_outdoor: { label: "Sports and outdoor" },
      general_equipment: { label: "General equipment" },
    },
    searchableAttributes: {
      brand: { kind: "string" },
      model: { kind: "string" },
      condition: { kind: "string" },
      power_source: { kind: "string" },
      weight_lb: { kind: "number", min: 0 },
      includes_delivery: { kind: "boolean" },
    },
  },
  vehicle: {
    label: "Vehicle",
    subtypes: {
      car: { label: "Car" },
      truck_van: { label: "Truck or van" },
      bike: { label: "Bike" },
      motorcycle: { label: "Motorcycle" },
      trailer: { label: "Trailer" },
      general_vehicle: { label: "General vehicle" },
    },
    searchableAttributes: {
      make: { kind: "string" },
      model: { kind: "string" },
      year: { kind: "integer", min: 1886, max: 9999 },
      seats: { kind: "integer", min: 1, max: 200 },
      transmission: { kind: "string" },
      fuel_type: { kind: "string" },
      license_class: { kind: "string" },
    },
  },
} as const satisfies Record<PostingFamilyValue, PostingFamilyDefinition>;

export function getPostingVariantDefinition(
  family: PostingFamilyValue,
  subtype: PostingSubtypeValue,
): {
  family: PostingFamilyDefinition;
  subtype: PostingSubtypeDefinition;
} | null {
  const familyDefinition = postingVariantCatalog[family];
  const subtypeDefinition = (
    familyDefinition.subtypes as Partial<
      Record<PostingSubtypeValue, PostingSubtypeDefinition>
    >
  )[subtype];

  if (!subtypeDefinition) {
    return null;
  }

  return {
    family: familyDefinition,
    subtype: subtypeDefinition,
  };
}

export function getPostingSearchableAttributeDefinitions(
  family: PostingFamilyValue,
  subtype: PostingSubtypeValue,
): Record<string, SearchablePostingAttributeDefinition> | null {
  const variant = getPostingVariantDefinition(family, subtype);

  if (!variant) {
    return null;
  }

  return variant.family.searchableAttributes;
}

export function isPostingFamilyValue(
  value: string,
): value is PostingFamilyValue {
  return POSTING_FAMILY_VALUES.includes(value as PostingFamilyValue);
}

export function isPostingSubtypeValue(
  value: string,
): value is PostingSubtypeValue {
  return POSTING_SUBTYPE_VALUES.includes(value as PostingSubtypeValue);
}
