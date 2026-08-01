import type { PostingSort, PublicPostingSummary } from "@/lib/postings/search";

export interface PostingOrganizationGroup {
  key: string;
  organization?: PublicPostingSummary["organization"];
  postings: PublicPostingSummary[];
}

export function isOrganizationSort(sort: PostingSort): boolean {
  return sort === "organizationAsc" || sort === "organizationDesc";
}

/**
 * Split an already-ordered page of results into consecutive runs by owning
 * organization.
 *
 * Deliberately does not sort: the server has already applied the ordering
 * (including its stable tiebreak), and re-sorting here would desync the
 * headings from the sequence the next page continues from. An organization
 * that straddles a page boundary therefore heads a section on both pages.
 */
export function groupPostingsByOrganization(
  postings: PublicPostingSummary[],
): PostingOrganizationGroup[] {
  const groups: PostingOrganizationGroup[] = [];

  for (const posting of postings) {
    const key = posting.organization?.id ?? "__unknown__";
    const currentGroup = groups[groups.length - 1];

    if (currentGroup && currentGroup.key === key) {
      currentGroup.postings.push(posting);
      continue;
    }

    groups.push({
      key,
      organization: posting.organization,
      postings: [posting],
    });
  }

  return groups;
}
