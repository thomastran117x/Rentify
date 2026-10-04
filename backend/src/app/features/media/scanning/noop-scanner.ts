import {
  NOOP_SCANNER_ENGINE,
  type MalwareScanner,
  type MalwareScanResult,
} from "@/features/media/scanning/malware-scanner";

/**
 * Scans nothing. Used where no scanner is configured; the item is recorded as
 * skipped rather than clean, so an audit can tell the two apart.
 */
export class NoopScanner implements MalwareScanner {
  async scan(): Promise<MalwareScanResult> {
    return { verdict: "clean", engine: NOOP_SCANNER_ENGINE };
  }
}
