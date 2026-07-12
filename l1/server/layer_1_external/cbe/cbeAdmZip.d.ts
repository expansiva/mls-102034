// Minimal ambient declaration for the adm-zip subset used by the cbe module.
// The package ships without types and nothing else in mls-base imports it from
// TypeScript, so a local declaration keeps the dependency footprint unchanged.
declare module 'adm-zip' {
  interface AdmZipEntry {
    entryName: string;
    getData(): Buffer;
  }

  class AdmZip {
    constructor(input?: string | Buffer);
    getEntries(): AdmZipEntry[];
  }

  export = AdmZip;
}
