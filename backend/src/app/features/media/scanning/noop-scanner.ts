import type {
  MalwareScanner,
  MalwareScanResult,
} from "@/features/media/scanning/malware-scanner";

/** Scans nothing. Used where no scanner is configured. */
export class NoopScanner implements MalwareScanner {
  async scan(): Promise<MalwareScanResult> {
    return { verdict: "skipped", engine: "none" };
  }
}
