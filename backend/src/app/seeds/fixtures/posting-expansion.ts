import { createFixtureId } from "@/seeds/types";
import type { Uuid } from "@/configuration/validation/uuid";

export type ExpandedPostingBundleType = "standard" | "expanded";

export interface ExpandedSeedOrganizationConfig {
  ownerEmail: string;
  ownerSlug: string;
  city: string;
  region: string;
  country: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  venueWord: string;
  equipmentWord: string;
  vehicleWord: string;
  focusTag: string;
  bundleType: ExpandedPostingBundleType;
}

export const EXPANDED_SEED_ORGANIZATIONS: ExpandedSeedOrganizationConfig[] = [
  {
    ownerEmail: "owner5@rentify.local",
    ownerSlug: "prairie-craft",
    city: "Winnipeg",
    region: "Manitoba",
    country: "Canada",
    postalCode: "R3B1A8",
    latitude: 49.8951,
    longitude: -97.1384,
    venueWord: "Prairie",
    equipmentWord: "Workshop",
    vehicleWord: "River",
    focusTag: "prairie",
    bundleType: "standard",
  },
  {
    ownerEmail: "owner6@rentify.local",
    ownerSlug: "riverline-studio",
    city: "Saskatoon",
    region: "Saskatchewan",
    country: "Canada",
    postalCode: "S7K1J5",
    latitude: 52.1332,
    longitude: -106.67,
    venueWord: "Riverline",
    equipmentWord: "Studio",
    vehicleWord: "Meadow",
    focusTag: "maker",
    bundleType: "standard",
  },
  {
    ownerEmail: "owner7@rentify.local",
    ownerSlug: "warehouse-south",
    city: "Regina",
    region: "Saskatchewan",
    country: "Canada",
    postalCode: "S4P2Z1",
    latitude: 50.4452,
    longitude: -104.6189,
    venueWord: "Warehouse",
    equipmentWord: "Builder",
    vehicleWord: "Southline",
    focusTag: "production",
    bundleType: "standard",
  },
  {
    ownerEmail: "owner8@rentify.local",
    ownerSlug: "orchard-supply",
    city: "Kelowna",
    region: "British Columbia",
    country: "Canada",
    postalCode: "V1Y6N4",
    latitude: 49.888,
    longitude: -119.496,
    venueWord: "Orchard",
    equipmentWord: "Summit",
    vehicleWord: "Lakeside",
    focusTag: "okanagan",
    bundleType: "standard",
  },
  {
    ownerEmail: "owner9@rentify.local",
    ownerSlug: "crosswind-hub",
    city: "Windsor",
    region: "Ontario",
    country: "Canada",
    postalCode: "N9A1J3",
    latitude: 42.3149,
    longitude: -83.0364,
    venueWord: "Crosswind",
    equipmentWord: "Trade",
    vehicleWord: "Bridge",
    focusTag: "logistics",
    bundleType: "standard",
  },
  {
    ownerEmail: "owner10@rentify.local",
    ownerSlug: "forge-bay",
    city: "Hamilton",
    region: "Ontario",
    country: "Canada",
    postalCode: "L8P1A1",
    latitude: 43.2557,
    longitude: -79.8711,
    venueWord: "Forge",
    equipmentWord: "Mill",
    vehicleWord: "Escarpment",
    focusTag: "industrial",
    bundleType: "standard",
  },
  {
    ownerEmail: "owner11@rentify.local",
    ownerSlug: "limestone-works",
    city: "Kingston",
    region: "Ontario",
    country: "Canada",
    postalCode: "K7K3B6",
    latitude: 44.2312,
    longitude: -76.486,
    venueWord: "Limestone",
    equipmentWord: "Foundry",
    vehicleWord: "Harbour",
    focusTag: "heritage",
    bundleType: "standard",
  },
  {
    ownerEmail: "owner12@rentify.local",
    ownerSlug: "tidehouse-rentals",
    city: "Moncton",
    region: "New Brunswick",
    country: "Canada",
    postalCode: "E1C1E2",
    latitude: 46.0878,
    longitude: -64.7782,
    venueWord: "Tidehouse",
    equipmentWord: "Crew",
    vehicleWord: "Bayfront",
    focusTag: "maritime",
    bundleType: "standard",
  },
  {
    ownerEmail: "owner13@rentify.local",
    ownerSlug: "harbour-signal",
    city: "Charlottetown",
    region: "Prince Edward Island",
    country: "Canada",
    postalCode: "C1A1J1",
    latitude: 46.2382,
    longitude: -63.1311,
    venueWord: "Harbour",
    equipmentWord: "Signal",
    vehicleWord: "Boardwalk",
    focusTag: "coastal",
    bundleType: "standard",
  },
  {
    ownerEmail: "owner14@rentify.local",
    ownerSlug: "signal-hill-supply",
    city: "St. John's",
    region: "Newfoundland and Labrador",
    country: "Canada",
    postalCode: "A1C5M2",
    latitude: 47.5615,
    longitude: -52.7126,
    venueWord: "Signal Hill",
    equipmentWord: "Atlantic",
    vehicleWord: "Cliffside",
    focusTag: "atlantic",
    bundleType: "standard",
  },
  {
    ownerEmail: "owner15@rentify.local",
    ownerSlug: "northlight-base",
    city: "Whitehorse",
    region: "Yukon",
    country: "Canada",
    postalCode: "Y1A2A7",
    latitude: 60.7212,
    longitude: -135.0568,
    venueWord: "Northlight",
    equipmentWord: "Trailhead",
    vehicleWord: "Aurora",
    focusTag: "northern",
    bundleType: "expanded",
  },
  {
    ownerEmail: "owner16@rentify.local",
    ownerSlug: "midnight-sun",
    city: "Yellowknife",
    region: "Northwest Territories",
    country: "Canada",
    postalCode: "X1A2P3",
    latitude: 62.454,
    longitude: -114.3718,
    venueWord: "Midnight Sun",
    equipmentWord: "Frontier",
    vehicleWord: "Tundra",
    focusTag: "frontier",
    bundleType: "expanded",
  },
];

export function getExpandedBundleSize(
  bundleType: ExpandedPostingBundleType,
): number {
  return bundleType === "expanded" ? 19 : 18;
}

export function getExpandedPublishedCount(
  bundleType: ExpandedPostingBundleType,
): number {
  return bundleType === "expanded" ? 15 : 12;
}

export function getExpandedOrganizationConfig(
  ownerEmail: string,
): ExpandedSeedOrganizationConfig {
  const config = EXPANDED_SEED_ORGANIZATIONS.find(
    (candidate) => candidate.ownerEmail === ownerEmail,
  );

  if (!config) {
    throw new Error(
      `Missing expanded seed organization config for ${ownerEmail}.`,
    );
  }

  return config;
}

export function getExpandedPostingStartIndex(ownerEmail: string): number {
  let startIndex = 63;

  for (const config of EXPANDED_SEED_ORGANIZATIONS) {
    if (config.ownerEmail === ownerEmail) {
      return startIndex;
    }

    startIndex += getExpandedBundleSize(config.bundleType);
  }

  throw new Error(`Missing expanded posting range for ${ownerEmail}.`);
}

export function getExpandedPostingIndex(
  ownerEmail: string,
  offset: number,
): number {
  return getExpandedPostingStartIndex(ownerEmail) + offset;
}

export function getExpandedPostingId(
  ownerEmail: string,
  offset: number,
): Uuid {
  return createFixtureId(2000, getExpandedPostingIndex(ownerEmail, offset));
}
