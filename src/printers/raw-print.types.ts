export interface RawPrintRequest {
  printerName: string;
  jobName: string;
  data: Buffer;
}

export interface RawPrintResult {
  success: true;
  printerName: string;
  jobName: string;
}
