import { listAuditSnapshotBlobNames } from "@/features/organizations/audit/audit.model";

describe("listAuditSnapshotBlobNames", () => {
  it("holds an organization entry's logo from either snapshot, once", () => {
    expect(
      listAuditSnapshotBlobNames("organization", [
        { logoBlobName: " organizations/o/a.png " },
        { logoBlobName: "organizations/o/a.png", name: "Northwind" },
      ]),
    ).toEqual(["organizations/o/a.png"]);
    expect(
      listAuditSnapshotBlobNames("organization", [
        { logoBlobName: null },
        { logoBlobName: "  " },
        null,
        [],
      ]),
    ).toEqual([]);
  });

  it("holds a posting entry's photos and their crops, and ignores anything else", () => {
    expect(
      listAuditSnapshotBlobNames("posting", [
        {
          photos: [
            { blobName: "p/1.jpg", thumbnailBlobName: "p/t1.webp" },
            null,
            "not a photo",
            { blobName: 5 },
          ],
          logoBlobName: "not/held.png",
        },
        { photos: "invalid" },
        { photos: [{ blobName: "p/2.jpg", thumbnailBlobName: null }] },
      ]),
    ).toEqual(["p/1.jpg", "p/t1.webp", "p/2.jpg"]);
  });

  it("holds nothing for any other resource", () => {
    expect(
      listAuditSnapshotBlobNames("membership", [
        { logoBlobName: "organizations/o/a.png", photos: [{ blobName: "x" }] },
      ]),
    ).toEqual([]);
  });
});
