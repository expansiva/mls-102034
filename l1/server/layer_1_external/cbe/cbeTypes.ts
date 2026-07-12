/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeTypes.ts" enhancement="_blank" />
// Minimal contracts mirrored from the central cbe (collab back-end) /exec API.
// Only the login-related subset runs on the runtime VM — administration
// actions (org management, invites, project settings, user creation) stay on
// the central cbe / sites.collab.codes. Field names must stay compatible with
// the cfe (mls) frontend library, which consumes this payload unchanged.

export const CBE_HTTP_OK = 200;
export const CBE_HTTP_BAD_REQUEST = 400;
export const CBE_HTTP_NOT_FOUND = 404;
export const CBE_HTTP_NOT_MODIFIED = 304;
export const CBE_HTTP_SERVER_ERROR = 500;

export interface CbeProjectsLastModified {
  project: number;
  lastModified: string;
}

export interface CbeRequestBase {
  action: string;
}

export interface CbeRequestLogin extends CbeRequestBase {
  action: 'login';
  queryString?: string;
  baseProject?: number;
  actualProject?: number;
  projectsLastModified?: CbeProjectsLastModified[];
}

export interface CbePrjSourcesFile {
  shortPath: string;
  versionRef?: string;
  Length?: number;
  update_at?: string;
  /** gzip+base64 of the compiled js content (same encoding the central cbe uses). */
  jsContent?: string;
}

export interface CbePrjSourcesInfo {
  filesInfo: CbePrjSourcesFile[];
  importsMap: string;
  indexModules: string;
}

export interface CbePrjSettings {
  id: number;
  name: string;
  owner: string;
  value: string;
  created_at: string;
  archived_at: string;
  repository_lastModified: string;
  userAuth: 'public' | 'private';
  prj_dependencies: number[];
  /** gzip+base64 of CbePrjSourcesInfo — only present when newer than the frontend copy. */
  files?: string;
}

export interface CbeOrgInfo {
  key: string;
  value: string;
  sett: {
    name: string;
    created_at: string;
    description: string;
    projects: CbePrjSettings[];
    users: string[];
    teams: { name: string; auth: string; usrIndex: number[] }[];
  };
  VersionNumber: number;
}

export interface CbeResponseBase {
  statusCode: number;
  msg: string;
  error?: string;
}

export interface CbeResponseLogin extends CbeResponseBase {
  services: unknown[];
  orgs: { [org: string]: CbeOrgInfo };
  inits: { [widget: string]: string };
  providers: string[];
  avatar_url: string;
  baseProject: number;
  alertMessage: string;
  errorMessage: string;
}
